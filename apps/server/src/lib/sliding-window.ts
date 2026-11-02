import { createHash, randomBytes } from 'node:crypto';
import { logger } from '@nibleaf/logger';
import type { Redis } from 'ioredis';
import { redisConfigured, sharedRedis } from './redis';

interface WindowHit {
  allowed: boolean;
  /** Milliseconds until the oldest in-window hit expires; 0 when allowed. */
  retryAfterMs: number;
}

export interface SlidingWindow {
  /** Record one hit for `key` unless its window is already full. */
  hit: (key: string) => Promise<WindowHit>;
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

/** Per-process sliding log; idle buckets are swept on a timer. */
export const memoryWindow = (windowMs: number, max: number): SlidingWindow => {
  const hits = new Map<string, number[]>();

  // unref() keeps the sweep timer from holding the process open.
  const sweep = () => {
    const cutoff = Date.now() - windowMs;
    for (const [key, stamps] of hits) {
      if ((stamps[stamps.length - 1] ?? 0) <= cutoff) {
        hits.delete(key);
      }
    }
  };
  setInterval(sweep, Math.max(windowMs, 30_000)).unref();

  return {
    hit: async (key) => {
      const now = Date.now();
      if (!hits.has(key) && hits.size >= MAX_TRACKED_KEYS) {
        const oldest = hits.keys().next();
        if (!oldest.done) {
          hits.delete(oldest.value);
        }
      }
      const recent = (hits.get(key) ?? []).filter((ts) => ts > now - windowMs);
      if (recent.length >= max) {
        hits.set(key, recent);
        return { allowed: false, retryAfterMs: (recent[0] ?? now) + windowMs - now };
      }
      recent.push(now);
      hits.set(key, recent);
      return { allowed: true, retryAfterMs: 0 };
    },
  };
};

/** Atomic sliding log over one sorted set: prune, count, then admit or report
 *  the oldest hit. The set holds at most `max` members and expires with the window. */
const SLIDING_WINDOW_SCRIPT = `
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window)
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[3]) then
  local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  return {0, tonumber(oldest[2]) + window - now}
end
redis.call('ZADD', KEYS[1], now, ARGV[4])
redis.call('PEXPIRE', KEYS[1], window)
return {1, 0}
`;

/** Bucket ids are hashed so emails and IPs never reach Redis in clear text. */
const bucketKey = (name: string, key: string): string =>
  `nibleaf:rate-limit:${name}:${createHash('sha256').update(key).digest('base64url').slice(0, 32)}`;

/** Sliding log shared by every replica through Redis. Rejects when Redis does. */
export const redisWindow = ({ name, windowMs, max }: WindowOptions, connect: () => Promise<Redis> = sharedRedis): SlidingWindow => ({
  hit: async (key) => {
    const client = await connect();
    const now = Date.now();
    const [allowed, retryAfterMs] = (await client.eval(
      SLIDING_WINDOW_SCRIPT,
      1,
      bucketKey(name, key),
      now,
      windowMs,
      max,
      `${now}:${randomBytes(6).toString('base64url')}`,
    )) as [number, number];
    return { allowed: allowed === 1, retryAfterMs };
  },
});

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
  return {
    hit: async (key) => {
      try {
        return await shared.hit(key);
      } catch (error) {
        if (Date.now() - lastFallbackLog > 60_000) {
          lastFallbackLog = Date.now();
          logger.warn({ error, limiter: options.name }, 'rate limit store unreachable; using per-process limits');
        }
        return memory.hit(key);
      }
    },
  };
};
