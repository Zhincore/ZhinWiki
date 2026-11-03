import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { getSiteFn } from '@/functions/site';

const mocks = vi.hoisted(() => ({ getSite: vi.fn() }));
vi.mock('@/services/api', () => ({ api: { public: { sites: { ':id': { $get: mocks.getSite } } } } }));
vi.mock('@/lib/site-origin', () => ({ customDomainOrigin: () => null }));
vi.mock('@tanstack/react-start', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-start')>()),
  // Keep the real server function's schema and handler; replace only its transport.
  createServerFn: () => ({
    validator: <T>(schema: { parse: (input: unknown) => T }) => ({
      handler:
        <TResult>(handler: (input: { data: T }) => TResult) =>
        async ({ data }: { data: unknown }) =>
          handler({ data: schema.parse(data) }),
    }),
    handler: <T>(handler: T) => handler,
  }),
}));

import { Route } from './route';

const load = (projectId = 'qa-site', pathname = '/sites/qa-site/guide', lang: string | undefined = 'ar') => {
  const loader = Route.options.loader as (input: {
    params: { projectId: string };
    deps: { lang?: string };
    location: { pathname: string };
  }) => Promise<unknown>;
  return loader({ params: { projectId }, deps: { lang }, location: { pathname } });
};

const apiError = (status: number) =>
  Response.json({ error: { code: 'UPSTREAM_FAILURE', message: 'Temporarily unavailable' } }, { status, headers: { 'retry-after': '30' } });

beforeEach(() => {
  mocks.getSite.mockReset();
});

describe('published reader route input', () => {
  it('retains the real server function validator before reaching the API', async () => {
    await expect(getSiteFn({ data: { projectId: 'qa-site', language: '' } })).rejects.toBeInstanceOf(ZodError);
    expect(mocks.getSite).not.toHaveBeenCalled();
  });

  it.each([
    ['$projectId', '/sites/$projectId'],
    ['$projectId', '/sites/%24projectId'],
    ['[', '/sites/['],
    ['[', '/sites/%5B'],
    ['+', '/sites/+'],
    ['+', '/sites/%2B'],
    ['a.b', '/sites/a.b'],
    ['productops-invalid-20261021', '/sites/productops-invalid-20261021'],
  ])('lets missing identifier %s at %s reach the normal not-found lookup', async (projectId, pathname) => {
    mocks.getSite.mockResolvedValueOnce(apiError(404));

    await expect(load(projectId, pathname)).resolves.toEqual({ site: null, siteOrigin: null });
    expect(mocks.getSite).toHaveBeenCalledExactlyOnceWith({ param: { id: projectId }, query: { lang: 'ar' } });
  });

  it.each([
    ['$projectId', '/sites/%24projectId/v2/guide', 'en'],
    ['+', '/sites/%2B/المقدمة', 'ar'],
    ['qa-site', '/sites/qa-site', 'en'],
    ['qa-site', '/sites/qa-site/changelog', 'ar'],
  ])('requests only the language for %s at %s', async (projectId, pathname, lang) => {
    const site = { project: { id: projectId }, nav: [], languages: [] };
    mocks.getSite.mockResolvedValueOnce(Response.json({ data: site }));

    await expect(load(projectId, pathname, lang)).resolves.toEqual({ site, siteOrigin: null });
    expect(mocks.getSite).toHaveBeenCalledExactlyOnceWith({ param: { id: projectId }, query: { lang } });
  });
});

describe('published reader failure recovery', () => {
  it('keeps a genuine missing or privacy-hidden publication unavailable', async () => {
    mocks.getSite.mockResolvedValueOnce(apiError(404));
    await expect(load()).resolves.toEqual({ site: null, siteOrigin: null });
  });
  it.each([429, 500, 503])('preserves HTTP %i failures for the retryable error boundary', async (status) => {
    mocks.getSite.mockResolvedValueOnce(apiError(status));
    await expect(load()).rejects.toMatchObject({ name: 'ApiResponseError', status, code: 'UPSTREAM_FAILURE', retryAfter: '30' });
  });
  it('preserves network failures instead of claiming content was never published', async () => {
    const error = new TypeError('fetch failed');
    mocks.getSite.mockRejectedValueOnce(error);
    await expect(load()).rejects.toBe(error);
  });
});
