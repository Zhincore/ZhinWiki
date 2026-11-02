import { timingSafeEqual } from 'node:crypto';
import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context, MiddlewareHandler } from 'hono';
import { AppError } from '@/errors';
import { clientIpFromForwardedFor, isPrivateIp } from '@/lib/client-ip';
import { envExtras } from '@/lib/env-extras';
import type { HonoEnv } from '@/lib/hono/context';

/** Resolves a request's bucket; `null` exempts the request. */
type RateLimitKey = (ctx: Context<HonoEnv>) => string | null;

interface RateLimitOptions {
  /** Sliding window length in milliseconds. */
  windowMs: number;
  /** Maximum number of requests allowed per client within the window. */
  max: number;
  /** Bucket per request; defaults to the client IP. */
  key?: RateLimitKey;
}

interface ByteBudgetOptions {
  /** Sliding window length in milliseconds. */
  windowMs: number;
  /** Bytes allowed per key within the window. */
  maxBytes: number;
  /** Bucket per request; `null` exempts the request. */
  key: RateLimitKey;
}

/** Hard bound on distinct client buckets kept in memory per limiter instance —
 *  a spoofed-IP flood evicts the oldest buckets instead of growing the heap. */
const MAX_TRACKED_KEYS = 10_000;

interface Entry {
  at: number;
  amount: number;
}

/**
 * Per-key sliding window of amounts, refused once the in-window sum reaches
 * `max`. Idle buckets are swept; the map is capped at MAX_TRACKED_KEYS.
 */
const slidingWindow = (windowMs: number, max: number) => {
  const buckets = new Map<string, Entry[]>();

  // unref() keeps the sweep timer from holding the process open.
  const sweep = () => {
    const cutoff = Date.now() - windowMs;
    for (const [key, entries] of buckets) {
      if ((entries[entries.length - 1]?.at ?? 0) <= cutoff) {
        buckets.delete(key);
      }
    }
  };
  setInterval(sweep, Math.max(windowMs, 30_000)).unref();

  /** In-window entries of `key`, pruned in place; evicts the oldest bucket for a new key when full. */
  const recent = (key: string, now: number): Entry[] => {
    if (!buckets.has(key) && buckets.size >= MAX_TRACKED_KEYS) {
      const oldest = buckets.keys().next();
      if (!oldest.done) {
        buckets.delete(oldest.value);
      }
    }
    const entries = (buckets.get(key) ?? []).filter((entry) => entry.at > now - windowMs);
    buckets.set(key, entries);
    return entries;
  };

  return {
    /** Throws 429 with Retry-After (until the sum drops below `max`) when `key` is spent. */
    assertOpen: (ctx: Context<HonoEnv>, key: string, message: string) => {
      const now = Date.now();
      const entries = recent(key, now);
      let total = entries.reduce((sum, entry) => sum + entry.amount, 0);
      if (total < max) {
        return;
      }
      let reopensAt = now;
      for (const entry of entries) {
        total -= entry.amount;
        reopensAt = entry.at + windowMs;
        if (total < max) {
          break;
        }
      }
      ctx.header('Retry-After', String(Math.max(1, Math.ceil((reopensAt - now) / 1000))));
      throw new AppError({ code: 'http:rate_limited', message });
    },
    record: (key: string, amount: number) => {
      const now = Date.now();
      recent(key, now).push({ at: now, amount });
    },
  };
};

/** Constant-time secret comparison — `===` short-circuits on the first differing
 *  byte, leaking a timing oracle on a value that gates a trust decision. */
const secretMatches = (candidate: string | undefined, secret: string): boolean => {
  if (!candidate) {
    return false;
  }
  const a = Buffer.from(candidate);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
};

/** The direct TCP peer of this request, or null when the runtime exposes no
 *  socket info (e.g. tests invoking app.fetch directly). */
const socketAddress = (ctx: Context<HonoEnv>): string | null => {
  try {
    return getConnInfo(ctx).remote.address ?? null;
  } catch {
    return null;
  }
};

/**
 * Resolve the rate-limit bucket key for a request. Priority:
 *  1. `x-nibleaf-client-ip` — set by our own app SSR proxy, which knows the
 *     real visitor IP (SSR loader fetches otherwise all originate from the app
 *     container's address and would share one bucket). The app's nitro /api
 *     proxy forwards browser-supplied headers, so a private peer alone is NOT
 *     proof the hint came from our SSR code — the hint is only honoured when
 *     INTERNAL_API_SECRET is configured AND the request carries the matching
 *     `x-nibleaf-internal` header (plus a private direct peer).
 *  2. `x-forwarded-for` — first public hop (see lib/client-ip.ts).
 *  3. The actual socket remote address (direct connections / dev).
 * Never a shared constant: worst case is 'unknown', which only happens when a
 * runtime has neither headers nor socket info.
 */
const resolveClientKey = (ctx: Context<HonoEnv>): string => {
  const peer = socketAddress(ctx);
  const hinted = ctx.req.header('x-nibleaf-client-ip')?.trim();
  const secret = envExtras.INTERNAL_API_SECRET;
  const trustedInternal = Boolean(secret) && secretMatches(ctx.req.header('x-nibleaf-internal'), secret as string);
  if (hinted && trustedInternal && peer && isPrivateIp(peer)) {
    return hinted;
  }
  const forwarded = clientIpFromForwardedFor(ctx.req.header('x-forwarded-for'), envExtras.TRUSTED_PROXY_HOPS);
  if (forwarded) {
    return forwarded;
  }
  return peer ?? 'unknown';
};

/**
 * Lightweight in-memory sliding-window rate limiter (no external deps).
 *
 * NOTE: state is per-instance — behind multiple replicas each process tracks its
 * own counters, so the effective limit scales with instance count. Use a
 * Redis-backed limiter for accurate enforcement across a multi-instance deployment.
 */
export const rateLimit = ({ windowMs, max, key = resolveClientKey }: RateLimitOptions): MiddlewareHandler<HonoEnv> => {
  const limiter = slidingWindow(windowMs, max);
  return async (ctx, next) => {
    const bucket = key(ctx);
    if (bucket !== null) {
      limiter.assertOpen(ctx, bucket, 'Too many requests, please slow down.');
      limiter.record(bucket, 1);
    }
    await next();
  };
};

/**
 * Sliding-window byte budget, in memory and per instance like `rateLimit`.
 * `guard` refuses requests once the budget is spent; `record` books bytes
 * actually stored. Sizes are unknown before the body is read, so the last
 * admitted request may overshoot the budget by its own size.
 */
export const byteBudget = ({ windowMs, maxBytes, key }: ByteBudgetOptions) => {
  const limiter = slidingWindow(windowMs, maxBytes);
  const guard: MiddlewareHandler<HonoEnv> = async (ctx, next) => {
    const bucket = key(ctx);
    if (bucket !== null) {
      limiter.assertOpen(ctx, bucket, 'Upload budget spent, please try again later.');
    }
    await next();
  };
  return {
    guard,
    record: (ctx: Context<HonoEnv>, bytes: number) => {
      const bucket = key(ctx);
      if (bucket !== null) {
        limiter.record(bucket, bytes);
      }
    },
  };
};
