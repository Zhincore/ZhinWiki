import { env } from '@/env';
import { markRedisUnhealthy, sharedRedis } from '@/lib/redis';

const day = (now: Date): string => now.toISOString().slice(0, 10);

/** Redis-backed project quota on the shared request-path connection. Fails
 * closed when the shared counter is unavailable so a Redis outage cannot turn
 * into unbounded provider spend. */
export const consumeAnswerQuota = async (projectId: string, now = new Date()): Promise<{ allowed: boolean; remaining: number }> => {
  const limit = env.SEARCH_ANSWER_DAILY_PER_PROJECT;
  if (limit === 0) return { allowed: false, remaining: 0 };
  const key = `{search-answer-quota}:${projectId}:${day(now)}`;
  const client = await sharedRedis();
  let current: number;
  try {
    current = Number(await client.eval("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],172800) end; return n", 1, key));
  } catch (error) {
    markRedisUnhealthy();
    throw error;
  }
  return { allowed: current <= limit, remaining: Math.max(0, limit - current) };
};
