import { getRequest } from '@tanstack/react-start/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  got: vi.fn(),
  startHandler: vi.fn(),
  tenancy: 'shared' as 'shared' | 'independent',
}));

vi.mock('@tanstack/react-start/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-start/server')>()),
  createStartHandler: () => mocks.startHandler,
  defaultStreamHandler: vi.fn(),
}));
vi.mock('got', () => ({ default: mocks.got }));
vi.mock('@nibleaf/auth/keys.server', () => ({ keys: () => ({ TENANCY: mocks.tenancy }) }));
vi.mock('@/env.server', () => ({
  serverEnv: { APP_URL: 'http://localhost:4310', CUSTOM_DOMAIN_EDGE_SECRET: '', INTERNAL_API_SECRET: '', PORT: 4310, TRUSTED_PROXY_HOPS: 0 },
}));

const upstream = (body: unknown, statusCode = 200) => ({ body, ok: statusCode >= 200 && statusCode < 300, statusCode, headers: {} });

const SLUGS: Record<string, { projectId: string; slug: string }> = {
  handbook: { projectId: 'p1', slug: 'handbook' },
  'old-handbook': { projectId: 'p1', slug: 'handbook' },
  'home-wiki': { projectId: 'home', slug: 'home-wiki' },
};
const SITE_SLUGS: Record<string, string> = { p1: 'handbook', p2: 'app', home: 'home-wiki' };

/** The entry for a tenancy and `HOMEPAGE`, with fresh module-level caches. */
const loadServer = async (tenancy: 'shared' | 'independent', homepage = '') => {
  vi.resetModules();
  mocks.tenancy = tenancy;
  vi.stubEnv('HOMEPAGE', homepage);
  return (await import('./server')).default;
};

/** What the Start handler received: the routed pathname and the stamped site base URL. */
let rendered: { pathname: string; siteOrigin: string | null } | undefined;

beforeEach(() => {
  rendered = undefined;
  mocks.got.mockReset().mockImplementation(async (url: string) => {
    const target = new URL(url);
    if (target.pathname === '/api/public/sites/resolve') {
      const site = SLUGS[target.searchParams.get('slug') ?? ''];
      return site ? upstream({ data: site }) : upstream({ data: null }, 404);
    }
    const sitemap = /^\/api\/public\/sites\/([^/]+)\/sitemap\.xml$/.exec(target.pathname);
    if (sitemap) return upstream(`<loc>http://localhost:4310/sites/${sitemap[1]}/guide</loc>`);
    if (target.pathname.endsWith('/markdown')) return upstream('Not found', 404);
    const shell = /^\/api\/public\/sites\/([^/]+)$/.exec(target.pathname);
    if (shell?.[1]) {
      return upstream({ data: { project: { config: { visibility: 'public' }, primaryDomain: null, slug: SITE_SLUGS[shell[1]] } } });
    }
    throw new Error(`Unexpected URL: ${url}`);
  });
  mocks.startHandler.mockReset().mockImplementation(async () => {
    const request = getRequest();
    rendered = { pathname: new URL(request.url).pathname, siteOrigin: request.headers.get('x-nibleaf-site-origin') };
    return new Response('<!doctype html><title>Wiki</title>', { headers: { 'content-type': 'text/html' } });
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const get = (server: Awaited<ReturnType<typeof loadServer>>, path: string) =>
  server.fetch(new Request(`http://localhost:4310${path}`, { headers: { accept: 'text/html' } }));
const resolvedSlugs = () => mocks.got.mock.calls.filter(([url]) => String(url).includes('/api/public/sites/resolve'));

describe('wiki slug paths under shared tenancy', () => {
  it('serves /<slug>/* as the wiki with its public base stamped', async () => {
    const server = await loadServer('shared');
    const response = await get(server, '/handbook/guide?tab=cli');

    expect(response.status).toBe(200);
    expect(rendered).toEqual({ pathname: '/sites/p1/guide', siteOrigin: 'http://localhost:4310/handbook' });
  });

  it('301s a previous slug and the internal path to the current slug, keeping the query', async () => {
    const server = await loadServer('shared');

    const previous = await get(server, '/old-handbook/guide?tab=cli');
    expect(previous.status).toBe(301);
    expect(previous.headers.get('location')).toBe('http://localhost:4310/handbook/guide?tab=cli');

    const internal = await get(server, '/sites/p1/guide?tab=cli');
    expect(internal.status).toBe(301);
    expect(internal.headers.get('location')).toBe('http://localhost:4310/handbook/guide?tab=cli');
    expect(rendered).toBeUndefined();
  });

  it('keeps a wiki whose slug clashes with an app path at /sites/:id', async () => {
    const server = await loadServer('shared');
    const response = await get(server, '/sites/p2/guide');

    expect(response.status).toBe(200);
    expect(rendered?.pathname).toBe('/sites/p2/guide');
  });

  it('never resolves app paths as wiki slugs', async () => {
    const server = await loadServer('shared');
    await get(server, '/app/sites');

    expect(resolvedSlugs()).toHaveLength(0);
    expect(rendered?.pathname).toBe('/app/sites');
  });

  it('rebases the machine files onto /<slug>', async () => {
    const server = await loadServer('shared');
    const response = await get(server, '/handbook/sitemap.xml');

    expect(await response.text()).toBe('<loc>http://localhost:4310/handbook/guide</loc>');
  });

  it('lets another wiki slug win over a home-wiki path and moves the home wiki to the root', async () => {
    const server = await loadServer('shared', 'site:home');

    await get(server, '/handbook/guide');
    expect(rendered?.pathname).toBe('/sites/p1/guide');

    await get(server, '/getting-started');
    expect(rendered?.pathname).toBe('/sites/home/getting-started');

    const ownSlug = await get(server, '/home-wiki/getting-started');
    expect(ownSlug.headers.get('location')).toBe('http://localhost:4310/getting-started');
    const internal = await get(server, '/sites/home');
    expect(internal.headers.get('location')).toBe('http://localhost:4310/');
  });
});

describe('independent tenancy', () => {
  it('serves no slug paths and keeps /sites/:id without a redirect', async () => {
    const server = await loadServer('independent');

    expect((await get(server, '/handbook/guide')).status).not.toBe(301);
    expect(resolvedSlugs()).toHaveLength(0);

    const internal = await get(server, '/sites/p1/guide');
    expect(internal.status).toBe(200);
    expect(rendered?.pathname).toBe('/sites/p1/guide');
  });
});
