import { describe, expect, it } from 'vitest';
import type { MergePage, MergeRecordEntry } from './change-request-merge';
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
