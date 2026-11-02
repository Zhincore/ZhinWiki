import { Hono } from 'hono';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { errorMiddleware } from '@/errors/handler';
import type { HonoEnv } from '@/lib/hono/context';
import { byteBudget, rateLimit } from './rate-limit';

describe('rate-limit retry guidance', () => {
  // Pin the per-process store whatever the shell exports.
  beforeAll(() => {
    delete process.env.REDIS_HOST;
  });

  afterEach(() => vi.useRealTimers());

  it('reports the remaining window and permits requests after it expires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-17T12:00:00Z'));
    const app = new Hono<HonoEnv>();
    app.onError(errorMiddleware({ isDevelopment: false }));
    app.use('*', rateLimit({ name: 'test', windowMs: 60_000, max: 1 }));
    app.get('/', (context) => context.json({ ok: true }));
    expect((await app.request('/')).status).toBe(200);
    vi.setSystemTime(new Date('2026-10-17T12:00:32.200Z'));
    const rejected = await app.request('/');
    expect(rejected.status).toBe(429);
    expect(rejected.headers.get('retry-after')).toBe('28');
    expect(await rejected.json()).toMatchObject({ error: { code: 'http:rate_limited' } });
    vi.setSystemTime(new Date('2026-10-17T12:01:00.001Z'));
    const recovered = await app.request('/');
    expect(recovered.status).toBe(200);
    expect(recovered.headers.get('retry-after')).toBeNull();
  });

  it('buckets by the key option and exempts requests keyed null', async () => {
    const app = new Hono<HonoEnv>();
    app.onError(errorMiddleware({ isDevelopment: false }));
    app.use('*', rateLimit({ name: 'test-keyed', windowMs: 60_000, max: 1, key: (context) => context.req.header('x-user') ?? null }));
    app.get('/', (context) => context.json({ ok: true }));
    const as = (user?: string) => app.request('/', { headers: user ? { 'x-user': user } : {} });
    expect((await as('a')).status).toBe(200);
    expect((await as('a')).status).toBe(429);
    expect((await as('b')).status).toBe(200);
    expect((await as()).status).toBe(200);
    expect((await as()).status).toBe(200);
  });

  it('refuses once the byte budget is spent until enough bytes leave the window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-17T12:00:00Z'));
    const budget = byteBudget({ name: 'test-bytes', windowMs: 60_000, maxBytes: 100, key: () => 'user' });
    const app = new Hono<HonoEnv>();
    app.onError(errorMiddleware({ isDevelopment: false }));
    app.post('/', budget.guard, async (context) => {
      await budget.record(context, Number(context.req.query('bytes')));
      return context.json({ ok: true });
    });
    const send = (bytes: number) => app.request(`/?bytes=${bytes}`, { method: 'POST' });
    expect((await send(40)).status).toBe(200);
    vi.setSystemTime(new Date('2026-10-17T12:00:10Z'));
    expect((await send(70)).status).toBe(200);
    vi.setSystemTime(new Date('2026-10-17T12:00:20Z'));
    const rejected = await send(1);
    expect(rejected.status).toBe(429);
    expect(rejected.headers.get('retry-after')).toBe('40');
    expect(await rejected.json()).toMatchObject({ error: { code: 'http:rate_limited' } });
    vi.setSystemTime(new Date('2026-10-17T12:01:00.001Z'));
    expect((await send(1)).status).toBe(200);
  });
});
