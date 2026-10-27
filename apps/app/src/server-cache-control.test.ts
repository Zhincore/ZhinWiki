import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  got: vi.fn(),
  startHandler: vi.fn<(request: Request) => Promise<Response>>(),
}));

vi.mock('@tanstack/react-start/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-start/server')>()),
  createStartHandler: () => mocks.startHandler,
  defaultStreamHandler: vi.fn(),
}));
vi.mock('got', () => ({ default: mocks.got }));
vi.mock('@nibleaf/i18n', () => ({ translateFn: () => 'synthetic translation' }));
vi.mock('@/lib/blog', () => ({ BLOG_ENTRIES: [] }));
vi.mock('@/env.server', () => ({
  serverEnv: {
    APP_URL: 'http://localhost:4310',
    CUSTOM_DOMAIN_EDGE_SECRET: '',
    INTERNAL_API_SECRET: '',
    PORT: 4310,
    TRUSTED_PROXY_HOPS: 0,
  },
}));

import server from './server';

const PUBLIC_SITE_CACHE = 'public, s-maxage=60, stale-while-revalidate=300';

const upstream = (body: unknown, cacheControl?: string, statusCode = 200) => ({
  body,
  ok: statusCode >= 200 && statusCode < 300,
  statusCode,
  headers: cacheControl ? { 'cache-control': cacheControl } : {},
});

const html = (init?: ResponseInit) =>
  new Response('<!doctype html><title>Page</title>', { ...init, headers: { 'content-type': 'text/html', ...init?.headers } });

const fetchPath = (path: string, headers: Record<string, string> = { accept: 'text/html' }) =>
  server.fetch(new Request(`http://localhost:4310${path}`, { headers }));

describe('app Cache-Control policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.startHandler.mockReset().mockResolvedValue(html());
    mocks.got.mockImplementation(async (url: string) => {
      if (url.endsWith('/api/public/sites/public-site')) {
        return upstream({ data: { project: { config: { visibility: 'public' }, primaryDomain: null } } }, PUBLIC_SITE_CACHE);
      }
      if (url.endsWith('/api/public/sites/private-site')) {
        return upstream({ data: { project: { config: { visibility: 'private' }, primaryDomain: null } } }, 'private, no-store');
      }
      if (url.includes('/api/public/sites/public-site/markdown?')) return upstream('# Guide\n', PUBLIC_SITE_CACHE);
      if (url.includes('/api/public/sites/private-site/markdown?')) return upstream('Not found', undefined, 404);
      if (url.endsWith('/api/public/sites/public-site/robots.txt')) return upstream('User-agent: *\nAllow: /\n', PUBLIC_SITE_CACHE);
      throw new Error(`Unexpected URL: ${url}`);
    });
  });

  it('never lets a shared cache store dashboard HTML', async () => {
    const response = await fetchPath('/app');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('keeps an auth page that sets a cookie private', async () => {
    mocks.startHandler.mockResolvedValueOnce(html({ headers: { 'set-cookie': 'NIBLEAF_LOCALE=en; Path=/' } }));
    const response = await fetchPath('/sign-in');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('defaults server function responses to private, no-store', async () => {
    mocks.startHandler.mockResolvedValueOnce(new Response('{"result":[]}', { headers: { 'content-type': 'application/json' } }));
    const response = await fetchPath('/_serverFn/projects', { accept: 'application/json' });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('overrides a public policy on a non-HTML response that sets a cookie', async () => {
    mocks.startHandler.mockResolvedValueOnce(
      new Response('{}', { headers: { 'cache-control': 'public, max-age=60', 'content-type': 'application/json', 'set-cookie': 'a=b' } }),
    );
    const response = await fetchPath('/_serverFn/session', { accept: 'application/json' });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('keeps session-dependent router redirects out of shared caches', async () => {
    mocks.startHandler.mockResolvedValueOnce(Response.redirect('http://localhost:4310/sign-in', 307));
    const response = await fetchPath('/app/projects');
    expect(response.status).toBe(307);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('serves public published-site HTML as private, no-store because of its per-response CSP nonce', async () => {
    const response = await fetchPath('/sites/public-site/guide');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('content-security-policy')).toContain("'nonce-");
  });

  it('keeps Markdown negotiated at the HTML URL out of Vary-blind shared caches', async () => {
    const response = await fetchPath('/sites/public-site/guide', { accept: 'text/markdown' });
    expect(response.headers.get('content-type')).toContain('text/markdown');
    expect(response.headers.get('vary')).toContain('Accept');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('keeps the shared-cache policy on the dedicated .md alias URL', async () => {
    const response = await fetchPath('/sites/public-site/guide.md', { accept: '*/*' });
    expect(response.headers.get('content-type')).toContain('text/markdown');
    expect(response.headers.get('cache-control')).toBe(PUBLIC_SITE_CACHE);
  });

  it('never caches a private site Markdown request', async () => {
    const response = await fetchPath('/sites/private-site/guide.md', { accept: '*/*' });
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('forwards the API policy for published-site machine files', async () => {
    const response = await fetchPath('/sites/public-site/robots.txt', { accept: '*/*' });
    expect(response.headers.get('cache-control')).toBe(PUBLIC_SITE_CACHE);
  });

  it('gives the self-hosted root robots.txt a short public lifetime', async () => {
    const response = await fetchPath('/robots.txt', { accept: '*/*' });
    expect(response.headers.get('cache-control')).toBe('public, max-age=300');
  });
});
