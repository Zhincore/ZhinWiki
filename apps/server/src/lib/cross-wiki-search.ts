/** Most other wikis one "All wikis" search fans out to (the current wiki is extra). */
export const CROSS_WIKI_MAX_WIKIS = 10;

/** Reciprocal Rank Fusion constant (Cormack et al.). */
export const RRF_K = 60;

/** One wiki's own ranked result list. */
export interface RankedList<T> {
  wikiId: string;
  hits: T[];
}

export interface FusedGroup<T> {
  wikiId: string;
  hits: T[];
}

/**
 * Fuse per-wiki rankings with Reciprocal Rank Fusion: each hit scores
 * `1 / (k + rank)` summed over the lists holding its `key`; scores of
 * different wikis are never compared. Ties keep list order, so the caller's
 * first list (the current wiki) leads. Returns the top `limit` hits grouped by
 * wiki, groups in order of their best hit.
 */
export const fuseRankedLists = <T>(lists: RankedList<T>[], key: (hit: T) => string, limit: number, k = RRF_K): FusedGroup<T>[] => {
  const fused = new Map<string, { wikiId: string; hit: T; score: number; order: number }>();
  let order = 0;
  for (const list of lists) {
    list.hits.forEach((hit, index) => {
      const id = `${list.wikiId}\u0000${key(hit)}`;
      const entry = fused.get(id) ?? { wikiId: list.wikiId, hit, score: 0, order: order++ };
      entry.score += 1 / (k + index + 1);
      fused.set(id, entry);
    });
  }
  const top = [...fused.values()].sort((left, right) => right.score - left.score || left.order - right.order).slice(0, limit);
  const groups = new Map<string, T[]>();
  for (const entry of top) {
    const hits = groups.get(entry.wikiId) ?? [];
    hits.push(entry.hit);
    groups.set(entry.wikiId, hits);
  }
  return [...groups].map(([wikiId, hits]) => ({ wikiId, hits }));
};
