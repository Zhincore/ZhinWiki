import { describe, expect, it } from 'vitest';
import { contentHash, type MergePage, pageFingerprint, planMerge, summarizeChanges } from './change-request-merge';

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

/** A change-request copy of `source` as `createBranch` makes it. */
const fork = (source: MergePage, id: string, parentId: string | null = null): MergePage => ({
  ...source,
  id,
  parentId,
  sourcePageId: source.id,
  forkFingerprint: pageFingerprint(source, source.parentId),
});

/** The fork base `createBranch` stores for these main pages. */
const baseOf = (...pages: MergePage[]) => Object.fromEntries(pages.map((p) => [p.id, contentHash(p)]));

const none = new Set<string>();

const merged = (plan: ReturnType<typeof planMerge>) => {
  if (plan.legacy) throw new Error('expected a page merge');
  return plan;
};

describe('planMerge', () => {
  it('updates an edited page in place so its id, comments and grants stay', () => {
    const main = page('m1');
    const copy = { ...fork(main, 'b1'), content: '# edited' };
    const plan = merged(planMerge({ main: [main], branch: [copy], forkBase: baseOf(main), force: none }));
    expect(plan.conflicts).toEqual([]);
    expect(plan.updates).toEqual([{ id: 'm1', data: { content: '# edited' } }]);
    expect(plan.inserts).toEqual([]);
    expect(plan.deletes).toEqual([]);
  });

  it('applies a reorder without undoing a move made on main', () => {
    const groupA = page('ga');
    const groupB = page('gb', { position: 1 });
    const child = page('x', { parentId: 'ga', path: 'ga/x' });
    const branch = [fork(groupA, 'ba'), fork(groupB, 'bb'), { ...fork(child, 'bx', 'ba'), position: 3 }];
    const main = [groupA, groupB, { ...child, parentId: 'gb', path: 'gb/x' }];
    const plan = merged(planMerge({ main, branch, forkBase: baseOf(groupA, groupB, child), force: none }));
    expect(plan.conflicts).toEqual([]);
    expect(plan.updates).toEqual([{ id: 'x', data: { position: 3 } }]);
  });

  it('leaves unchanged pages and main-only edits untouched', () => {
    const untouched = page('m1');
    const editedOnMain = page('m2', { position: 1 });
    const branch = [fork(untouched, 'b1'), fork(editedOnMain, 'b2')];
    const main = [untouched, { ...editedOnMain, content: '# main edit' }];
    const plan = merged(planMerge({ main, branch, forkBase: baseOf(untouched, editedOnMain), force: none }));
    expect(plan).toMatchObject({ conflicts: [], updates: [], inserts: [], deletes: [], record: [] });
  });

  it('keeps main pages created after the fork, even under a parent the branch deleted', () => {
    const parent = page('m1');
    const lateChild = page('m2', { parentId: 'm1', path: 'm1/m2' });
    const lateRoot = page('m3', { position: 1 });
    const plan = merged(planMerge({ main: [parent, lateChild, lateRoot], branch: [], forkBase: baseOf(parent), force: none }));
    expect(plan.deletes).toEqual(['m1']);
    expect(plan.updates).toEqual([{ id: 'm2', data: { parentId: null, path: 'm2' } }]);
  });

  it('keeps a page an earlier change request merged after this one was opened', () => {
    const forked = page('m1');
    const mergedEarlier = page('x1', { position: 1 });
    const plan = merged(planMerge({ main: [forked, mergedEarlier], branch: [fork(forked, 'b1')], forkBase: baseOf(forked), force: none }));
    expect(plan).toMatchObject({ conflicts: [], deletes: [], updates: [] });
    expect(summarizeChanges({ main: [forked, mergedEarlier], branch: [fork(forked, 'b1')], forkBase: baseOf(forked) })).toEqual([]);
  });

  it('inserts pages created in the branch under the main parent, keeping their ids', () => {
    const parent = page('m1');
    const parentCopy = fork(parent, 'b1');
    const added = page('b2', { parentId: 'b1', slug: 'new', path: 'm1/new' });
    const plan = merged(planMerge({ main: [parent], branch: [parentCopy, added], forkBase: baseOf(parent), force: none }));
    expect(plan.inserts).toEqual([{ id: 'b2', data: expect.objectContaining({ parentId: 'm1', slug: 'new', path: 'm1/new' }) }]);
  });

  it('inserts a new page under the nearest surviving ancestor when main deleted its parent', () => {
    const top = page('m1');
    const parent = page('m2', { parentId: 'm1', path: 'm1/m2' });
    const branch = [fork(top, 'b1'), fork(parent, 'b2', 'b1'), page('b3', { parentId: 'b2', slug: 'new', path: 'm1/m2/new' })];
    const plan = merged(planMerge({ main: [top], branch, forkBase: baseOf(top, parent), force: none }));
    expect(plan.conflicts).toEqual([]);
    expect(plan.inserts).toEqual([{ id: 'b3', data: expect.objectContaining({ parentId: 'm1', path: 'm1/new' }) }]);
  });

  it('refuses pages changed on both sides and lists them', () => {
    const main = page('m1', { path: 'guide/m1' });
    const copy = { ...fork(main, 'b1'), content: '# branch' };
    const plan = merged(planMerge({ main: [{ ...main, content: '# main' }], branch: [copy], forkBase: baseOf(main), force: none }));
    expect(plan.blocked).toBe(true);
    expect(plan.conflicts).toEqual([{ pageId: 'm1', title: 'm1', path: 'guide/m1', languageId: 'en', reason: 'BOTH_CHANGED' }]);
    expect(plan.updates).toEqual([]);
  });

  it('treats re-wrapped paragraphs as unchanged on either side', () => {
    const wrapped = 'First line\nwrapped.\n\nSecond.\n';
    const rewrapped = page('m1', { content: wrapped });
    const edited = page('m2', { content: wrapped, position: 1 });
    const branch = [
      { ...fork(rewrapped, 'b1'), content: 'First line wrapped.\n\nSecond.' },
      { ...fork(edited, 'b2'), content: 'First line wrapped.\n\nSecond, edited.' },
    ];
    const main = [rewrapped, { ...edited, content: 'First line wrapped.\n\nSecond.' }];
    const plan = merged(planMerge({ main, branch, forkBase: baseOf(rewrapped, edited), force: none }));
    expect(plan.conflicts).toEqual([]);
    expect(plan.updates).toEqual([{ id: 'm2', data: expect.objectContaining({ content: 'First line wrapped.\n\nSecond, edited.' }) }]);
  });

  it('reports deletions that race an edit on the other side', () => {
    const editedOnMain = page('m1');
    const deletedOnMain = page('m2', { position: 1 });
    const branch = [{ ...fork(deletedOnMain, 'b2'), sourcePageId: null, content: '# branch' }];
    const main = [{ ...editedOnMain, content: '# main' }];
    const plan = merged(planMerge({ main, branch, forkBase: baseOf(editedOnMain, deletedOnMain), force: none }));
    expect(plan.conflicts.map(({ pageId, reason }) => ({ pageId, reason }))).toEqual([
      { pageId: 'b2', reason: 'DELETED_ON_MAIN' },
      { pageId: 'm1', reason: 'DELETED_IN_BRANCH' },
    ]);
  });

  it('lets the branch win only on the forced pages', () => {
    const conflicting = page('m1');
    const mainOnly = page('m2', { position: 1 });
    const branch = [{ ...fork(conflicting, 'b1'), content: '# branch' }, fork(mainOnly, 'b2')];
    const main = [
      { ...conflicting, content: '# main' },
      { ...mainOnly, content: '# main only' },
    ];
    const plan = merged(planMerge({ main, branch, forkBase: baseOf(conflicting, mainOnly), force: new Set(['m1']) }));
    expect(plan.blocked).toBe(false);
    expect(plan.conflicts.map((conflict) => conflict.pageId)).toEqual(['m1']);
    expect(plan.updates).toEqual([{ id: 'm1', data: { content: '# branch' } }]);
  });

  it('stays blocked when a conflict outside the forced pages appears', () => {
    const first = page('m1');
    const second = page('m2', { position: 1 });
    const branch = [
      { ...fork(first, 'b1'), content: '# branch' },
      { ...fork(second, 'b2'), content: '# branch' },
    ];
    const main = [
      { ...first, content: '# main' },
      { ...second, content: '# main' },
    ];
    const plan = merged(planMerge({ main, branch, forkBase: baseOf(first, second), force: new Set(['m1']) }));
    expect(plan.blocked).toBe(true);
    expect(plan.conflicts.map((conflict) => conflict.pageId)).toEqual(['m1', 'm2']);
    expect(plan.updates).toEqual([]);
  });

  it('takes the tree from the branch only for pages the branch moved', () => {
    const a = page('m1');
    const b = page('m2', { position: 1 });
    const branch = [fork(a, 'b1'), { ...fork(b, 'b2', 'b1'), content: '# moved' }];
    const main = [{ ...a, position: 5 }, b];
    const plan = merged(planMerge({ main, branch, forkBase: baseOf(a, b), force: none }));
    expect(plan.updates).toEqual([{ id: 'm2', data: { parentId: 'm1', content: '# moved', path: 'm1/m2' } }]);
  });

  it('keeps main’s parent for a branch move that would close a loop', () => {
    const a = page('m1');
    const b = page('m2', { position: 1 });
    const main = [{ ...a, parentId: 'm2', path: 'm2/m1' }, b];
    const branch = [fork(a, 'b1'), fork(b, 'b2', 'b1')];
    const plan = merged(planMerge({ main, branch, forkBase: baseOf(a, b), force: none }));
    expect(plan.updates.filter((update) => 'parentId' in update.data)).toEqual([]);
  });

  it('renames an inserted page whose slug a sibling took on main', () => {
    const late = page('m1', { slug: 'faq', path: 'faq' });
    const added = page('b1', { slug: 'faq', path: 'faq' });
    const plan = merged(planMerge({ main: [late], branch: [added], forkBase: {}, force: none }));
    expect(plan.inserts).toEqual([{ id: 'b1', data: expect.objectContaining({ slug: 'faq-2', path: 'faq-2' }) }]);
  });

  it('renames a kept child that moves up beside a sibling with its slug', () => {
    const parent = page('m1');
    const lateChild = page('m2', { parentId: 'm1', slug: 'faq', path: 'm1/faq' });
    const rootFaq = page('m3', { slug: 'faq', path: 'faq', position: 1 });
    const plan = merged(
      planMerge({ main: [parent, lateChild, rootFaq], branch: [fork(rootFaq, 'b3')], forkBase: baseOf(parent, rootFaq), force: none }),
    );
    expect(plan.updates).toEqual([{ id: 'm2', data: { parentId: null, slug: 'faq-2', path: 'faq-2' } }]);
  });

  it('merges a rewrite that replaced every forked page per page', () => {
    const old = page('m1');
    const late = page('m2', { position: 1 });
    const plan = merged(planMerge({ main: [old, late], branch: [page('b1', { slug: 'new' })], forkBase: baseOf(old), force: none }));
    expect(plan.inserts.map((insert) => insert.id)).toEqual(['b1']);
    expect(plan.deletes).toEqual(['m1']);
  });

  it('replaces main for untracked branches and records only differing pages', () => {
    const same = page('m1');
    const edited = page('m2', { position: 1 });
    const plan = planMerge({
      main: [same, edited, page('m3')],
      branch: [{ ...same, id: 'b1' }, { ...edited, id: 'b2', content: '# new' }, page('b4')],
      forkBase: null,
      force: none,
    });
    if (!plan.legacy) throw new Error('expected replace-all');
    expect(plan.record.map(({ pageId, action }) => [pageId, action])).toEqual([
      ['b2', 'modified'],
      ['b4', 'added'],
      ['m3', 'removed'],
    ]);
  });
});

describe('summarizeChanges', () => {
  it('classifies added, removed, modified and moved pages by id', () => {
    const edited = page('m1');
    const moved = page('m2', { position: 1 });
    const removed = page('m3', { position: 2 });
    const branch = [{ ...fork(edited, 'b1'), title: 'Edited' }, { ...fork(moved, 'b2'), position: 7 }, page('b4')];
    const changes = summarizeChanges({ main: [edited, moved, removed], branch, forkBase: baseOf(edited, moved, removed) });
    expect(changes.map(({ change, mainPageId, branchPageId }) => [change, mainPageId, branchPageId])).toEqual([
      ['modified', 'm1', 'b1'],
      ['moved', 'm2', 'b2'],
      ['added', null, 'b4'],
      ['removed', 'm3', null],
    ]);
  });
});
