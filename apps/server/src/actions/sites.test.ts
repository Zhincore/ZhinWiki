import type { SiteSnapshot, SnapshotPage } from '@nibleaf/shared/site';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  projectFindUnique: vi.fn(),
  projectFindFirst: vi.fn(),
  searchPublicWikiDocuments: vi.fn(),
  trackProjectEvent: vi.fn(),
  deploymentFindFirst: vi.fn(),
  deploymentFindUnique: vi.fn(),
  searchDocs: vi.fn(),
  runPublishedSearch: vi.fn(),
  getCachedIndex: vi.fn(),
}));

vi.mock('@nibleaf/database', () => ({
  prisma: {
    project: { findUnique: mocks.projectFindUnique, findFirst: mocks.projectFindFirst },
    deployment: { findFirst: mocks.deploymentFindFirst, findUnique: mocks.deploymentFindUnique },
  },
}));
vi.mock('@nibleaf/search', () => ({ searchDocs: mocks.searchDocs }));
vi.mock('hono/context-storage', () => ({ getContext: () => ({ req: { raw: { headers: new Headers() } } }) }));
vi.mock('@/env', () => ({ env: {} }));
vi.mock('@/lib/ai-search/quota', () => ({ consumeAnswerQuota: vi.fn() }));
vi.mock('@/lib/ai-search/runtime', () => ({
  answerPublishedSearch: vi.fn(),
  answerSearchAvailable: vi.fn(),
  runPublishedSearch: mocks.runPublishedSearch,
}));
vi.mock('@/lib/search-cache', () => ({ getCachedIndex: mocks.getCachedIndex }));
vi.mock('@/lib/cross-wiki-search', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/cross-wiki-search')>()),
  searchPublicWikiDocuments: mocks.searchPublicWikiDocuments,
}));
vi.mock('./analytics', () => ({ trackProjectEvent: mocks.trackProjectEvent }));
vi.mock('./notifications', () => ({ createNotificationsForOrgMembers: vi.fn() }));
vi.mock('./reader-access', () => ({ resolveViewerAccess: vi.fn(async () => ({ kind: 'public', allowedPageIds: null })) }));

import { env } from '@/env';
import { CROSS_WIKI_HITS_PER_WIKI, CROSS_WIKI_RESULT_LIMIT } from '@/lib/cross-wiki-search';
import { getSitePage, getSitePageMarkdown, invalidatePublishedSiteConfig, resolveSiteSlug, searchSite } from './sites';

const page = (over: Partial<SnapshotPage> & Pick<SnapshotPage, 'id' | 'path' | 'position'>): SnapshotPage => ({
  parentId: null,
  updatedAt: '2026-08-01T00:00:00.000Z',
  languageCode: 'en',
  kind: 'PAGE',
  title: over.path,
  slug: over.path,
  icon: null,
  description: null,
  content: '',
  config: null,
  translationKey: null,
  hidden: false,
  ...over,
});

const body =
  'Get started with the Acme API in about ten minutes. This guide walks you through creating an API key, making your first request, and paginating through results.';

const snapshot: SiteSnapshot = {
  project: {
    id: 'project-1',
    name: 'Docs',
    slug: 'docs',
    description: null,
    icon: null,
    config: {},
    languages: [{ code: 'en', label: 'English', direction: 'LTR', isDefault: true, config: null }],
  },
  pages: [
    page({ id: 'page-lede', path: 'authentication', position: 0, title: 'Authentication', description: '  How tokens work.  ', content: body }),
    page({ id: 'page-no-lede', path: 'getting-started', position: 1, title: 'Getting started', content: `# Getting started\n\n${body}` }),
  ],
  generatedAt: '2026-08-01T00:00:00.000Z',
};

describe('getSitePage lede vs excerpt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.projectFindUnique.mockImplementation(async ({ select }: { select: Record<string, unknown> }) =>
      'name' in select
        ? {
            name: 'Docs',
            slug: 'docs',
            description: null,
            icon: null,
            config: {},
            accessMode: 'PUBLIC',
            takedownAt: null,
            domains: [],
            languages: [{ code: 'en', enabled: true, config: null, projectTranslations: [] }],
            addons: [],
            organization: { usagePlan: null },
          }
        : { id: 'project-1' },
    );
    mocks.deploymentFindFirst.mockResolvedValue({ id: `deployment-${Math.random()}`, version: 1 });
    mocks.deploymentFindUnique.mockResolvedValue({ snapshot });
  });

  it('serves the trimmed author-written description as the lede alongside the excerpt', async () => {
    const result = await getSitePage('project-1', 'authentication');
    expect(result.page.description).toBe('How tokens work.');
    expect(result.page.excerpt).toBe(body);
  });

  it('never promotes the derived excerpt to a lede when the author wrote no description', async () => {
    const result = await getSitePage('project-1', 'getting-started');
    expect(result.page.description).toBeNull();
    // The excerpt still exists for SEO/social meta — cut on a word boundary.
    expect(result.page.excerpt).toBe(
      'Getting started Get started with the Acme API in about ten minutes. This guide walks you through creating an API key, making your first request, and…',
    );
    expect(result.page.excerpt.length).toBeLessThanOrEqual(160);
  });

  it('serves a public page as title, summary, and authored Markdown', async () => {
    const result = await getSitePageMarkdown('project-1', 'authentication');
    expect(result).toEqual({
      body: `# Authentication\n\n> How tokens work.\n\n${body}\n`,
      isPrivate: false,
    });
  });

  it('serves an exact Arabic path and rejects a requested locale that fell back to English', async () => {
    const languages = [
      { code: 'en', label: 'English', direction: 'LTR' as const, isDefault: true, config: null },
      { code: 'ar', label: 'Arabic', direction: 'RTL' as const, isDefault: false, config: null },
    ];
    mocks.projectFindUnique.mockImplementation(async ({ select }: { select: Record<string, unknown> }) =>
      'name' in select
        ? {
            name: 'Docs',
            slug: 'docs',
            description: null,
            icon: null,
            config: {},
            accessMode: 'PUBLIC',
            takedownAt: null,
            domains: [],
            languages: languages.map((language) => ({ code: language.code, enabled: true, config: null, projectTranslations: [] })),
            addons: [],
            organization: { usagePlan: null },
          }
        : { id: 'project-1' },
    );
    invalidatePublishedSiteConfig('project-1');
    mocks.deploymentFindFirst.mockResolvedValue({ id: `deployment-ar-${Math.random()}`, version: 1 });
    mocks.deploymentFindUnique.mockResolvedValue({
      snapshot: {
        ...snapshot,
        project: { ...snapshot.project, languages },
        pages: [snapshot.pages[0], page({ id: 'page-ar', path: 'المقدمة', position: 1, languageCode: 'ar', title: 'المقدمة', content: 'ابدأ هنا.' })],
      },
    });

    await expect(getSitePageMarkdown('project-1', 'المقدمة', 'ar')).resolves.toMatchObject({ body: '# المقدمة\n\nابدأ هنا.\n' });
    await expect(getSitePageMarkdown('project-1', 'authentication', 'ar')).rejects.toMatchObject({
      status: 404,
      details: { language: 'ar', reason: 'language_fallback' },
    });
  });

  it('fails closed for noindex and private-reader content even when the viewer is authorized', async () => {
    mocks.deploymentFindFirst.mockResolvedValueOnce({ id: `deployment-noindex-${Math.random()}`, version: 1 });
    mocks.deploymentFindUnique.mockResolvedValueOnce({
      snapshot: {
        ...snapshot,
        pages: [{ ...snapshot.pages[0], config: { seo: { noindex: true } } }],
      },
    });
    await expect(getSitePageMarkdown('project-1', 'authentication')).rejects.toMatchObject({ status: 404 });

    mocks.deploymentFindFirst.mockResolvedValueOnce({ id: `deployment-canonical-${Math.random()}`, version: 1 });
    mocks.deploymentFindUnique.mockResolvedValueOnce({
      snapshot: {
        ...snapshot,
        pages: [{ ...snapshot.pages[0], config: { seo: { canonicalUrl: 'https://origin.example/authentication' } } }],
      },
    });
    await expect(getSitePageMarkdown('project-1', 'authentication')).rejects.toMatchObject({ status: 404 });

    mocks.deploymentFindFirst.mockResolvedValueOnce({ id: `deployment-hidden-${Math.random()}`, version: 1 });
    mocks.deploymentFindUnique.mockResolvedValueOnce({
      snapshot: { ...snapshot, pages: [{ ...snapshot.pages[0], hidden: true }] },
    });
    await expect(getSitePageMarkdown('project-1', 'authentication')).rejects.toMatchObject({ status: 404 });

    mocks.projectFindUnique.mockImplementation(async ({ select }: { select: Record<string, unknown> }) =>
      'name' in select
        ? {
            name: 'Docs',
            slug: 'docs',
            description: null,
            icon: null,
            config: {},
            accessMode: 'READERS',
            takedownAt: null,
            domains: [],
            languages: [{ code: 'en', enabled: true, config: null, projectTranslations: [] }],
            addons: [],
            organization: { usagePlan: null },
          }
        : { id: 'project-1' },
    );
    invalidatePublishedSiteConfig('project-1');
    mocks.deploymentFindFirst.mockResolvedValueOnce({ id: `deployment-private-${Math.random()}`, version: 1 });
    mocks.deploymentFindUnique.mockResolvedValueOnce({ snapshot });
    await expect(getSitePageMarkdown('project-1', 'authentication')).rejects.toMatchObject({ status: 404 });
  });

  it('fails closed when the resolved language disables indexing', async () => {
    mocks.projectFindUnique.mockImplementation(async ({ select }: { select: Record<string, unknown> }) =>
      'name' in select
        ? {
            name: 'Docs',
            slug: 'docs',
            description: null,
            icon: null,
            config: {},
            accessMode: 'PUBLIC',
            takedownAt: null,
            domains: [],
            languages: [{ code: 'en', enabled: true, config: { seo: { allowIndex: false } }, projectTranslations: [] }],
            addons: [],
            organization: { usagePlan: null },
          }
        : { id: 'project-1' },
    );
    invalidatePublishedSiteConfig('project-1');
    mocks.deploymentFindFirst.mockResolvedValueOnce({ id: `deployment-language-noindex-${Math.random()}`, version: 1 });
    mocks.deploymentFindUnique.mockResolvedValueOnce({
      snapshot: {
        ...snapshot,
        project: {
          ...snapshot.project,
          languages: [{ ...snapshot.project.languages[0], config: { seo: { allowIndex: false } } }],
        },
      },
    });

    await expect(getSitePageMarkdown('project-1', 'authentication', 'en')).rejects.toMatchObject({ status: 404 });
  });
});

describe('searchSite multilingual scope', () => {
  const multilingualSnapshot: SiteSnapshot = {
    ...snapshot,
    project: {
      ...snapshot.project,
      languages: [
        { code: 'en', label: 'English', direction: 'LTR', isDefault: true, config: null },
        { code: 'ar', label: 'Arabic', direction: 'RTL', isDefault: false, config: null },
      ],
    },
    pages: [
      page({ id: 'page-en', path: 'authentication', position: 0, languageCode: 'en', title: 'Authentication' }),
      page({ id: 'page-ar', path: 'authentication', position: 0, languageCode: 'ar', title: 'المصادقة' }),
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.projectFindUnique.mockImplementation(async ({ select }: { select: Record<string, unknown> }) =>
      'name' in select
        ? {
            name: 'Docs',
            slug: 'docs',
            description: null,
            icon: null,
            config: {},
            accessMode: 'PUBLIC',
            takedownAt: null,
            domains: [],
            languages: [
              { code: 'en', enabled: true, config: null, projectTranslations: [] },
              { code: 'ar', enabled: true, config: null, projectTranslations: [] },
            ],
            addons: [],
            organization: { usagePlan: null },
          }
        : { id: 'project-1' },
    );
    mocks.deploymentFindFirst.mockResolvedValue({ id: `deployment-search-${Math.random()}`, version: 1 });
    mocks.deploymentFindUnique.mockResolvedValue({ snapshot: multilingualSnapshot });
    mocks.getCachedIndex.mockImplementation(async (_projectId: string, _key: string, language: string) => ({ language }));
    mocks.searchDocs.mockImplementation(async (index: { language: string }) => [
      {
        id: `page-${index.language}`,
        title: index.language === 'ar' ? 'المصادقة' : 'Authentication',
        path: 'authentication',
        description: '',
        snippet: index.language === 'ar' ? 'استخدم رمزاً' : 'Use a token',
        score: index.language === 'ar' ? 20 : 10,
      },
    ]);
    mocks.runPublishedSearch.mockImplementation(async (_scope: unknown, _query: string, _limit: number, legacy: () => Promise<unknown[]>) => ({
      hits: await legacy(),
      runtime: 'legacy',
    }));
  });

  it('searches all published languages and annotates each result for localized routing', async () => {
    const result = await searchSite('project-1', 'token');
    expect(mocks.getCachedIndex.mock.calls.map((call) => call[2])).toEqual(['en', 'ar']);
    expect(result.hits).toEqual([
      expect.objectContaining({ id: 'page-ar', language: 'ar' }),
      expect.objectContaining({ id: 'page-en', language: 'en' }),
    ]);
  });

  it('keeps an explicit language scope for API clients', async () => {
    const result = await searchSite('project-1', 'token', 'ar');
    expect(mocks.getCachedIndex).toHaveBeenCalledTimes(1);
    expect(mocks.getCachedIndex.mock.calls[0]?.[2]).toBe('ar');
    expect(result.hits).toEqual([expect.objectContaining({ id: 'page-ar', language: 'ar' })]);
  });
});

describe('resolveSiteSlug', () => {
  type Where = { slug?: string; config?: { array_contains: string[] }; takedownAt?: null; deployments?: unknown };
  /** `p1` is published as `handbook` and still remembers `guide`. */
  const published = async ({ where }: { where: Where }) => {
    if (where.takedownAt !== null || !where.deployments) return null;
    return where.slug === 'handbook' || where.config?.array_contains[0] === 'guide' ? { id: 'p1', slug: 'handbook' } : null;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.projectFindFirst.mockImplementation(published);
  });

  it('resolves nothing outside shared tenancy', async () => {
    Object.assign(env, { TENANCY: 'independent' });
    await expect(resolveSiteSlug('handbook')).resolves.toBeNull();
    expect(mocks.projectFindFirst).not.toHaveBeenCalled();
  });

  it('resolves only a published wiki, by its current or a previous slug', async () => {
    Object.assign(env, { TENANCY: 'shared' });
    await expect(resolveSiteSlug('handbook')).resolves.toEqual({ projectId: 'p1', slug: 'handbook' });
    await expect(resolveSiteSlug('guide')).resolves.toEqual({ projectId: 'p1', slug: 'handbook' });
    await expect(resolveSiteSlug('missing')).resolves.toBeNull();
  });
});

describe('searchSite across wikis', () => {
  const live = (config: Record<string, unknown> = {}) => ({
    name: 'Home wiki',
    slug: 'home',
    description: null,
    icon: null,
    config,
    accessMode: 'PUBLIC',
    takedownAt: null,
    domains: [],
    languages: [{ code: 'en', enabled: true, config: null, projectTranslations: [] }],
    addons: [],
    organization: { usagePlan: null },
  });

  const row = (projectId: string, pageId: string, rank: number, over: Record<string, unknown> = {}) => ({
    projectId,
    name: `Wiki ${projectId}`,
    slug: projectId,
    primaryDomain: null,
    defaultLanguage: 'en',
    pageId,
    languageCode: 'en',
    title: pageId,
    path: pageId,
    icon: null,
    snippet: `${pageId} snippet`,
    rank,
    ...over,
  });

  const setup = (config: Record<string, unknown> = {}) => {
    invalidatePublishedSiteConfig('home');
    mocks.projectFindUnique.mockImplementation(async ({ select }: { select: Record<string, unknown> }) =>
      'name' in select ? live(config) : { id: 'home' },
    );
    mocks.deploymentFindFirst.mockResolvedValue({ id: `deployment-home-${Math.random()}`, version: 1 });
    mocks.deploymentFindUnique.mockResolvedValue({ snapshot: { ...snapshot, project: { ...snapshot.project, id: 'home', slug: 'home' } } });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(env, { TENANCY: 'shared', APP_URL: 'https://wiki.example', SITE_BASE_DOMAIN: undefined });
    mocks.getCachedIndex.mockResolvedValue({});
    mocks.searchDocs.mockResolvedValue(
      ['one', 'two', 'three', 'four'].map((name, rank) => ({
        id: `home-${name}`,
        title: name,
        path: name,
        description: '',
        snippet: name,
        score: 1 - rank / 10,
      })),
    );
    mocks.runPublishedSearch.mockImplementation(async (_scope: unknown, _query: string, _limit: number, legacy: () => Promise<unknown[]>) => ({
      hits: await legacy(),
      runtime: 'legacy',
    }));
    mocks.searchPublicWikiDocuments.mockResolvedValue([]);
  });

  const groupsOf = (result: Awaited<ReturnType<typeof searchSite>>) => ('groups' in result ? (result.groups ?? []) : []);

  it('puts the current wiki first and groups full-text hits of other wikis with their public URLs', async () => {
    setup();
    mocks.searchPublicWikiDocuments.mockResolvedValue([
      row('beta', 'install', 0.9),
      row('alpha', 'guide', 0.5, { languageCode: 'de', primaryDomain: 'Docs.Alpha.Example' }),
      row('beta', 'setup', 0.4),
    ]);
    const result = await searchSite('home', 'guide', undefined, 10, 'all');
    expect(mocks.searchPublicWikiDocuments).toHaveBeenCalledWith('home', 'guide', CROSS_WIKI_HITS_PER_WIKI, CROSS_WIKI_RESULT_LIMIT);
    expect(result).toMatchObject({
      groups: [
        { wiki: { id: 'home', current: true }, hits: [{ id: 'home-one' }, { id: 'home-two' }, { id: 'home-three' }] },
        {
          wiki: { id: 'beta', name: 'Wiki beta', url: 'https://wiki.example/beta', current: false },
          hits: [{ id: 'install', url: 'https://wiki.example/beta/install', snippet: 'install snippet' }, { id: 'setup' }],
        },
        { wiki: { id: 'alpha', url: 'https://docs.alpha.example' }, hits: [{ url: 'https://docs.alpha.example/guide?lang=de', language: 'de' }] },
      ],
      capabilities: { crossWikiSearch: true },
    });
  });

  it('records analytics only for the current wiki', async () => {
    setup();
    mocks.searchPublicWikiDocuments.mockResolvedValue([row('beta', 'install', 0.9)]);
    await searchSite('home', 'guide', undefined, 10, 'all');
    expect(new Set(mocks.trackProjectEvent.mock.calls.map((call) => call[0]))).toEqual(new Set(['home']));
  });

  it('keeps the fused response within the total limit', async () => {
    setup();
    mocks.searchPublicWikiDocuments.mockResolvedValue(
      Array.from({ length: CROSS_WIKI_RESULT_LIMIT }, (_, index) => row(`w${Math.floor(index / 3)}`, `p${index}`, 1 - index / 100)),
    );
    const groups = groupsOf(await searchSite('home', 'guide', undefined, 4, 'all'));
    expect(groups[0]?.hits).toHaveLength(CROSS_WIKI_HITS_PER_WIKI);
    expect(groups.flatMap((group) => group.hits)).toHaveLength(CROSS_WIKI_RESULT_LIMIT);
  });

  it('searches only the current wiki when it opted out', async () => {
    setup({ search: { crossWikiSearch: false } });
    const result = await searchSite('home', 'guide', undefined, 10, 'all');
    expect(groupsOf(result).map((group) => group.wiki.id)).toEqual(['home']);
    expect(result.capabilities.crossWikiSearch).toBe(false);
    expect(mocks.searchPublicWikiDocuments).not.toHaveBeenCalled();
  });

  it('ignores the all-wikis scope under independent tenancy', async () => {
    Object.assign(env, { TENANCY: 'independent' });
    setup();
    const result = await searchSite('home', 'guide', undefined, 10, 'all');
    expect(groupsOf(result).map((group) => group.wiki.id)).toEqual(['home']);
    expect(mocks.searchPublicWikiDocuments).not.toHaveBeenCalled();
  });

  it('keeps the single-wiki response and request limit by default', async () => {
    setup();
    const result = await searchSite('home', 'guide', undefined, 2);
    expect(result).not.toHaveProperty('groups');
    expect('hits' in result && result.hits).toHaveLength(2);
    expect(mocks.searchPublicWikiDocuments).not.toHaveBeenCalled();
  });
});
