import { Prisma, prisma } from '@nibleaf/database';
import { textSearchConfigs } from '@nibleaf/search';

/** Most hits each wiki contributes to an "All wikis" search. */
export const CROSS_WIKI_HITS_PER_WIKI = 3;

/** Most hits in one "All wikis" response. */
export const CROSS_WIKI_RESULT_LIMIT = 30;

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

/** Characters of a page body `ts_headline` reads for a snippet. */
const SNIPPET_SOURCE_CHARS = 20_000;

/** One full-text hit of another wiki, with what its public URL needs. */
export interface PublicWikiHit {
  projectId: string;
  name: string;
  slug: string;
  primaryDomain: string | null;
  defaultLanguage: string | null;
  pageId: string;
  languageCode: string;
  title: string;
  path: string;
  icon: string | null;
  snippet: string;
  rank: number;
}

/**
 * Full-text hits of every other wiki readers may search across: public, not
 * taken down, opted in, rows of the latest READY deployment in an enabled
 * language. Ranked by `ts_rank_cd`, at most `perWiki` per wiki and `limit` in
 * total. The GIN index is probed with the union of the query in every text
 * search configuration; each row is then matched in its own language's.
 */
export const searchPublicWikiDocuments = async (
  currentProjectId: string,
  query: string,
  perWiki: number,
  limit: number,
): Promise<PublicWikiHit[]> => {
  const anyLanguage = Prisma.join(
    textSearchConfigs.map((config) => Prisma.sql`websearch_to_tsquery(${config}::regconfig, ${query})`),
    ' || ',
  );
  return prisma.$queryRaw<PublicWikiHit[]>`
    WITH matches AS (
      SELECT doc."projectId", doc."pageId", doc."languageCode", doc."title", doc."path", doc."icon", doc."body", doc."textConfig",
        ts_rank_cd(doc."searchVector", websearch_to_tsquery(doc."textConfig", ${query})) AS rank
      FROM "page_search_document" doc
      JOIN "project" p ON p."id" = doc."projectId"
      JOIN "language" l ON l."projectId" = doc."projectId" AND l."code" = doc."languageCode" AND l."enabled"
      WHERE doc."searchVector" @@ (${anyLanguage})
        AND doc."searchVector" @@ websearch_to_tsquery(doc."textConfig", ${query})
        AND p."id" <> ${currentProjectId}
        AND p."accessMode" = 'PUBLIC'
        AND p."takedownAt" IS NULL
        AND COALESCE(p."config" #>> '{search,crossWikiSearch}', 'true') <> 'false'
        AND doc."deploymentId" = (
          SELECT d."id" FROM "deployment" d
          WHERE d."projectId" = doc."projectId" AND d."status" = 'READY'
          ORDER BY d."version" DESC LIMIT 1
        )
    ), top AS (
      SELECT * FROM (
        SELECT matches.*, row_number() OVER (PARTITION BY "projectId" ORDER BY rank DESC, "pageId") AS n FROM matches
      ) ranked
      WHERE n <= ${perWiki}
      ORDER BY rank DESC, "projectId", "pageId"
      LIMIT ${limit}
    )
    SELECT top."projectId", p."name", p."slug", top."pageId", top."languageCode", top."title", top."path", top."icon",
      top.rank::float8 AS rank,
      ts_headline(top."textConfig", left(top."body", ${SNIPPET_SOURCE_CHARS}), websearch_to_tsquery(top."textConfig", ${query}),
        'StartSel="", StopSel="", MaxWords=30, MinWords=10, MaxFragments=1') AS snippet,
      (SELECT dm."domain" FROM "domain" dm WHERE dm."projectId" = top."projectId" AND dm."verified" AND dm."isPrimary"
        ORDER BY dm."verifiedAt" ASC NULLS LAST, dm."createdAt" ASC LIMIT 1) AS "primaryDomain",
      (SELECT dl."code" FROM "language" dl WHERE dl."projectId" = top."projectId" AND dl."isDefault" LIMIT 1) AS "defaultLanguage"
    FROM top JOIN "project" p ON p."id" = top."projectId"
    ORDER BY top.rank DESC, top."projectId", top."pageId"`;
};
