import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ForkBase, MergePage } from './change-request-merge';
import { contentHash, pageFingerprint } from './change-request-merge';

const mocks = vi.hoisted(() => {
  const tx = {
    $executeRaw: vi.fn(),
    branch: { create: vi.fn(), delete: vi.fn(), findFirst: vi.fn(), findFirstOrThrow: vi.fn() },
    changeRequest: { aggregate: vi.fn(), count: vi.fn(), create: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
    page: { createMany: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    project: { findUniqueOrThrow: vi.fn() },
    changeRequestReviewer: { findMany: vi.fn() },
    changeRequestReview: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
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

const requested = new Date('2026-10-01T00:00:00Z');
const later = new Date('2026-10-02T00:00:00Z');

/** Reviewers `r1…` with their latest reviews; `members` are the ids still able to review. */
const givenReviews = (
  reviews: { authorId: string; state: string }[],
  options: { reviewers?: string[]; members?: string[]; config?: unknown } = {},
) => {
  const reviewers = options.reviewers ?? reviews.map((review) => review.authorId);
  const members = options.members ?? reviewers;
  const config = options.config ?? null;
  tx.project.findUniqueOrThrow.mockResolvedValue({ organizationId: 'org', config });
  tx.changeRequestReviewer.findMany.mockResolvedValue(reviewers.map((userId) => ({ userId, requestedAt: requested })));
  tx.changeRequestReview.findMany.mockResolvedValue(reviews.map((review) => ({ ...review, createdAt: later })));
  tx.user.findMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) =>
    where.id.in.map((id) => ({ id, role: 'user', members: members.includes(id) ? [{ id: `m-${id}` }] : [] })),
  );
};

describe('mergeChangeRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.changeRequest.findUnique.mockResolvedValue({ id: 'cr-1' });
    prisma.branch.findMany.mockResolvedValue([mainBranch]);
    givenReviews([{ authorId: 'r1', state: 'APPROVED' }]);
  });

  const givenChangeRequest = (forkBase: ForkBase) =>
    tx.changeRequest.findUniqueOrThrow.mockResolvedValue({ id: 'cr-1', number: 1, status: 'IN_REVIEW', branchId: 'cr', forkBase });

  it('writes an edited page onto the same main row and records the merge', async () => {
    const main = page('m1');
    givenChangeRequest({ m1: { hash: contentHash(main), copyId: 'b1' } });
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
    givenChangeRequest({ m1: { hash: contentHash(main), copyId: 'b1' } });
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

  it.each([
    ['without reviews', [], {}],
    [
      'while a reviewer requests changes',
      [
        { authorId: 'r1', state: 'APPROVED' },
        { authorId: 'r2', state: 'CHANGES_REQUESTED' },
      ],
      {},
    ],
    ['below the required approvals', [{ authorId: 'r1', state: 'APPROVED' }], { config: { changeRequests: { requiredApprovals: 2 } } }],
    ['with an approval from a former member', [{ authorId: 'r1', state: 'APPROVED' }], { members: [] as string[] }],
    ['with an approval from a removed reviewer', [{ authorId: 'r1', state: 'APPROVED' }], { reviewers: [] as string[] }],
  ])('refuses to merge %s', async (_label, reviews, options) => {
    givenChangeRequest(null);
    givenReviews(reviews, options);
    givenPages([page('m1')], [page('b1')]);
    await expect(mergeChangeRequest('p', 1, 'user-1', [])).rejects.toMatchObject({ status: 409, code: 'change_requests:review_required' });
    expect(tx.branch.delete).not.toHaveBeenCalled();
  });

  it('merges without reviews when the wiki requires none', async () => {
    givenChangeRequest(null);
    givenReviews([], { config: { changeRequests: { requiredApprovals: 0 } } });
    givenPages([page('m1')], [page('b1')]);
    await mergeChangeRequest('p', 1, 'user-1', []);
    expect(tx.branch.delete).toHaveBeenCalledWith({ where: { id: 'cr' } });
  });

  it('refuses to replace main while tracked change requests are open', async () => {
    givenChangeRequest(null);
    tx.changeRequest.count.mockResolvedValueOnce(1);
    givenPages([page('m1')], [page('b1')]);
    await expect(mergeChangeRequest('p', 1, 'user-1', [])).rejects.toMatchObject({ status: 409 });
    expect(tx.page.deleteMany).not.toHaveBeenCalled();
    expect(tx.branch.delete).not.toHaveBeenCalled();
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
    const [copy] = tx.page.createMany.mock.calls[0]?.[0].data ?? [];
    expect(tx.changeRequest.create.mock.calls[0]?.[0].data.forkBase).toEqual({ m1: { hash: contentHash(main), copyId: copy.id } });
  });

  it('refuses to import over a wiki with open tracked change requests', async () => {
    tx.changeRequest.count.mockResolvedValueOnce(1);
    await expect(createImportReplacementBranch('p', 'gitbook', true)).rejects.toMatchObject({ status: 409 });
    expect(tx.branch.create).not.toHaveBeenCalled();
  });

  it('gives import replacement branches no change request or fork links', async () => {
    tx.page.findMany.mockResolvedValue([page('m1')]);
    await createImportReplacementBranch('p', 'gitbook', true);
    expect(tx.changeRequest.create).not.toHaveBeenCalled();
    expect(tx.page.createMany.mock.calls[0]?.[0].data[0]).not.toHaveProperty('sourcePageId');
  });
});
