import { Octokit, RequestError } from 'octokit';
import { AppError, badRequest, ImportError } from '@/errors';

const github = new Octokit({
  userAgent: 'nibleaf-importer',
  throttle: { enabled: false },
  retry: { enabled: false },
  request: {
    fetch: (url: Parameters<typeof fetch>[0], options?: Parameters<typeof fetch>[1]) =>
      fetch(url, { ...options, signal: AbortSignal.timeout(30_000) }),
  },
});

const MAX_RETRY_WAIT_MS = 86_400_000;

const githubRetryMinutes = ({ status, response }: RequestError) => {
  if (status !== 403 && status !== 429) return;
  const headers = response?.headers;
  const retryAfter = Number(headers?.['retry-after']) * 1000;
  const reset = Number(headers?.['x-ratelimit-reset']) * 1000 - Date.now();
  const wait = retryAfter > 0 ? retryAfter : headers?.['x-ratelimit-remaining'] === '0' ? reset : 0;
  return wait > 0 && wait <= MAX_RETRY_WAIT_MS ? Math.ceil(wait / 60_000) : undefined;
};

const githubFailureMessage = (error: RequestError) => {
  if (error.status === 404) return 'Repository or branch not found. Imports support public GitHub repositories only.';
  const minutes = githubRetryMinutes(error);
  if (minutes === undefined) return `GitHub API error (${error.status}). Try again shortly.`;
  return `GitHub rate limit reached. Try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.`;
};

const githubFailure = (error: unknown) => {
  if (error instanceof AppError) return error;
  if (error instanceof RequestError) {
    return badRequest(githubFailureMessage(error), { provider: 'github', providerStatus: error.status });
  }
  return badRequest('Could not reach GitHub. Try again shortly.', { provider: 'github' });
};

type GitHubFile = { path: string; type: 'blob' | 'tree' };

/** Scope and bounds for listing a tree too large for one recursive request. */
export type GitHubTreeWalk = {
  /** Repository directories to list completely; `''` is the whole repository. */
  within: readonly string[];
  /** Called once per tree request; throws to stop the walk. */
  request: () => void;
};

const TREE_WALK_CONCURRENCY = 4;

const truncatedTree = (path: string) =>
  new ImportError({
    code: 'import:incomplete',
    message: 'Repository tree is too large to list completely; import stopped.',
    details: { path },
  });

const fetchTree = async (owner: string, repo: string, sha: string, recursive: boolean) => {
  const { data } = await github.rest.git.getTree({ owner, repo, tree_sha: sha, ...(recursive ? { recursive: 'true' } : {}) });
  return data;
};

const treeFiles = (tree: { path?: string; type?: string; sha?: string }[], directory: string) =>
  tree.flatMap((entry): (GitHubFile & { sha?: string })[] =>
    entry.path && (entry.type === 'blob' || entry.type === 'tree')
      ? [{ path: directory ? `${directory}/${entry.path}` : entry.path, type: entry.type, sha: entry.sha }]
      : [],
  );

const inside = (path: string, directory: string) => !directory || path === directory || path.startsWith(`${directory}/`);

/** List the `within` directories (and the ancestors leading to them) one subtree at a time,
 * trying a recursive request per in-scope subtree before descending further. */
const walkTree = async (owner: string, repo: string, sha: string, walk: GitHubTreeWalk) => {
  const files: GitHubFile[] = [];
  let pending = [{ path: '', sha, recursive: false }];
  while (pending.length > 0) {
    const next: typeof pending = [];
    const queue = [...pending];
    const worker = async () => {
      for (let dir = queue.shift(); dir; dir = queue.shift()) {
        walk.request();
        const data = await fetchTree(owner, repo, dir.sha, dir.recursive);
        if (data.truncated && !dir.recursive) throw truncatedTree(dir.path);
        if (data.truncated) {
          next.push({ ...dir, recursive: false });
          continue;
        }
        for (const entry of treeFiles(data.tree, dir.path)) {
          if (dir.recursive || walk.within.some((scope) => inside(entry.path, scope))) {
            files.push({ path: entry.path, type: entry.type });
            if (!dir.recursive && entry.type === 'tree' && entry.sha) next.push({ path: entry.path, sha: entry.sha, recursive: true });
          } else if (entry.type === 'tree' && entry.sha && walk.within.some((scope) => scope.startsWith(`${entry.path}/`))) {
            next.push({ path: entry.path, sha: entry.sha, recursive: false });
          }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(TREE_WALK_CONCURRENCY, queue.length) }, worker));
    pending = next;
  }
  return files;
};

const listTree = async (owner: string, repo: string, sha: string, walk?: GitHubTreeWalk) => {
  const data = await fetchTree(owner, repo, sha, true);
  if (!data.truncated) return { files: treeFiles(data.tree, '').map(({ path, type }) => ({ path, type })), walked: false };
  if (!walk) throw truncatedTree('');
  return { files: await walkTree(owner, repo, sha, walk), walked: true };
};

/** Recursive tree listing of a public GitHub repository at a branch; fails if GitHub truncates it. */
export const listGitHubFiles = async (owner: string, repo: string, branch: string) => {
  try {
    return (await listTree(owner, repo, branch)).files;
  } catch (error) {
    throw githubFailure(error);
  }
};

/** Resolve a mutable ref once; raw content must use a commit, not a tree object ID.
 * A tree GitHub truncates is listed through `walk`; `walked` reports that. */
export const getGitHubSnapshot = async (owner: string, repo: string, ref: string, walk?: GitHubTreeWalk) => {
  try {
    const commit = await github.rest.repos.getCommit({ owner, repo, ref });
    const revision = commit.data.sha;
    return { revision, ...(await listTree(owner, repo, revision, walk)) };
  } catch (error) {
    throw githubFailure(error);
  }
};

/** Default branch of a public GitHub repository (used when the caller omits one). */
export const getGitHubDefaultBranch = async (owner: string, repo: string) => {
  try {
    const response = await github.rest.repos.get({ owner, repo });
    return response.data.default_branch || 'main';
  } catch (error) {
    throw githubFailure(error);
  }
};

/** Read one text file from a public repository through GitHub's raw-content
 * origin. The Contents API allows only 60 unauthenticated requests per hour;
 * a bilingual documentation import can legitimately exceed that by itself.
 * The repository tree is still obtained through GitHub's API first, so callers
 * only request paths that GitHub reported for the selected public revision. */
export const getGitHubTextFile = async (owner: string, repo: string, branch: string, filePath: string) => {
  let response: Response;
  try {
    response = await fetch(githubRawUrl(owner, repo, branch, filePath), {
      headers: { Accept: 'text/plain', 'User-Agent': 'nibleaf-importer' },
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw githubFailure(error);
  }
  if (response.status === 404) return null;
  if (!response.ok) {
    throw badRequest(`GitHub raw content error (${response.status}). Try again shortly.`, {
      provider: 'github',
      providerStatus: response.status,
    });
  }
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 2 * 1024 * 1024) throw new ImportError({ code: 'import:limit', message: 'Repository text file exceeds 2 MiB; import stopped.' });
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } catch (error) {
    if (error instanceof ImportError) throw error;
    throw githubFailure(error);
  } finally {
    await reader.cancel().catch(() => undefined);
  }
};

/** raw.githubusercontent.com URL for a browser-reachable repository asset. */
export const githubRawUrl = (owner: string, repo: string, branch: string, filePath: string) =>
  `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${filePath.split('/').map(encodeURIComponent).join('/')}`;
