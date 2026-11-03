import { randomUUID } from 'node:crypto';
import { prisma } from '@nibleaf/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { searchPublicWikiDocuments } from './cross-wiki-search';

const run = randomUUID().slice(0, 8);
const organizations: string[] = [];

interface WikiOptions {
  accessMode?: 'PUBLIC' | 'WORKSPACE' | 'READERS';
  takedownAt?: Date;
  config?: object;
  languages?: Array<{ code: string; enabled?: boolean }>;
  /** Rows per page title; a second READY deployment makes the first one stale. */
  pages?: Array<{ title: string; body?: string; languageCode?: string; stale?: boolean }>;
}

/** Seed a project with READY deployments and full-text rows the worker would write. */
const wiki = async (name: string, options: WikiOptions = {}): Promise<string> => {
  const organization = await prisma.organization.create({ data: { name } });
  organizations.push(organization.id);
  const project = await prisma.project.create({
    data: {
      organizationId: organization.id,
      name,
      slug: `${name}-${run}`,
      accessMode: options.accessMode ?? 'PUBLIC',
      takedownAt: options.takedownAt ?? null,
      config: options.config ?? {},
    },
  });
  for (const [position, language] of (options.languages ?? [{ code: 'en' }]).entries()) {
    await prisma.language.create({
      data: {
        projectId: project.id,
        code: language.code,
        label: language.code,
        isDefault: position === 0,
        enabled: language.enabled ?? true,
        position,
      },
    });
  }
  const old = await prisma.deployment.create({ data: { projectId: project.id, version: 1, status: 'READY' } });
  const current = await prisma.deployment.create({ data: { projectId: project.id, version: 2, status: 'READY' } });
  for (const [index, page] of (options.pages ?? []).entries()) {
    const languageCode = page.languageCode ?? 'en';
    const config = languageCode === 'de' ? 'german' : 'english';
    await prisma.$executeRaw`
      INSERT INTO "page_search_document" ("projectId", "deploymentId", "languageCode", "pageId", "title", "path", "headings", "body", "textConfig")
      VALUES (${project.id}, ${page.stale ? old.id : current.id}, ${languageCode}, ${`page-${index}`}, ${page.title}, ${`p${index}`}, '', ${page.body ?? ''}, ${config}::regconfig)`;
  }
  return project.id;
};

// Explicit opt-in: CI supplies its disposable migrated PostgreSQL service.
describe.skipIf(process.env.ACTIVATION_INTEGRATION !== '1')('cross-wiki full-text search in PostgreSQL', () => {
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    ids.current = await wiki('current', { pages: [{ title: `Zebra ${run}` }] });
    ids.open = await wiki('open', {
      pages: [
        { title: `Zebra ${run} guide`, body: 'Feeding zebras every morning.' },
        { title: 'Unrelated', body: `A zebra ${run} appears only in the body.` },
        { title: `Zebra ${run} third` },
        { title: `Zebra ${run} fourth` },
        { title: `Zebra ${run} stale`, stale: true },
      ],
    });
    ids.german = await wiki('german', { languages: [{ code: 'de' }], pages: [{ title: `Häuser ${run}`, languageCode: 'de' }] });
    await wiki('private', { accessMode: 'WORKSPACE', pages: [{ title: `Zebra ${run}` }] });
    await wiki('readers', { accessMode: 'READERS', pages: [{ title: `Zebra ${run}` }] });
    await wiki('takendown', { takedownAt: new Date(), pages: [{ title: `Zebra ${run}` }] });
    await wiki('optedout', { config: { search: { crossWikiSearch: false } }, pages: [{ title: `Zebra ${run}` }] });
    await wiki('hiddenlanguage', { languages: [{ code: 'en', enabled: false }], pages: [{ title: `Zebra ${run}` }] });
  }, 60_000);

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: { in: organizations } } });
    await prisma.$disconnect();
  });

  it('returns only opted-in public live wikis other than the current one, at most three hits each', async () => {
    const hits = await searchPublicWikiDocuments(ids.current ?? '', `zebra ${run}`, 3, 30);
    expect(new Set(hits.map((hit) => hit.projectId))).toEqual(new Set([ids.open]));
    expect(hits).toHaveLength(3);
    expect(hits.map((hit) => hit.title)).not.toContain(`Zebra ${run} stale`);
    expect(hits[0]).toMatchObject({ name: 'open', slug: `open-${run}`, defaultLanguage: 'en', primaryDomain: null });
    expect(hits.every((hit, index) => index === 0 || (hits[index - 1]?.rank ?? 0) >= hit.rank)).toBe(true);
  });

  it('ranks title matches above body matches and keeps the total limit', async () => {
    const hits = await searchPublicWikiDocuments(ids.current ?? '', `zebra ${run}`, 3, 2);
    expect(hits).toHaveLength(2);
    expect(hits.map((hit) => hit.title)).not.toContain('Unrelated');
  });

  it("matches each page in its own language's configuration", async () => {
    const hits = await searchPublicWikiDocuments(ids.current ?? '', `haus ${run}`, 3, 30);
    expect(hits.map((hit) => hit.projectId)).toEqual([ids.german]);
  });

  it('builds a plain snippet around the match', async () => {
    const [hit] = await searchPublicWikiDocuments(ids.current ?? '', `feeding ${run} OR feeding`, 3, 30);
    expect(hit?.snippet).toContain('Feeding');
    expect(hit?.snippet).not.toMatch(/<\/?b>/);
  });

  it('drops the rows of a deleted project', async () => {
    const id = await wiki('deleted', { pages: [{ title: `Okapi ${run}` }] });
    await prisma.project.delete({ where: { id } });
    expect(await prisma.$queryRaw<unknown[]>`SELECT 1 FROM "page_search_document" WHERE "projectId" = ${id}`).toEqual([]);
  });
});
