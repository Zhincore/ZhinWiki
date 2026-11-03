import { createDocIndex, type DocIndex, oramaLanguageForCode } from '@nibleaf/search';
import { pageSearchDocuments, type SnapshotPage } from '@nibleaf/shared/site';
import { LruCache } from './lru';

interface Entry {
  key: string;
  index: DocIndex;
}

/** Bound on live Orama indexes: they hold full page content, so an instance
 *  serving many sites/languages must evict cold ones instead of growing forever. */
const MAX_CACHED_INDEXES = 50;

// One in-memory Orama index per (project, language, authorization scope),
// keyed by the published deployment id so it rebuilds automatically on
// re-publish. The authorization scope is mandatory: a
// workspace member may index every page while a dedicated reader may see only a
// grant subset, and those indexes must never share one cache slot.
const cache = new LruCache<string, Entry>(MAX_CACHED_INDEXES);

const authorizationScopeKey = (allowedPageIds: ReadonlySet<string> | null): string => {
  if (allowedPageIds === null) return 'full';
  // Length-prefix each id so the representation is deterministic and cannot
  // collide through a delimiter embedded in an id.
  return `pages:${[...allowedPageIds]
    .sort()
    .map((id) => `${id.length}:${id}`)
    .join('')}`;
};

const cacheKey = (projectId: string, lang: string, allowedPageIds: ReadonlySet<string> | null): string =>
  `${projectId}:${lang}:${authorizationScopeKey(allowedPageIds)}`;

/** Get (or build) the cached search index for a project's published deployment,
 *  scoped to a single language. */
export const getCachedIndex = async (
  projectId: string,
  deploymentId: string,
  lang: string,
  pages: SnapshotPage[],
  allowedPageIds: ReadonlySet<string> | null,
): Promise<DocIndex> => {
  const mapKey = cacheKey(projectId, lang, allowedPageIds);
  const existing = cache.get(mapKey);
  if (existing && existing.key === deploymentId) {
    return existing.index;
  }
  const scoped = pages.filter((page) => page.languageCode === lang);
  const index = await createDocIndex(pageSearchDocuments(scoped), oramaLanguageForCode(lang));
  cache.set(mapKey, { key: deploymentId, index });
  return index;
};
