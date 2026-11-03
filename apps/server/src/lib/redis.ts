import { keys as redisKeys } from '@nibleaf/bullmq/keys';
import { Redis } from 'ioredis';

/** Pause before reconnecting after a failed attempt, so an outage costs one
 *  connect timeout per pause instead of one per request. */
const RECONNECT_PAUSE_MS = 5000;

let redis: Redis | null = null;
let connecting: Promise<Redis> | null = null;
let pausedUntil = 0;

/** Whether shared request state (rate limits, captcha replay) lives in Redis:
 *  only when REDIS_HOST is set, otherwise each process keeps it in memory. */
export const redisConfigured = (): boolean => Boolean(process.env.REDIS_HOST?.trim());

/**
 * Fail-fast connection for request-path state. Rejects instead of buffering
 * while Redis is unreachable; concurrent first callers share one attempt.
 */
export const sharedRedis = (): Promise<Redis> => {
  if (redis?.status === 'ready') return Promise.resolve(redis);
  if (connecting) return connecting;
  if (Date.now() < pausedUntil) return Promise.reject(new Error('Redis reconnect paused'));
  redis?.disconnect();
  const env = redisKeys();
  const client = new Redis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    db: env.REDIS_DB,
    ...(env.REDIS_PASSWORD ? { password: env.REDIS_PASSWORD } : {}),
    protocol: 2,
    enableOfflineQueue: false,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
    commandTimeout: 2000,
    retryStrategy: () => null,
  });
  redis = client;
  client.on('error', () => undefined);
  connecting = client
    .connect()
    .then(() => client)
    .catch((error: unknown) => {
      pausedUntil = Date.now() + RECONNECT_PAUSE_MS;
      throw error;
    })
    .finally(() => {
      connecting = null;
    });
  return connecting;
};

/** Drops a connection whose command failed or timed out and pauses
 *  reconnecting, so a hung Redis costs one timeout per pause, not per request. */
export const markRedisUnhealthy = (): void => {
  pausedUntil = Date.now() + RECONNECT_PAUSE_MS;
  redis?.disconnect();
  redis = null;
};
