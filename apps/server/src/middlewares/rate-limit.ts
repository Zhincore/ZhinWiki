import { timingSafeEqual } from 'node:crypto';
import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context, MiddlewareHandler } from 'hono';
import { AppError } from '@/errors';
import { clientIpFromForwardedFor, isPrivateIp } from '@/lib/client-ip';
import { envExtras } from '@/lib/env-extras';
import type { HonoEnv } from '@/lib/hono/context';
import { slidingWindow } from '@/lib/sliding-window';

/** Resolves a request's bucket; `null` exempts the request. */
type RateLimitKey = (ctx: Context<HonoEnv>) => string | null | Promise<string | null>;

interface RateLimitOptions {
  /** Namespace of this limiter's buckets, unique across limiters. */
  name: string;
  /** Sliding window length in milliseconds. */
  windowMs: number;
  /** Maximum number of requests allowed per client within the window. */
  max: number;
  /** Bucket per request; defaults to the client IP. */
  key?: RateLimitKey;
}

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
export const resolveClientKey = (ctx: Context<HonoEnv>): string => {
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
 * Sliding-window rate limiter. Counters live in Redis when it is configured,
 * so every replica shares one budget; otherwise (or while Redis is down) each
 * process keeps its own.
 */
export const rateLimit = ({ name, windowMs, max, key = resolveClientKey }: RateLimitOptions): MiddlewareHandler<HonoEnv> => {
  const window = slidingWindow({ name, windowMs, max });
  return async (ctx, next) => {
    const bucket = await key(ctx);
    if (bucket !== null) {
      const { allowed, retryAfterMs } = await window.hit(bucket);
      if (!allowed) {
        ctx.header('Retry-After', String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
        throw new AppError({ code: 'http:rate_limited', message: 'Too many requests, please slow down.' });
      }
    }
    await next();
  };
};
