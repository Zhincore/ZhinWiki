import { beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({ createMany: vi.fn() }));
vi.mock('@nibleaf/database', () => ({ prisma: { platformEvent: database } }));

import { recordPublishReady } from './publish-activation';

const job = { deploymentId: 'deployment-a', projectId: 'project-a', auto: false } as const;
const ready = { createdById: 'author-a', version: 2, completedAt: new Date('2026-09-01T00:00:00Z') };

describe('manual publish receipts', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    database.createMany.mockResolvedValue({ count: 1 });
  });

  it('writes one replay-safe receipt per deployment', async () => {
    await recordPublishReady(job, ready);
    expect(database.createMany).toHaveBeenCalledExactlyOnceWith({
      data: {
        id: 'publish-ready:deployment-a',
        type: 'publish_ready',
        userId: 'author-a',
        projectId: 'project-a',
        metadata: { auto: false, version: 2 },
        createdAt: ready.completedAt,
      },
      skipDuplicates: true,
    });
  });

  it.each([true, undefined])('marks non-explicit manual jobs as auto (auto=%s)', async (auto) => {
    await recordPublishReady({ ...job, auto }, ready);
    expect(database.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ metadata: { auto: true, version: 2 } }) }),
    );
  });

  it('propagates receipt persistence failure for a retry instead of acknowledging delivery', async () => {
    database.createMany.mockRejectedValue(new Error('database unavailable'));
    await expect(recordPublishReady(job, ready)).rejects.toThrow('database unavailable');
  });
});
