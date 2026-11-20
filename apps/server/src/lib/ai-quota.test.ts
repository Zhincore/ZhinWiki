import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ sharedRedis: vi.fn(), markRedisUnhealthy: vi.fn(), incr: vi.fn(), expire: vi.fn() }));
vi.mock('./env-extras', () => ({ envExtras: { AI_DAILY_LIMIT: 2 } }));
vi.mock('./redis', () => ({ sharedRedis: mocks.sharedRedis, markRedisUnhealthy: mocks.markRedisUnhealthy }));

import { assertAiQuota } from './ai-quota';

describe('assertAiQuota', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sharedRedis.mockResolvedValue({ incr: mocks.incr, expire: mocks.expire });
    mocks.expire.mockResolvedValue(1);
  });

  it('starts the daily window on the first request and refuses past the limit', async () => {
    mocks.incr.mockResolvedValueOnce(1).mockResolvedValueOnce(2).mockResolvedValueOnce(3);
    await expect(assertAiQuota('org-1')).resolves.toBeUndefined();
    expect(mocks.expire).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('org-1'), 24 * 60 * 60);
    await expect(assertAiQuota('org-1')).resolves.toBeUndefined();
    await expect(assertAiQuota('org-1')).rejects.toMatchObject({ code: 'http:rate_limited', details: { limit: 2 } });
    expect(mocks.expire).toHaveBeenCalledOnce();
  });

  it('fails open while the shared connection is unavailable', async () => {
    mocks.sharedRedis.mockRejectedValueOnce(new Error('Redis reconnect paused'));
    await expect(assertAiQuota('org-1')).resolves.toBeUndefined();
    expect(mocks.markRedisUnhealthy).not.toHaveBeenCalled();
  });

  it('fails open and marks the shared connection unhealthy when the counter command fails', async () => {
    mocks.incr.mockRejectedValueOnce(new Error('Command timed out'));
    await expect(assertAiQuota('org-1')).resolves.toBeUndefined();
    expect(mocks.markRedisUnhealthy).toHaveBeenCalledOnce();
  });
});
