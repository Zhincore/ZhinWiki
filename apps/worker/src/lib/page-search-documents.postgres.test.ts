import { randomUUID } from 'node:crypto';
import { prisma } from '@nibleaf/database';
import { afterAll, describe, expect, it } from 'vitest';
import { backfillPageSearchDocuments, indexPageSearchDocuments } from './page-search-documents';

const run = randomUUID().slice(0, 8);
const organizations: string[] = [];

const snapshot = (title: string) => ({
  project: {
    id: 'p',
    name: 'Wiki',
    slug: 'wiki',
    description: null,
    icon: null,
    config: {},
    languages: [{ code: 'en', label: 'English', direction: 'LTR', isDefault: true, config: null }],
  },
  pages: [
    {
      id: 'page-a',
      parentId: null,
      kind: 'PAGE',
      title,
      slug: 'a',
      path: 'a',
      icon: null,
      description: 'Lede.',
      content: '# Heading\n\n**Body** text.',
      config: null,
      position: 0,
      languageCode: 'en',
      translationKey: null,
      hidden: false,
      updatedAt: '2026-11-01T00:00:00.000Z',
    },
    {
      id: 'page-hidden',
      parentId: null,
      kind: 'PAGE',
      title: 'Hidden',
      slug: 'h',
      path: 'h',
      icon: null,
      description: null,
      content: '',
      config: null,
      position: 1,
      languageCode: 'en',
      translationKey: null,
      hidden: true,
      updatedAt: '2026-11-01T00:00:00.000Z',
    },
  ],
  generatedAt: '2026-11-01T00:00:00.000Z',
});

const rows = (projectId: string) =>
  prisma.$queryRaw<Array<{ deploymentId: string; pageId: string; title: string; headings: string; body: string; textConfig: string }>>`
    SELECT "deploymentId", "pageId", "title", "headings", "body", "textConfig"::text AS "textConfig" FROM "page_search_document" WHERE "projectId" = ${projectId}`;

// Explicit opt-in: CI supplies its disposable migrated PostgreSQL service.
describe.skipIf(process.env.ACTIVATION_INTEGRATION !== '1')('full-text search rows in PostgreSQL', () => {
  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: { in: organizations } } });
    await prisma.$disconnect();
  });

  it('keeps only the latest READY deployment and backfills idempotently', async () => {
    const organization = await prisma.organization.create({ data: { name: `fts-${run}` } });
    organizations.push(organization.id);
    const project = await prisma.project.create({ data: { organizationId: organization.id, name: 'Wiki', slug: `fts-${run}` } });
    const first = await prisma.deployment.create({ data: { projectId: project.id, version: 1, status: 'READY', snapshot: snapshot('First') } });

    expect(await backfillPageSearchDocuments()).toBeGreaterThanOrEqual(1);
    expect(await rows(project.id)).toEqual([
      { deploymentId: first.id, pageId: 'page-a', title: 'First', headings: 'Heading', body: 'Lede. Heading Body text.', textConfig: 'english' },
    ]);

    const second = await prisma.deployment.create({ data: { projectId: project.id, version: 2, status: 'READY', snapshot: snapshot('Second') } });
    await expect(indexPageSearchDocuments(project.id, first.id)).resolves.toEqual({ skipped: true });
    await expect(Promise.all([indexPageSearchDocuments(project.id, second.id), indexPageSearchDocuments(project.id, second.id)])).resolves.toEqual([
      { pages: 1 },
      { pages: 1 },
    ]);
    expect((await rows(project.id)).map((row) => [row.deploymentId, row.title])).toEqual([[second.id, 'Second']]);

    await backfillPageSearchDocuments();
    expect(await rows(project.id)).toHaveLength(1);
  }, 60_000);
});
