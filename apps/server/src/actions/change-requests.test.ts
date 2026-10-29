import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MergePage } from './change-request-merge';
import { contentHash, pageFingerprint } from './change-request-merge';

const mocks = vi.hoisted(() => {
  const tx = {
    $executeRaw: vi.fn(),
    branch: { create: vi.fn(), delete: vi.fn(), findFirst: vi.fn(), findFirstOrThrow: vi.fn() },
    changeRequest: { aggregate: vi.fn(), create: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
    page: { createMany: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  };
  class PrismaClientKnownRequestError extends Error {
    constructor(
      message: string,
      readonly code: string,
    ) {
      super(message);
    }
  }
  return {
    tx,
    PrismaClientKnownRequestError,
    prisma: {
      $transaction: vi.fn(async (run: (client: typeof tx) => unknown) => run(tx)),
      branch: { findFirst: vi.fn(), findMany: vi.fn() },
      changeRequest: { findUnique: vi.fn() },
    },
  };
});

vi.mock('@nibleaf/database', () => ({
  Prisma: { DbNull: 'DbNull', JsonNull: 'JsonNull', PrismaClientKnownRequestError: mocks.PrismaClientKnownRequestError },
  prisma: mocks.prisma,
}));

import { createBranch, createImportReplacementBranch } from './branches';
import { mergeChangeRequest } from './change-requests';

const { tx, prisma } = mocks;
const mainBranch = { id: 'main', projectId: 'p', isDefault: true };

const page = (id: string, overrides: Partial<MergePage> = {}): MergePage => ({
  id,
  languageId: 'en',
  parentId: null,
  kind: 'PAGE',
  title: id,
  slug: id,
  path: id,
  icon: null,
  description: null,
  content: `# ${id}`,
  config: null,
  translationKey: null,
  position: 0,
  hidden: false,
  sourcePageId: null,
  forkFingerprint: null,
  ...overrides,
});

const givenPages = (main: MergePage[], branch: MergePage[]) =>
  tx.page.findMany.mockImplementation(async ({ where }: { where: { branchId: string } }) => (where.branchId === 'main' ? main : branch));

describe('mergeChangeRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.changeRequest.findUnique.mockResolvedValue({ id: 'cr-1' });
    prisma.branch.findMany.mockResolvedValue([mainBranch]);
  });

  const givenChangeRequest = (forkBase: Record<string, string> | null) =>
    tx.changeRequest.findUniqueOrThrow.mockResolvedValue({ id: 'cr-1', number: 1, status: 'IN_REVIEW', branchId: 'cr', forkBase });

  it('writes an edited page onto the same main row and records the merge', async () => {
    const main = page('m1');
    givenChangeRequest({ m1: contentHash(main) });
    givenPages([main], [{ ...main, id: 'b1', sourcePageId: 'm1', forkFingerprint: pageFingerprint(main, null), content: '# edited' }]);
    await mergeChangeRequest('p', 1, 'user-1', []);
    expect(tx.page.update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { content: '# edited' } });
    expect(tx.page.deleteMany).not.toHaveBeenCalled();
    expect(tx.branch.delete).toHaveBeenCalledWith({ where: { id: 'cr' } });
    expect(tx.changeRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cr-1' },
        data: expect.objectContaining({
          status: 'MERGED',
          mergedById: 'user-1',
          mergeRecord: { pages: [expect.objectContaining({ pageId: 'm1', action: 'modified' })] },
        }),
      }),
    );
  });

  it('answers 409 with the conflicting pages and writes nothing', async () => {
    const main = page('m1');
    givenChangeRequest({ m1: contentHash(main) });
    givenPages(
      [{ ...main, content: '# main' }],
      [{ ...main, id: 'b1', sourcePageId: 'm1', forkFingerprint: pageFingerprint(main, null), content: '# branch' }],
    );
    await expect(mergeChangeRequest('p', 1, 'user-1', [])).rejects.toMatchObject({
      status: 409,
      details: { conflicts: [expect.objectContaining({ pageId: 'm1', reason: 'BOTH_CHANGED' })] },
    });
    expect(tx.page.update).not.toHaveBeenCalled();
    expect(tx.branch.delete).not.toHaveBeenCalled();
    expect(tx.changeRequest.update).not.toHaveBeenCalled();
  });

  it('refuses a change request merged in the meantime', async () => {
    tx.changeRequest.findUniqueOrThrow.mockResolvedValue({ id: 'cr-1', status: 'MERGED', branchId: null, forkBase: null });
    await expect(mergeChangeRequest('p', 1, 'user-1', [])).rejects.toMatchObject({ status: 409 });
    expect(tx.branch.delete).not.toHaveBeenCalled();
  });

  it('replaces main wholesale for an untracked change request', async () => {
    givenChangeRequest(null);
    givenPages([page('m1')], [page('b1')]);
    await mergeChangeRequest('p', 1, 'user-1', []);
    expect(tx.page.deleteMany).toHaveBeenCalledWith({ where: { projectId: 'p', branchId: 'main' } });
    expect(tx.page.updateMany).toHaveBeenCalledWith({ where: { projectId: 'p', branchId: 'cr' }, data: { branchId: 'main' } });
  });
});

describe('createBranch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tx.branch.findFirst.mockResolvedValue(null);
    tx.branch.findFirstOrThrow.mockResolvedValue(mainBranch);
    tx.branch.create.mockResolvedValue({ id: 'new-branch' });
    tx.page.findMany.mockResolvedValue([]);
  });

  it('numbers the change request after the highest one and retries a taken number', async () => {
    tx.changeRequest.aggregate.mockResolvedValueOnce({ _max: { number: 4 } }).mockResolvedValueOnce({ _max: { number: 5 } });
    tx.changeRequest.create.mockRejectedValueOnce(new mocks.PrismaClientKnownRequestError('unique', 'P2002')).mockResolvedValueOnce({});
    await createBranch('p', { title: 'Ada’s changes', authorId: 'user-1' });
    expect(tx.changeRequest.create.mock.calls.map(([args]) => args.data.number)).toEqual([5, 6]);
    expect(tx.branch.create).toHaveBeenLastCalledWith({ data: { projectId: 'p', name: 'cr-6', isDefault: false } });
  });

  it('links forked pages to their source', async () => {
    tx.changeRequest.aggregate.mockResolvedValue({ _max: { number: null } });
    const main = page('m1');
    tx.page.findMany.mockResolvedValue([main]);
    await createBranch('p', { title: 'Ada’s changes', authorId: 'user-1' });
    expect(tx.page.createMany.mock.calls[0]?.[0].data).toEqual([
      expect.objectContaining({ branchId: 'new-branch', sourcePageId: 'm1', forkFingerprint: pageFingerprint(main, null) }),
    ]);
    expect(tx.changeRequest.create.mock.calls[0]?.[0].data.forkBase).toEqual({ m1: contentHash(main) });
  });

  it('gives import replacement branches no change request or fork links', async () => {
    tx.page.findMany.mockResolvedValue([page('m1')]);
    await createImportReplacementBranch('p', 'gitbook', true);
    expect(tx.changeRequest.create).not.toHaveBeenCalled();
    expect(tx.page.createMany.mock.calls[0]?.[0].data[0]).not.toHaveProperty('sourcePageId');
  });
});
