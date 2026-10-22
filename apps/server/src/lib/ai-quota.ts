import { env } from '@/env';
import { AppError } from '@/errors';
import { envExtras } from './env-extras';
import { getRedis } from './redis';

/**
 * Per-workspace daily quota for the AI draft endpoint — the only place the
 * platform spends money per request, so it must be bounded. Backed by a redis
 * INCR with a 24h TTL (same Dragonfly instance BullMQ uses). Only enforced
 * when OPENROUTER_API_KEY is configured: the deterministic offline fallback is
 * free and stays unlimited.
 */

const DAY_SECONDS = 24 * 60 * 60;

/**
 * Count one AI request against the workspace's daily budget and throw a 429
 * once it is exhausted. Redis being unreachable fails OPEN (the request is
 * allowed): the quota is spend protection, not a security boundary, and AI
 * drafting must not hard-depend on redis for self-hosters.
 */
export const assertAiQuota = async (organizationId: string): Promise<void> => {
  if (!env.OPENROUTER_API_KEY) {
    return; // Offline fallback only — nothing to meter.
  }
  const limit = envExtras.AI_DAILY_LIMIT;
  const day = new Date().toISOString().slice(0, 10);
  const key = `nibleaf:ai-quota:${organizationId}:${day}`;

  let used: number;
  try {
    const redis = getRedis();
    used = await redis.incr(key);
    if (used === 1) {
      await redis.expire(key, DAY_SECONDS);
    }
  } catch {
    return;
  }

  if (used > limit) {
    throw new AppError({
      code: 'http:rate_limited',
      message: `This workspace has reached its daily AI limit of ${limit} requests. The counter resets within 24 hours.`,
      details: { limit, scope: 'workspace', period: 'day' },
    });
  }
};
