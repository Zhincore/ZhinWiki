import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@nibleaf/logger', () => ({ logger: { warn: vi.fn() } }));

import { memoryWindow, redisWindow, slidingWindow } from './sliding-window';

describe('memory sliding window', () => {
  afterEach(() => vi.useRealTimers());

  it('admits up to max per key, then reports when the oldest hit expires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-02T12:00:00Z'));
    const window = memoryWindow(60_000, 2);
    expect(await window.hit('a')).toEqual({ allowed: true, retryAfterMs: 0 });
    vi.setSystemTime(new Date('2026-11-02T12:00:10Z'));
    expect((await window.hit('a')).allowed).toBe(true);
    expect(await window.hit('a')).toEqual({ allowed: false, retryAfterMs: 50_000 });
    expect((await window.hit('b')).allowed).toBe(true);
    vi.setSystemTime(new Date('2026-11-02T12:01:00.001Z'));
    expect((await window.hit('a')).allowed).toBe(true);
    expect((await window.hit('a')).allowed).toBe(false);
  });
});

describe('slidingWindow store selection', () => {
  const previousHost = process.env.REDIS_HOST;
  afterEach(() => {
    if (previousHost === undefined) delete process.env.REDIS_HOST;
    else process.env.REDIS_HOST = previousHost;
  });

  it('stays in memory when Redis is not configured', async () => {
    delete process.env.REDIS_HOST;
    const connect = vi.fn();
    const window = slidingWindow({ name: 'test', windowMs: 60_000, max: 1 }, connect);
    expect((await window.hit('a')).allowed).toBe(true);
    expect((await window.hit('a')).allowed).toBe(false);
    expect(connect).not.toHaveBeenCalled();
  });

  it('keeps enforcing per process while Redis is unreachable', async () => {
    process.env.REDIS_HOST = 'dragonfly';
    const connect = vi.fn().mockRejectedValue(new Error('connection refused'));
    const window = slidingWindow({ name: 'test', windowMs: 60_000, max: 1 }, connect);
    expect((await window.hit('a')).allowed).toBe(true);
    expect((await window.hit('a')).allowed).toBe(false);
    expect(connect).toHaveBeenCalledTimes(2);
  });
});

const redisUrl = process.env.REDIS_INTEGRATION_URL;

describe.skipIf(!redisUrl)('Redis sliding window', () => {
  const client = redisUrl ? new Redis(redisUrl, { protocol: 2 }) : null;
  const connect = async () => client as Redis;
  let name = '';

  beforeEach(() => {
    name = `test-${crypto.randomUUID()}`;
  });
  afterAll(() => client?.disconnect());

  it('admits exactly max of many concurrent hits across callers', async () => {
    const a = redisWindow({ name, windowMs: 60_000, max: 5 }, connect);
    const b = redisWindow({ name, windowMs: 60_000, max: 5 }, connect);
    const hits = await Promise.all(Array.from({ length: 40 }, (_, index) => (index % 2 ? a : b).hit('client')));
    expect(hits.filter((hit) => hit.allowed)).toHaveLength(5);
    for (const hit of hits.filter((entry) => !entry.allowed)) {
      expect(hit.retryAfterMs).toBeGreaterThan(0);
      expect(hit.retryAfterMs).toBeLessThanOrEqual(60_000);
    }
  });

  it('reopens once the window has passed and expires its key', async () => {
    const window = redisWindow({ name, windowMs: 300, max: 1 }, connect);
    expect((await window.hit('client')).allowed).toBe(true);
    expect((await window.hit('client')).allowed).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect((await window.hit('client')).allowed).toBe(true);
    const keys = await client?.keys(`nibleaf:rate-limit:${name}:*`);
    expect(keys).toHaveLength(1);
    expect(await client?.pttl(keys?.[0] ?? '')).toBeLessThanOrEqual(300);
  });
});
