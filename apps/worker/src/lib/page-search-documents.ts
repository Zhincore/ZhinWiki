import { Prisma, prisma } from '@nibleaf/database';
import { createLogger } from '@nibleaf/logger';
import { stripMarkdown, textSearchConfig } from '@nibleaf/search';
import { pageSearchDocuments, readSnapshot } from '@nibleaf/shared/site';

const log = createLogger({ component: 'page-search-documents' });

/** Rows per INSERT statement. */
const INSERT_BATCH = 200;

/** Postgres text values cannot hold NUL. */
const text = (value: string): string => value.replaceAll('\u0000', '');

/**
 * Replace a project's full-text rows with those of `deploymentId`, when it is
 * the project's latest READY deployment; an older deployment is skipped. One
 * transaction, serialized per project by a row lock. Idempotent.
 */
export const indexPageSearchDocuments = async (projectId: string, deploymentId: string): Promise<{ pages: number } | { skipped: true }> =>
  prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM "project" WHERE "id" = ${projectId} FOR UPDATE`;
      const latest = await tx.deployment.findFirst({
        where: { projectId, status: 'READY' },
        orderBy: { version: 'desc' },
        select: { id: true, snapshot: true },
      });
      if (latest?.id !== deploymentId || !latest.snapshot) return { skipped: true as const };
      const docs = pageSearchDocuments(readSnapshot(latest.snapshot).pages);
      await tx.$executeRaw`DELETE FROM "page_search_document" WHERE "projectId" = ${projectId}`;
      for (let start = 0; start < docs.length; start += INSERT_BATCH) {
        const rows = docs
          .slice(start, start + INSERT_BATCH)
          .map(
            (doc) =>
              Prisma.sql`(${projectId}, ${deploymentId}, ${doc.languageCode}, ${doc.id}, ${text(doc.title)}, ${text(doc.path)}, ${text(doc.headings)}, ${text(
                `${doc.description} ${stripMarkdown(doc.content)}`.trim(),
              )}, ${doc.icon ?? null}, ${textSearchConfig(doc.languageCode)}::regconfig)`,
          );
        await tx.$executeRaw`INSERT INTO "page_search_document" ("projectId", "deploymentId", "languageCode", "pageId", "title", "path", "headings", "body", "icon", "textConfig") VALUES ${Prisma.join(rows)}`;
      }
      return { pages: docs.length };
    },
    { timeout: 120_000 },
  );

/** Index the latest READY deployment of every project that has no rows for it yet. Idempotent. */
export const backfillPageSearchDocuments = async (): Promise<number> => {
  const missing = await prisma.$queryRaw<Array<{ projectId: string; deploymentId: string }>>`
    SELECT latest."projectId", latest."id" AS "deploymentId"
    FROM (
      SELECT DISTINCT ON ("projectId") "projectId", "id"
      FROM "deployment"
      WHERE "status" = 'READY'
      ORDER BY "projectId", "version" DESC
    ) AS latest
    WHERE NOT EXISTS (SELECT 1 FROM "page_search_document" doc WHERE doc."deploymentId" = latest."id")`;
  for (const { projectId, deploymentId } of missing) {
    await indexPageSearchDocuments(projectId, deploymentId).catch((error) =>
      log.warn({ projectId, deploymentId, error }, 'could not backfill full-text search rows'),
    );
  }
  return missing.length;
};
