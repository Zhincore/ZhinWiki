import { createHmac, randomBytes } from 'node:crypto';
import { keys as authKeys } from '@nibleaf/auth/keys.server';
import { logger } from '@nibleaf/logger';
import type { Redis } from 'ioredis';
import { markRedisUnhealthy, redisConfigured, sharedRedis } from './redis';

interface WindowHit {
  allowed: boolean;
  /** Milliseconds until enough in-window amounts expire to reopen; 0 when allowed. */
  retryAfterMs: number;
}

export interface SlidingWindow {
  /** Book `amount` for `key` unless its in-window total already reached `max`; 0 only checks. */
  hit: (key: string, amount?: number) => Promise<WindowHit>;
  /** Book `amount` for `key` regardless of its total. */
  record: (key: string, amount: number) => Promise<void>;
}

interface WindowOptions {
  /** Namespace of the window's shared keys; unique per limiter. */
  name: string;
  windowMs: number;
  max: number;
}

/** Hard bound on distinct buckets kept in memory per window — a spoofed-IP
 *  flood evicts the oldest buckets instead of growing the heap. */
const MAX_TRACKED_KEYS = 10_000;

interface Entry {
  at: number;
  amount: number;
}

/** Per-process sliding log of amounts; idle buckets are swept on a timer. */
export const memoryWindow = (windowMs: number, max: number): SlidingWindow => {
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

  /** In-window entries of `key`, pruned; evicts the oldest bucket for a new key when full. */
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
    hit: async (key, amount = 1) => {
      const now = Date.now();
      const entries = recent(key, now);
      let total = entries.reduce((sum, entry) => sum + entry.amount, 0);
      if (total >= max) {
        let reopensAt = now;
        for (const entry of entries) {
          total -= entry.amount;
          reopensAt = entry.at + windowMs;
          if (total < max) {
            break;
          }
        }
        return { allowed: false, retryAfterMs: reopensAt - now };
      }
      if (amount > 0) {
        entries.push({ at: now, amount });
      }
      return { allowed: true, retryAfterMs: 0 };
    },
    record: async (key, amount) => {
      const now = Date.now();
      recent(key, now).push({ at: now, amount });
    },
  };
};

/** Atomic sliding log over one sorted set scored by time, each member ending in
 *  its amount. Prunes, then (unless forced) sums the window and refuses at `max`
 *  with the time until enough of the oldest amounts expire; otherwise books
 *  the amount and expires the set with the window. */
const SLIDING_WINDOW_SCRIPT = `
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local max = tonumber(ARGV[3])
local amount = tonumber(ARGV[5])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window)
if ARGV[6] ~= '1' then
  local entries = redis.call('ZRANGE', KEYS[1], 0, -1, 'WITHSCORES')
  local total = 0
  for i = 1, #entries, 2 do
    total = total + tonumber(string.match(entries[i], ':(%d+)$'))
  end
  if total >= max then
    for i = 1, #entries, 2 do
      total = total - tonumber(string.match(entries[i], ':(%d+)$'))
      if total < max then
        return {0, tonumber(entries[i + 1]) + window - now}
      end
    end
  end
end
if amount > 0 then
  redis.call('ZADD', KEYS[1], now, ARGV[4])
  redis.call('PEXPIRE', KEYS[1], window)
end
return {1, 0}
`;

let bucketSecret: string | null = null;

/** Bucket ids are keyed with a secret derived from BETTER_AUTH_SECRET, so
 *  Redis holds pseudonyms that cannot be checked against guessed emails or IPs. */
const bucketKey = (name: string, key: string): string => {
  bucketSecret ??= createHmac('sha256', authKeys().BETTER_AUTH_SECRET).update('nibleaf:rate-limit').digest('hex');
  return `nibleaf:rate-limit:${name}:${createHmac('sha256', bucketSecret).update(key).digest('base64url').slice(0, 32)}`;
};

/** Sliding log shared by every replica through Redis. Rejects when Redis does;
 *  a failed or timed-out command also marks the shared connection unhealthy. */
export const redisWindow = ({ name, windowMs, max }: WindowOptions, connect: () => Promise<Redis> = sharedRedis): SlidingWindow => {
  const run = async (key: string, amount: number, force: boolean): Promise<WindowHit> => {
    const client = await connect();
    const now = Date.now();
    try {
      const [allowed, retryAfterMs] = (await client.eval(
        SLIDING_WINDOW_SCRIPT,
        1,
        bucketKey(name, key),
        now,
        windowMs,
        max,
        `${now}:${randomBytes(6).toString('base64url')}:${amount}`,
        amount,
        force ? 1 : 0,
      )) as [number, number];
      return { allowed: allowed === 1, retryAfterMs };
    } catch (error) {
      markRedisUnhealthy();
      throw error;
    }
  };
  return {
    hit: (key, amount = 1) => run(key, amount, false),
    record: async (key, amount) => {
      await run(key, amount, true);
    },
  };
};

let lastFallbackLog = 0;

/**
 * Redis-backed window when Redis is configured, falling back to this
 * process's memory while Redis is unreachable (degraded, never unlimited).
 */
export const slidingWindow = (options: WindowOptions, connect: () => Promise<Redis> = sharedRedis): SlidingWindow => {
  const memory = memoryWindow(options.windowMs, options.max);
  if (!redisConfigured()) {
    return memory;
  }
  const shared = redisWindow(options, connect);
  /** Runs `op` against Redis, or against this process's memory when Redis fails. */
  const fallback = async <T>(op: (window: SlidingWindow) => Promise<T>): Promise<T> => {
    try {
      return await op(shared);
    } catch (error) {
      if (Date.now() - lastFallbackLog > 60_000) {
        lastFallbackLog = Date.now();
        logger.warn({ error, limiter: options.name }, 'rate limit store unreachable; using per-process limits');
      }
      return op(memory);
    }
  };
  return {
    hit: (key, amount) => fallback((window) => window.hit(key, amount)),
    record: (key, amount) => fallback((window) => window.record(key, amount)),
  };
};
