import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

const upstream = (body: unknown, statusCode = 200) => ({ body, ok: statusCode >= 200 && statusCode < 300, statusCode, headers: {} });

const serverWith = async (homepage: string) => {
  vi.stubEnv('HOMEPAGE', homepage);
  vi.resetModules();
  return (await import('./server')).default;
};

describe('HOMEPAGE server entry', () => {
  let rendered: Request[];

  beforeEach(() => {
    rendered = [];
    vi.clearAllMocks();
    mocks.startHandler.mockImplementation(async (request) => {
      rendered.push(request);
      return new Response('<!doctype html><title>Rendered</title>', { headers: { 'content-type': 'text/html' } });
    });
    mocks.got.mockImplementation(async (url: string) => {
      if (url.endsWith('/api/public/sites/home')) {
        return upstream({ data: { project: { config: { visibility: 'public' }, primaryDomain: null } } });
      }
      if (url.endsWith('/api/public/sites/home/robots.txt')) {
        return upstream(
          'User-agent: OAI-SearchBot\nAllow: /\n\nUser-agent: *\nAllow: /\nSitemap: http://localhost:4310/api/public/sites/home/sitemap.xml\n',
        );
      }
      return upstream('Not found', 404);
    });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('redirects the app-mode root to the dashboard with a relative Location', async () => {
    const server = await serverWith('app');
    const response = await server.fetch(new Request('http://localhost:4310/?ref=x', { headers: { 'x-forwarded-proto': 'https' } }));

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/app?ref=x');
    expect(mocks.startHandler).not.toHaveBeenCalled();
  });

  it('leaves app-mode marketing paths to the router unchanged', async () => {
    const server = await serverWith('app');
    await server.fetch(new Request('http://localhost:4310/pricing', { headers: { accept: 'text/html' } }));

    expect(new URL(rendered[0]?.url ?? '').pathname).toBe('/pricing');
  });

  it('serves the home site at the root with both markers', async () => {
    const server = await serverWith('site:home');
    await server.fetch(new Request('http://localhost:4310/guides', { headers: { accept: 'text/html', 'x-forwarded-proto': 'https' } }));

    expect(new URL(rendered[0]?.url ?? '').pathname).toBe('/sites/home/guides');
    expect(rendered[0]?.headers.get('x-nibleaf-home-site')).toBe('home');
    expect(rendered[0]?.headers.get('x-nibleaf-site-origin')).toBe('https://localhost:4310');
  });

  it('passes dashboard GET and POST requests through without a marker, keeping the body', async () => {
    const server = await serverWith('site:home');
    await server.fetch(new Request('http://localhost:4310/app', { headers: { accept: 'text/html', 'x-nibleaf-home-site': 'spoofed' } }));
    await server.fetch(new Request('http://localhost:4310/_serverFn/abc', { method: 'POST', body: '{"a":1}' }));

    expect(new URL(rendered[0]?.url ?? '').pathname).toBe('/app');
    expect(rendered[0]?.headers.has('x-nibleaf-home-site')).toBe(false);
    expect(rendered[1]?.method).toBe('POST');
    expect(rendered[1]?.headers.has('x-nibleaf-home-site')).toBe(false);
    expect(await rendered[1]?.text()).toBe('{"a":1}');
  });

  it('keeps security.txt with the app and dashboard paths out of every robots group', async () => {
    const server = await serverWith('site:home');
    const security = await server.fetch(new Request('http://localhost:4310/.well-known/security.txt'));
    const robots = await (await server.fetch(new Request('http://localhost:4310/robots.txt'))).text();

    expect(security.status).toBe(404);
    expect(mocks.got.mock.calls.some(([url]) => String(url).includes('security.txt'))).toBe(false);
    expect(robots).toBe(
      [
        'User-agent: OAI-SearchBot',
        'Disallow: /app/',
        'Disallow: /app$',
        'Disallow: /sign-in',
        'Disallow: /sign-up',
        'Disallow: /api/',
        'Allow: /',
        '',
        'User-agent: *',
        'Disallow: /app/',
        'Disallow: /app$',
        'Disallow: /sign-in',
        'Disallow: /sign-up',
        'Disallow: /api/',
        'Allow: /',
        'Sitemap: http://localhost:4310/sitemap.xml',
        '',
      ].join('\n'),
    );
  });
});
