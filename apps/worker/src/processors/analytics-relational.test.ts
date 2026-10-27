import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  analyticsUpsert: vi.fn(),
  projectFindUnique: vi.fn(),
  resolveAnalyticsHashSalt: vi.fn(),
}));

vi.mock('@nibleaf/bullmq', () => ({ createJob: vi.fn(), getJob: vi.fn(), QueueNames: { ANALYTICS: 'analytics' } }));
vi.mock('@nibleaf/clickhouse', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@nibleaf/clickhouse')>()),
  keys: () => ({ ANALYTICS_MODE: 'disabled', ANALYTICS_HASH_SALT: undefined }),
}));
vi.mock('@nibleaf/database', () => ({
  resolveAnalyticsHashSalt: mocks.resolveAnalyticsHashSalt,
  prisma: {
    analyticsEvent: { upsert: mocks.analyticsUpsert },
    project: { findUnique: mocks.projectFindUnique },
  },
}));

import { handleAnalyticsJobs } from './analytics';

const legacyJob = {
  kind: 'track-event',
  projectId: 'project-a',
  type: 'pageview',
  path: 'guides/start',
  referrer: null,
  query: null,
  sessionId: 'reader-session',
  country: 'sa',
  device: 'desktop',
  language: 'en',
  createdAt: '2026-10-27T00:00:00.000Z',
};

describe('relational-only analytics worker path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveAnalyticsHashSalt.mockResolvedValue('instance-salt');
    mocks.projectFindUnique.mockResolvedValue({ accessMode: 'PUBLIC', config: null, organizationId: 'org-a' });
    mocks.analyticsUpsert.mockResolvedValue(undefined);
  });

  it('hashes legacy reader sessions with the resolved instance salt when ANALYTICS_HASH_SALT is unset', async () => {
    await expect(handleAnalyticsJobs({ name: 'track-event', data: legacyJob, id: 'legacy-a' } as never)).resolves.toEqual({ inserted: 1 });
    expect(mocks.resolveAnalyticsHashSalt).toHaveBeenCalledWith(undefined);
    const expected = createHmac('sha256', 'instance-salt').update('session:reader-session').digest('hex');
    expect(mocks.analyticsUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ type: 'pageview', sessionId: expected }) }),
    );
  });

  it('retries the job when the instance salt cannot be loaded', async () => {
    mocks.resolveAnalyticsHashSalt.mockRejectedValueOnce(new Error('postgres down'));
    await expect(handleAnalyticsJobs({ name: 'track-event', data: legacyJob, id: 'legacy-b' } as never)).rejects.toThrow('postgres down');
    expect(mocks.analyticsUpsert).not.toHaveBeenCalled();
  });
});
