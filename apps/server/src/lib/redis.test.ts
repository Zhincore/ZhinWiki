import { describe, expect, it } from 'vitest';
import { markRedisUnhealthy, sharedRedis } from './redis';

describe('shared Redis connection', () => {
  it('fails fast after a failed command instead of reconnecting per request', async () => {
    markRedisUnhealthy();
    await expect(sharedRedis()).rejects.toThrow(/paused/);
  });
});
