import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ projectFindMany: vi.fn() }));

vi.mock('@nibleaf/database', () => ({ prisma: { project: { findMany: mocks.projectFindMany } } }));
vi.mock('@/env', () => ({ env: {} }));
vi.mock('./sites', () => ({ publishedProjectWhere: { takedownAt: null, deployments: { some: { status: 'READY' } } } }));

import { env } from '@/env';
import { listWikiDirectory, WIKI_DIRECTORY_LIMIT } from './wiki-directory';

type Row = { id: string; accessMode: string; takedownAt: Date | null; ready: boolean } & Record<string, unknown>;

const row = (over: Partial<Row> & Pick<Row, 'id'>): Row => ({
  name: over.id,
  slug: over.id,
  description: null,
  icon: null,
  config: null,
  domains: [],
  accessMode: 'PUBLIC',
  takedownAt: null,
  ready: true,
  ...over,
});

/** Applies the where-clause the action sends, as Postgres would. */
const database = (rows: Row[]) => {
  mocks.projectFindMany.mockImplementation(
    async ({ where, take }: { where: { accessMode?: string; takedownAt?: null; deployments?: { some: { status: string } } }; take: number }) =>
      rows
        .filter((r) => r.accessMode === where.accessMode)
        .filter((r) => where.takedownAt !== null || r.takedownAt === null)
        .filter((r) => where.deployments?.some.status !== 'READY' || r.ready)
        .slice(0, take),
  );
};

let now = 0;
beforeEach(() => {
  vi.clearAllMocks();
  now += 60_000;
  vi.spyOn(Date, 'now').mockReturnValue(now);
  Object.assign(env, { TENANCY: 'shared', APP_URL: 'https://wiki.example/', SITE_BASE_DOMAIN: undefined });
});

describe('listWikiDirectory', () => {
  it('has no directory outside shared tenancy', async () => {
    Object.assign(env, { TENANCY: 'independent' });
    await expect(listWikiDirectory()).resolves.toBeNull();
    expect(mocks.projectFindMany).not.toHaveBeenCalled();
  });

  it('lists only public, published wikis that are not taken down', async () => {
    database([
      row({ id: 'open' }),
      row({ id: 'members', accessMode: 'WORKSPACE' }),
      row({ id: 'readers', accessMode: 'READERS' }),
      row({ id: 'draft', ready: false }),
      row({ id: 'removed', takedownAt: new Date() }),
    ]);
    const wikis = await listWikiDirectory();
    expect(wikis?.map((wiki) => wiki.id)).toEqual(['open']);
  });

  it('exposes only listing fields', async () => {
    database([
      row({
        id: 'p1',
        name: 'Handbook',
        slug: 'handbook',
        description: '  Team docs. ',
        icon: '📘',
        config: { branding: { logoLight: 'https://cdn.example/logo.svg' }, analytics: { id: 'secret' } },
      }),
    ]);
    await expect(listWikiDirectory()).resolves.toEqual([
      {
        id: 'p1',
        name: 'Handbook',
        description: 'Team docs.',
        icon: '📘',
        logo: 'https://cdn.example/logo.svg',
        url: 'https://wiki.example/handbook',
      },
    ]);
  });

  it('prefers the favicon and drops non-emoji icons', async () => {
    database([row({ id: 'p1', icon: 'book', config: { branding: { favicon: '/f.png', logoLight: '/l.svg' } } })]);
    const [wiki] = (await listWikiDirectory()) ?? [];
    expect(wiki).toMatchObject({ icon: null, logo: '/f.png' });
  });

  it('builds the URL like the edge: primary domain, slug subdomain, /<slug>, /sites/<id>', async () => {
    database([
      row({ id: 'p1', slug: 'docs', domains: [{ domain: 'Docs.Acme.com' }] }),
      row({ id: 'p2', slug: 'guide' }),
      row({ id: 'p3', slug: 'app' }),
    ]);
    expect((await listWikiDirectory())?.map((wiki) => wiki.url)).toEqual([
      'https://docs.acme.com',
      'https://wiki.example/guide',
      'https://wiki.example/sites/p3',
    ]);

    now += 60_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    Object.assign(env, { SITE_BASE_DOMAIN: '*.wikis.example.' });
    expect((await listWikiDirectory())?.map((wiki) => wiki.url)).toEqual([
      'https://docs.acme.com',
      'https://guide.wikis.example',
      'https://app.wikis.example',
    ]);
  });

  it('caps the listing and orders it by name', async () => {
    database(Array.from({ length: WIKI_DIRECTORY_LIMIT + 1 }, (_, i) => row({ id: `p${i}` })));
    expect(await listWikiDirectory()).toHaveLength(WIKI_DIRECTORY_LIMIT);
    expect(mocks.projectFindMany.mock.calls[0]?.[0]).toMatchObject({ take: WIKI_DIRECTORY_LIMIT, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
  });

  it('serves repeat requests from cache', async () => {
    database([row({ id: 'p1' })]);
    await listWikiDirectory();
    await listWikiDirectory();
    expect(mocks.projectFindMany).toHaveBeenCalledTimes(1);
  });
});
