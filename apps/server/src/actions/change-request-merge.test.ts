import { describe, expect, it } from 'vitest';
import { type MergePage, pageFingerprint, planMerge, summarizeChanges } from './change-request-merge';

const before = new Date('2026-10-01T00:00:00Z');
const forkedAt = new Date('2026-10-02T00:00:00Z');
const after = new Date('2026-10-03T00:00:00Z');

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
  createdAt: before,
  updatedAt: before,
  ...overrides,
});

/** A change-request copy of `source` as `createBranch` makes it. */
const fork = (source: MergePage, id: string, parentId: string | null = null): MergePage => ({
  ...source,
  id,
  parentId,
  sourcePageId: source.id,
  forkFingerprint: pageFingerprint(source, source.parentId),
  createdAt: forkedAt,
  updatedAt: forkedAt,
});

const merged = (plan: ReturnType<typeof planMerge>) => {
  if (plan.legacy) throw new Error('expected a page merge');
  return plan;
};

describe('planMerge', () => {
  it('updates an edited page in place so its id, comments and grants stay', () => {
    const main = page('m1');
    const copy = { ...fork(main, 'b1'), content: '# edited' };
    const plan = merged(planMerge({ main: [main], branch: [copy], forkedAt, force: false }));
    expect(plan.conflicts).toEqual([]);
    expect(plan.updates).toEqual([{ id: 'm1', data: { content: '# edited' } }]);
    expect(plan.inserts).toEqual([]);
    expect(plan.deletes).toEqual([]);
  });

  it('leaves unchanged pages and main-only edits untouched', () => {
    const untouched = page('m1');
    const editedOnMain = page('m2', { position: 1 });
    const branch = [fork(untouched, 'b1'), fork(editedOnMain, 'b2')];
    const main = [untouched, { ...editedOnMain, content: '# main edit', updatedAt: after }];
    const plan = merged(planMerge({ main, branch, forkedAt, force: false }));
    expect(plan).toMatchObject({ conflicts: [], updates: [], inserts: [], deletes: [], record: [] });
  });

  it('keeps main pages created after the fork, even under a parent the branch deleted', () => {
    const parent = page('m1');
    const lateChild = page('m2', { parentId: 'm1', path: 'm1/m2', createdAt: after, updatedAt: after });
    const lateRoot = page('m3', { position: 1, createdAt: after, updatedAt: after });
    const plan = merged(planMerge({ main: [parent, lateChild, lateRoot], branch: [], forkedAt, force: false }));
    expect(plan.deletes).toEqual(['m1']);
    expect(plan.updates).toEqual([{ id: 'm2', data: { parentId: null, path: 'm2' } }]);
  });

  it('inserts pages created in the branch under the main parent, keeping their ids', () => {
    const parent = page('m1');
    const parentCopy = fork(parent, 'b1');
    const added = page('b2', { parentId: 'b1', slug: 'new', path: 'm1/new', createdAt: after });
    const plan = merged(planMerge({ main: [parent], branch: [parentCopy, added], forkedAt, force: false }));
    expect(plan.inserts).toEqual([{ id: 'b2', data: expect.objectContaining({ parentId: 'm1', slug: 'new', path: 'm1/new' }) }]);
  });

  it('refuses pages changed on both sides and lists them', () => {
    const main = page('m1', { path: 'guide/m1' });
    const copy = { ...fork(main, 'b1'), content: '# branch' };
    const plan = merged(planMerge({ main: [{ ...main, content: '# main', updatedAt: after }], branch: [copy], forkedAt, force: false }));
    expect(plan.conflicts).toEqual([{ pageId: 'm1', title: 'm1', path: 'guide/m1', languageId: 'en', reason: 'BOTH_CHANGED' }]);
    expect(plan.updates).toEqual([]);
  });

  it('reports deletions that race an edit on the other side', () => {
    const editedOnMain = page('m1');
    const deletedOnMain = page('m2', { position: 1 });
    const branch = [{ ...fork(deletedOnMain, 'b2'), sourcePageId: null, content: '# branch' }];
    const plan = merged(planMerge({ main: [{ ...editedOnMain, updatedAt: after }], branch, forkedAt, force: false }));
    expect(plan.conflicts.map(({ pageId, reason }) => ({ pageId, reason }))).toEqual([
      { pageId: 'b2', reason: 'DELETED_ON_MAIN' },
      { pageId: 'm1', reason: 'DELETED_IN_BRANCH' },
    ]);
  });

  it('lets the branch win only on conflicting pages when forced', () => {
    const conflicting = page('m1');
    const mainOnly = page('m2', { position: 1 });
    const branch = [{ ...fork(conflicting, 'b1'), content: '# branch' }, fork(mainOnly, 'b2')];
    const main = [
      { ...conflicting, content: '# main', updatedAt: after },
      { ...mainOnly, content: '# main only', updatedAt: after },
    ];
    const plan = merged(planMerge({ main, branch, forkedAt, force: true }));
    expect(plan.conflicts.map((conflict) => conflict.pageId)).toEqual(['m1']);
    expect(plan.updates).toEqual([{ id: 'm1', data: { content: '# branch' } }]);
  });

  it('takes the tree from the branch only for pages the branch moved', () => {
    const a = page('m1');
    const b = page('m2', { position: 1 });
    const branch = [fork(a, 'b1'), { ...fork(b, 'b2', 'b1'), content: '# moved' }];
    const main = [{ ...a, position: 5, updatedAt: after }, b];
    const plan = merged(planMerge({ main, branch, forkedAt, force: false }));
    expect(plan.updates).toEqual([{ id: 'm2', data: { parentId: 'm1', content: '# moved', path: 'm1/m2' } }]);
  });

  it('renames an inserted page whose slug a sibling took on main', () => {
    const late = page('m1', { slug: 'faq', path: 'faq', createdAt: after });
    const added = page('b1', { slug: 'faq', path: 'faq', createdAt: after });
    const plan = merged(planMerge({ main: [late], branch: [added], forkedAt, force: false }));
    expect(plan.inserts).toEqual([{ id: 'b1', data: expect.objectContaining({ slug: 'faq-2', path: 'faq-2' }) }]);
  });

  it('replaces main for branches without fork links', () => {
    const plan = planMerge({ main: [page('m1')], branch: [page('b1', { createdAt: after })], forkedAt, force: false });
    expect(plan).toEqual({ legacy: true });
  });

  it('merges unlinked pages per page when main was empty at the fork', () => {
    const plan = merged(
      planMerge({ main: [page('m1', { createdAt: after })], branch: [page('b1', { slug: 'b1', createdAt: after })], forkedAt, force: false }),
    );
    expect(plan.inserts.map((insert) => insert.id)).toEqual(['b1']);
    expect(plan.deletes).toEqual([]);
  });
});

describe('summarizeChanges', () => {
  it('classifies added, removed, modified and moved pages by id', () => {
    const edited = page('m1');
    const moved = page('m2', { position: 1 });
    const removed = page('m3', { position: 2 });
    const branch = [{ ...fork(edited, 'b1'), title: 'Edited' }, { ...fork(moved, 'b2'), position: 7 }, page('b4', { createdAt: after })];
    const changes = summarizeChanges({ main: [edited, moved, removed], branch, forkedAt });
    expect(changes.map(({ change, mainPageId, branchPageId }) => [change, mainPageId, branchPageId])).toEqual([
      ['modified', 'm1', 'b1'],
      ['moved', 'm2', 'b2'],
      ['added', null, 'b4'],
      ['removed', 'm3', null],
    ]);
  });
});
