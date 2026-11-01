import { beforeEach, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ getCommit: vi.fn(), getTree: vi.fn() }));
vi.mock('octokit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('octokit')>();
  return {
    ...actual,
    Octokit: class {
      rest = { repos: { getCommit: api.getCommit }, git: { getTree: api.getTree } };
    },
  };
});

import { GitBookImportBudget } from './gitbook-budget';
import { getGitHubSnapshot, listGitHubFiles } from './github';

/** Tree objects by SHA; GitHub reports `truncated` for recursive listings of `huge`. */
const trees: Record<string, { path: string; type: 'blob' | 'tree'; sha?: string }[]> = {
  'immutable-commit': [
    { path: 'README.md', type: 'blob' },
    { path: '.gitbook', type: 'tree', sha: 'gitbook' },
    { path: 'spaces', type: 'tree', sha: 'spaces' },
    { path: 'vendor', type: 'tree', sha: 'vendor' },
  ],
  gitbook: [{ path: 'assets', type: 'tree', sha: 'assets' }],
  assets: [{ path: 'logo.png', type: 'blob' }],
  spaces: [
    { path: 'docs', type: 'tree', sha: 'docs' },
    { path: 'other', type: 'tree', sha: 'other' },
  ],
  docs: [
    { path: 'SUMMARY.md', type: 'blob' },
    { path: 'guide', type: 'tree', sha: 'guide' },
  ],
  guide: [{ path: 'intro.md', type: 'blob' }],
};
const huge = new Set(['immutable-commit', 'docs']);

beforeEach(() => {
  api.getCommit.mockReset().mockResolvedValue({ data: { sha: 'immutable-commit' } });
  api.getTree.mockReset().mockImplementation(async ({ tree_sha, recursive }: { tree_sha: string; recursive?: string }) => {
    if (recursive && huge.has(tree_sha)) return { data: { tree: [], truncated: true } };
    if (!recursive) return { data: { tree: trees[tree_sha] ?? [], truncated: false } };
    const walk = (sha: string, prefix: string): { path: string; type: string; sha?: string }[] =>
      (trees[sha] ?? []).flatMap((entry) => {
        const path = `${prefix}${entry.path}`;
        return [{ ...entry, path }, ...(entry.type === 'tree' && entry.sha ? walk(entry.sha, `${path}/`) : [])];
      });
    return { data: { tree: walk(tree_sha, ''), truncated: false } };
  });
});

it('pins the tree walk to the resolved commit instead of the mutable branch or tree ID', async () => {
  api.getTree.mockResolvedValue({ data: { sha: 'tree-object', tree: [{ path: 'README.md', type: 'blob' }] } });
  expect(await getGitHubSnapshot('public', 'docs', 'main')).toEqual({
    revision: 'immutable-commit',
    files: [{ path: 'README.md', type: 'blob' }],
    walked: false,
  });
  expect(api.getTree).toHaveBeenCalledOnce();
  expect(api.getTree).toHaveBeenCalledWith({ owner: 'public', repo: 'docs', tree_sha: 'immutable-commit', recursive: 'true' });
});

it('lists the requested scope of a truncated tree one subtree at a time', async () => {
  const snapshot = await getGitHubSnapshot('public', 'docs', 'main', { within: ['spaces/docs', '.gitbook'], request: () => undefined });
  expect(snapshot.walked).toBe(true);
  expect(snapshot.files.map((file) => file.path).sort()).toEqual([
    '.gitbook',
    '.gitbook/assets',
    '.gitbook/assets/logo.png',
    'spaces/docs',
    'spaces/docs/SUMMARY.md',
    'spaces/docs/guide',
    'spaces/docs/guide/intro.md',
  ]);
  const requested = api.getTree.mock.calls.map(([args]) => `${args.tree_sha}${args.recursive ? ':recursive' : ''}`);
  expect(requested).not.toContain('vendor');
  expect(requested).not.toContain('other');
  expect(requested).toContain('docs:recursive');
  expect(requested).toContain('docs');
  expect(requested[0]).toBe('immutable-commit:recursive');
});

it('stops a truncated walk at the import budget', async () => {
  const budget = new GitBookImportBudget();
  for (let i = 0; i < 39; i++) budget.treeRequest();
  await expect(getGitHubSnapshot('public', 'docs', 'main', { within: [''], request: () => budget.treeRequest() })).rejects.toMatchObject({
    code: 'import:limit',
  });
  expect(api.getTree).toHaveBeenCalledTimes(2);
});

it('caps tree requests below the unauthenticated GitHub quota', () => {
  const budget = new GitBookImportBudget();
  for (let i = 0; i < 40; i++) budget.treeRequest();
  expect(() => budget.treeRequest()).toThrow(expect.objectContaining({ code: 'import:limit' }));
});

it('refuses a truncated tree when no walk is allowed', async () => {
  await expect(listGitHubFiles('public', 'docs', 'immutable-commit')).rejects.toMatchObject({ code: 'import:incomplete' });
});
