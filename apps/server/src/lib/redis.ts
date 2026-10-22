import { keys as bullmqKeys } from '@nibleaf/bullmq/keys';
import { Redis } from 'ioredis';

let client: Redis | null = null;

/**
 * Shared fail-fast client on the Dragonfly instance BullMQ uses. Commands
 * reject immediately while it is unreachable, so callers can degrade instead
 * of queueing up.
 */
export const getRedis = (): Redis => {
  if (!client) {
    const redisEnv = bullmqKeys();
    client = new Redis({
      host: redisEnv.REDIS_HOST,
      port: redisEnv.REDIS_PORT,
      db: redisEnv.REDIS_DB,
      ...(redisEnv.REDIS_PASSWORD ? { password: redisEnv.REDIS_PASSWORD } : {}),
      protocol: 2,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      retryStrategy: (times) => Math.min(times * 100, 2000),
    });
    // Connection errors surface as rejected commands; callers decide how to degrade.
    client.on('error', () => undefined);
  }
  return client;
};
