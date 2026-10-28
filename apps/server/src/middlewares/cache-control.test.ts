import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { AppError } from '@/errors';
import { errorMiddleware } from '@/errors/handler';
import type { HonoEnv } from '@/lib/hono/context';
import { cacheControl } from './cache-control';

const app = new Hono<HonoEnv>();
app.onError(errorMiddleware({ isDevelopment: false }));
app.use('*', cacheControl());
app.get('/api/app/projects', (ctx) => ctx.json({ data: [] }));
app.get('/api/public/sites/site', (ctx) => {
  ctx.header('Cache-Control', 'public, s-maxage=60');
  return ctx.json({ data: {} });
});
app.post('/api/auth/sign-in', (ctx) => {
  ctx.header('Cache-Control', 'public, max-age=60');
  ctx.header('Set-Cookie', 'session=secret; HttpOnly');
  return ctx.json({ ok: true });
});
app.get('/api/app/missing', () => {
  throw new AppError({ code: 'http:not_found' });
});
app.get('/api/app/redirect', (ctx) => ctx.redirect('/sign-in', 302));

const cacheControlOf = async (path: string, init?: RequestInit) => (await app.request(path, init)).headers.get('cache-control');

describe('API cache-control default', () => {
  it('keeps session-dependent JSON out of shared caches', async () => {
    expect(await cacheControlOf('/api/app/projects')).toBe('private, no-store');
  });

  it('preserves a policy chosen by the handler', async () => {
    expect(await cacheControlOf('/api/public/sites/site')).toBe('public, s-maxage=60');
  });

  it('never lets a Set-Cookie response be cached', async () => {
    expect(await cacheControlOf('/api/auth/sign-in', { method: 'POST' })).toBe('private, no-store');
  });

  it('covers error and redirect responses', async () => {
    expect(await cacheControlOf('/api/app/missing')).toBe('private, no-store');
    expect(await cacheControlOf('/api/app/redirect')).toBe('private, no-store');
  });
});
