import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  count: vi.fn(),
  create: vi.fn(),
  findMany: vi.fn(),
  findFirst: vi.fn(),
  createMany: vi.fn(),
  queryRaw: vi.fn(),
}));

vi.mock('@nibleaf/database', () => ({
  prisma: {
    $queryRaw: mocks.queryRaw,
    platformEvent: {
      count: mocks.count,
      create: mocks.create,
      findMany: mocks.findMany,
      findFirst: mocks.findFirst,
      createMany: mocks.createMany,
    },
  },
}));

import { getActivationFunnel, logFirstContentEdit } from './platform-events';

describe('platform events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.create.mockResolvedValue({ id: 'event' });
    mocks.findFirst.mockResolvedValue(null);
    mocks.createMany.mockResolvedValue({ count: 1 });
    mocks.queryRaw.mockResolvedValue([{ observationStart: null, firstManualPublishes: 0, cohortSize: 0, retained: 0 }]);
  });

  it('preserves historical edit receipts and retries after a failed write', async () => {
    mocks.findFirst.mockResolvedValueOnce({ id: 'legacy-random-id' });
    logFirstContentEdit('author', 'project');
    await vi.waitFor(() => expect(mocks.findFirst).toHaveBeenCalledOnce());
    expect(mocks.createMany).not.toHaveBeenCalled();

    mocks.createMany.mockRejectedValueOnce(new Error('temporary failure'));
    logFirstContentEdit('author', 'new-project');
    await vi.waitFor(() => expect(mocks.createMany).toHaveBeenCalledOnce());
    logFirstContentEdit('author', 'new-project');
    await vi.waitFor(() => expect(mocks.createMany).toHaveBeenCalledTimes(2));
    expect(mocks.createMany).toHaveBeenLastCalledWith({
      data: { id: 'page-edited:author:new-project', type: 'page_edited', userId: 'author', projectId: 'new-project' },
      skipDuplicates: true,
    });
  });

  it('aggregates the activation funnel from user receipts', async () => {
    const at = (minute: number) => new Date(`2026-08-31T00:${String(minute).padStart(2, '0')}:00.000Z`);
    mocks.count.mockResolvedValue(2);
    mocks.findMany.mockImplementation(async ({ where, select }: { where: Record<string, unknown>; select: Record<string, unknown> }) => {
      const type = where.type;
      if (type === 'signup_completed' && 'createdAt' in select) return [{ userId: 'user-1', createdAt: at(0) }];
      if (type === 'publish_ready' && 'createdAt' in select) {
        return [
          { userId: 'user-1', createdAt: at(5) },
          { userId: 'user-2', createdAt: at(8) },
        ];
      }
      return [{ userId: 'user-1' }];
    });

    const result = await getActivationFunnel(30);

    expect(result).toMatchObject({ days: 30, signups: 2, edited: 1, published: 1, ready: 1 });
    expect(result.publishRetention).toMatchObject({ firstManualPublishes: null, cohortSize: null, retained: null, rate: null });
  });
});
