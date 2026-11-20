import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ sharedRedis: vi.fn(), markRedisUnhealthy: vi.fn(), eval: vi.fn() }));
vi.mock('@/env', () => ({ env: { SEARCH_ANSWER_DAILY_PER_PROJECT: 2 } }));
vi.mock('@/lib/redis', () => ({ sharedRedis: mocks.sharedRedis, markRedisUnhealthy: mocks.markRedisUnhealthy }));

import { consumeAnswerQuota } from './quota';

describe('answer quota', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sharedRedis.mockResolvedValue({ eval: mocks.eval });
    mocks.eval.mockResolvedValue(1);
  });

  it('counts on the shared connection and refuses past the daily limit', async () => {
    await expect(consumeAnswerQuota('project-a')).resolves.toEqual({ allowed: true, remaining: 1 });
    expect(mocks.eval).toHaveBeenCalledWith(expect.stringContaining('INCR'), 1, expect.stringContaining('project-a'));
    mocks.eval.mockResolvedValueOnce(3);
    await expect(consumeAnswerQuota('project-a')).resolves.toEqual({ allowed: false, remaining: 0 });
  });

  it('fails closed while the shared connection is unavailable', async () => {
    mocks.sharedRedis.mockRejectedValueOnce(new Error('Redis reconnect paused'));
    await expect(consumeAnswerQuota('project-a')).rejects.toThrow('Redis reconnect paused');
    expect(mocks.eval).not.toHaveBeenCalled();
  });

  it('marks the shared connection unhealthy when the counter command fails', async () => {
    mocks.eval.mockRejectedValueOnce(new Error('Command timed out'));
    await expect(consumeAnswerQuota('project-a')).rejects.toThrow('Command timed out');
    expect(mocks.markRedisUnhealthy).toHaveBeenCalledOnce();
  });
});
