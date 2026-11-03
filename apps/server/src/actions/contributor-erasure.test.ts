import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = { id: string; projectId: string; authorId: string; status: string; title: string };
type Where = { authorId: string; status?: { in: string[] }; title?: string };

const db = vi.hoisted(() => {
  const state = { changeRequests: [] as Row[], assets: [] as { projectId: string; createdById: string }[] };
  const matches = (row: Row, where: Where) =>
    row.authorId === where.authorId && (!where.status || where.status.in.includes(row.status)) && (!where.title || row.title === where.title);
  return {
    state,
    prisma: {
      changeRequest: {
        findMany: vi.fn(async ({ where }: { where: Where }) => state.changeRequests.filter((row) => matches(row, where))),
        updateMany: vi.fn(({ where, data }: { where: Where; data: Partial<Row> }) => () => {
          for (const row of state.changeRequests.filter((item) => matches(item, where))) Object.assign(row, data);
        }),
      },
      asset: {
        findMany: vi.fn(async ({ where }: { where: { createdById: string } }) => state.assets.filter((row) => row.createdById === where.createdById)),
      },
      $transaction: vi.fn(async (writes: (() => void)[]) => {
        for (const write of writes) write();
      }),
    },
  };
});

vi.mock('@nibleaf/database', () => ({ prisma: db.prisma }));
vi.mock('./assets', () => ({ cleanupContributorAssets: vi.fn() }));

import { cleanupContributorAssets } from './assets';
import { eraseUserContributions } from './contributor-erasure';

const user = { id: 'guest', name: 'Ada' };
const row = (id: string, projectId: string, status: string, title = 'Fix typo', authorId = user.id): Row => ({
  id,
  projectId,
  authorId,
  status,
  title,
});
const status = (id: string) => db.state.changeRequests.find((item) => item.id === id)?.status;

beforeEach(() => {
  vi.clearAllMocks();
  db.state.changeRequests = [
    row('draft', 'p1', 'DRAFT'),
    row('review', 'p2', 'IN_REVIEW', 'Ada’s changes'),
    row('merged', 'p3', 'MERGED', 'Modifications de Ada'),
    row('archived', 'p3', 'ARCHIVED'),
    row('other', 'p1', 'DRAFT', 'Ada’s changes', 'member'),
  ];
  db.state.assets = [
    { projectId: 'p1', createdById: user.id },
    { projectId: 'p4', createdById: user.id },
    { projectId: 'p5', createdById: 'member' },
  ];
});

describe('eraseUserContributions', () => {
  it('archives only the user’s open change requests', async () => {
    await eraseUserContributions(user);

    expect(status('draft')).toBe('ARCHIVED');
    expect(status('review')).toBe('ARCHIVED');
    expect(status('merged')).toBe('MERGED');
    expect(status('other')).toBe('DRAFT');
  });

  it('replaces the user’s name in default titles in any interface language', async () => {
    await eraseUserContributions(user);

    const titles = Object.fromEntries(db.state.changeRequests.map((item) => [item.id, item.title]));
    expect(titles).toMatchObject({ review: 'Someone’s changes', merged: 'Modifications de Quelqu’un', draft: 'Fix typo', other: 'Ada’s changes' });
  });

  it('cleans up uploads once per wiki with an open change request or an upload', async () => {
    await eraseUserContributions(user);

    expect(
      vi
        .mocked(cleanupContributorAssets)
        .mock.calls.map(([projectId]) => projectId)
        .sort(),
    ).toEqual(['p1', 'p2', 'p4']);
    expect(cleanupContributorAssets).toHaveBeenCalledWith('p1', user.id);
  });

  it('archives before cleaning up, so the user’s uploads no longer count as in flight', async () => {
    await eraseUserContributions(user);

    expect(vi.mocked(cleanupContributorAssets).mock.invocationCallOrder[0]).toBeGreaterThan(db.prisma.$transaction.mock.invocationCallOrder[0] ?? 0);
  });

  it('is a no-op on re-run once everything is closed and cleaned up', async () => {
    await eraseUserContributions(user);
    db.state.assets = [];
    vi.clearAllMocks();

    await eraseUserContributions(user);

    expect(cleanupContributorAssets).not.toHaveBeenCalled();
    expect(status('merged')).toBe('MERGED');
  });

  it('propagates a database failure without touching uploads', async () => {
    db.prisma.$transaction.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(eraseUserContributions(user)).rejects.toThrow('database unavailable');
    expect(cleanupContributorAssets).not.toHaveBeenCalled();
    expect(status('draft')).toBe('DRAFT');
  });
});
