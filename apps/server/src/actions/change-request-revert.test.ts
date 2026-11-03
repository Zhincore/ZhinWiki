import { describe, expect, it } from 'vitest';
import { contentHash, type MergePage, type MergeRecordEntry, pageFingerprint, planMerge } from './change-request-merge';
import { planRevert } from './change-request-revert';

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

/** Revert-branch copy `b-<id>` of main page `id`, as a fresh fork makes it. */
const copy = (source: MergePage): MergePage => ({
  ...source,
  id: `b-${source.id}`,
  parentId: source.parentId ? `b-${source.parentId}` : null,
  sourcePageId: source.id,
  forkFingerprint: 'fp',
});

const recorded = ({ id: _id, languageId: _language, sourcePageId: _source, forkFingerprint: _fp, ...fields }: MergePage) => fields;

const entry = (action: MergeRecordEntry['action'], before: MergePage | null, after: MergePage | null): MergeRecordEntry => ({
  pageId: (after ?? before)?.id ?? '',
  languageId: 'en',
  action,
  before: before && recorded(before),
  after: after && recorded(after),
});

const plan = (record: MergeRecordEntry[], main: MergePage[], languages = ['en']) => {
  let next = 0;
  return planRevert({ record, branch: main.map(copy), languageIds: new Set(languages), newId: () => `new-${++next}` });
};

describe('planRevert', () => {
  it('deletes a page the merge added and keeps a child added under it since', () => {
    const added = page('a', { position: 2 });
    const later = page('c', { parentId: 'a', path: 'a/c' });
    const result = plan([entry('added', null, added)], [added, later]);
    expect(result.deletes).toEqual(['b-a']);
    expect(result.updates).toEqual([{ id: 'b-c', data: { parentId: null, path: 'c' } }]);
    expect(result.warnings).toEqual([]);
  });

  it('restores the content of an edited page, overwriting later edits on main', () => {
    const before = page('p', { content: '# old' });
    const after = page('p', { content: '# merged' });
    const result = plan([entry('modified', before, after)], [{ ...after, content: '# edited again on main' }]);
    expect(result.updates).toEqual([{ id: 'b-p', data: { content: '# old' } }]);
    expect(result.creates).toEqual([]);
  });

  it('re-creates a deleted page and its deleted parent, parents first', () => {
    const group = page('g', { kind: 'GROUP' });
    const child = page('c', { parentId: 'g', path: 'g/c' });
    const result = plan([entry('removed', child, null), entry('removed', group, null)], []);
    expect(result.creates.map((created) => [created.id, created.parentId, created.path])).toEqual([
      ['new-2', null, 'g'],
      ['new-1', 'new-2', 'g/c'],
    ]);
    expect(result.warnings).toEqual([]);
  });

  it('moves a page back to its former parent and position', () => {
    const groupA = page('ga');
    const groupB = page('gb', { position: 1 });
    const before = page('x', { parentId: 'ga', path: 'ga/x', position: 0 });
    const after = page('x', { parentId: 'gb', path: 'gb/x', position: 4 });
    const result = plan([entry('moved', before, after)], [groupA, groupB, after]);
    expect(result.updates).toEqual([{ id: 'b-x', data: { parentId: 'b-ga', position: 0, path: 'ga/x' } }]);
  });

  it('puts a page whose former parent is gone at the root and reports it', () => {
    const before = page('x', { parentId: 'gone', path: 'gone/x' });
    const after = page('x', { parentId: 'gb', path: 'gb/x' });
    const result = plan([entry('moved', before, after)], [page('gb'), after]);
    expect(result.updates).toEqual([{ id: 'b-x', data: { parentId: null, path: 'x' } }]);
    expect(result.warnings).toEqual([{ pageId: 'x', title: 'x', path: 'gone/x', reason: 'PARENT_UNAVAILABLE' }]);
  });

  it('re-creates an edited page deleted on main since', () => {
    const before = page('p', { content: '# old' });
    const result = plan([entry('modified', before, page('p', { content: '# merged' }))], []);
    expect(result.creates).toMatchObject([{ id: 'new-1', content: '# old', path: 'p' }]);
  });

  it('skips a page whose language is gone and reports it', () => {
    const removed = page('p');
    const result = plan([entry('removed', removed, null)], [], []);
    expect(result.creates).toEqual([]);
    expect(result.warnings).toEqual([{ pageId: 'p', title: 'p', path: 'p', reason: 'LANGUAGE_MISSING' }]);
  });

  it('gives a restored page a free slug when main reused it since', () => {
    const removed = page('p');
    const result = plan([entry('removed', removed, null)], [page('q', { slug: 'p', path: 'p' })]);
    expect(result.creates).toMatchObject([{ slug: 'p-2', path: 'p-2' }]);
  });

  it('finds a former parent by path when its id is gone', () => {
    const group = page('g2', { slug: 'g', path: 'g' });
    const before = page('x', { parentId: 'g1', path: 'g/x' });
    const after = page('x');
    const result = plan([entry('modified', before, after)], [group, after]);
    expect(result.updates).toEqual([{ id: 'b-x', data: { parentId: 'b-g2', path: 'g/x' } }]);
    expect(result.warnings).toEqual([]);
  });

  it('does not attach a page under a path the revert moves away from', () => {
    const before = page('g', { slug: 'intro', path: 'intro' });
    const after = page('g', { slug: 'guide', path: 'guide' });
    const removed = page('x', { parentId: 'gone', path: 'guide/x' });
    const result = plan([entry('modified', before, after), entry('removed', removed, null)], [after]);
    expect(result.creates).toMatchObject([{ id: 'new-1', parentId: null, path: 'x' }]);
    expect(result.warnings).toMatchObject([{ pageId: 'x', reason: 'PARENT_UNAVAILABLE' }]);
  });

  it('finds a former parent at the path the revert moves it back to', () => {
    const before = page('g', { slug: 'guide', path: 'guide' });
    const after = page('g', { slug: 'intro', path: 'intro' });
    const removed = page('x', { parentId: 'gone', path: 'guide/x' });
    const result = plan([entry('modified', before, after), entry('removed', removed, null)], [after]);
    expect(result.creates).toMatchObject([{ id: 'new-1', parentId: 'b-g', path: 'guide/x' }]);
    expect(result.warnings).toEqual([]);
  });

  it('breaks a loop with a move made on main since', () => {
    const groupA = page('ga');
    const before = page('gb', { parentId: 'ga', path: 'ga/gb' });
    const after = page('gb');
    // Since the merge, main moved ga under gb; restoring gb under ga would loop.
    const result = plan([entry('moved', before, after)], [{ ...groupA, parentId: 'gb', path: 'gb/ga' }, after]);
    expect(result.warnings).toMatchObject([{ pageId: 'gb', reason: 'PARENT_UNAVAILABLE' }]);
    expect(result.updates).toEqual([]);
  });
});

describe('planRevert then planMerge', () => {
  /** Main after a merge that removed group `g` (moving `c` out of it), edited `p` and added `a`. */
  const merged = () => {
    const group = page('g', { kind: 'GROUP' });
    const childBefore = page('c', { parentId: 'g', path: 'g/c' });
    const child = page('c');
    const edited = page('p', { content: '# merged', position: 1 });
    const added = page('a', { position: 2 });
    const record = [
      entry('removed', group, null),
      entry('moved', childBefore, child),
      entry('modified', { ...edited, content: '# old' }, edited),
      entry('added', null, added),
    ];
    return { record, main: [child, edited, added] };
  };

  /** A fresh fork of `main` with the revert plan applied, and its fork base. */
  const revertBranch = (record: MergeRecordEntry[], main: MergePage[]) => {
    const forked = main.map((source) => ({
      ...source,
      id: `b-${source.id}`,
      parentId: source.parentId ? `b-${source.parentId}` : null,
      sourcePageId: source.id,
      forkFingerprint: pageFingerprint(source, source.parentId),
    }));
    const forkBase = Object.fromEntries(main.map((source) => [source.id, { hash: contentHash(source), copyId: `b-${source.id}` }]));
    let next = 0;
    const result = planRevert({ record, branch: forked, languageIds: new Set(['en']), newId: () => `new-${++next}` });
    const branch = [
      ...forked
        .filter((copy) => !result.deletes.includes(copy.id))
        .map((copy) => ({ ...copy, ...result.updates.find((update) => update.id === copy.id)?.data })),
      ...result.creates.map((created) => ({ ...created, sourcePageId: null, forkFingerprint: null })),
    ];
    return { branch, forkBase };
  };

  it('merges back onto the main ids: re-creates the parent, moves the child under it, restores and deletes', () => {
    const { record, main } = merged();
    const { branch, forkBase } = revertBranch(record, main);
    const plan = planMerge({ main, branch, forkBase, force: new Set() });
    if (plan.legacy) throw new Error('expected a page merge');
    expect(plan.conflicts).toEqual([]);
    expect(plan.inserts).toMatchObject([{ id: 'new-1', data: { parentId: null, path: 'g', kind: 'GROUP' } }]);
    expect(plan.updates).toEqual(
      expect.arrayContaining([
        { id: 'c', data: { parentId: 'new-1', path: 'g/c' } },
        { id: 'p', data: { content: '# old' } },
      ]),
    );
    expect(plan.updates).toHaveLength(2);
    expect(plan.deletes).toEqual(['a']);
  });

  it('conflicts when main edits a restored page after the revert fork', () => {
    const { record, main } = merged();
    const { branch, forkBase } = revertBranch(record, main);
    const later = main.map((source) => (source.id === 'p' ? { ...source, content: '# later' } : source));
    const plan = planMerge({ main: later, branch, forkBase, force: new Set() });
    expect(plan).toMatchObject({ blocked: true, conflicts: [{ pageId: 'p', reason: 'BOTH_CHANGED' }] });
  });
});
