import { Hono } from 'hono';
import { contextStorage } from 'hono/context-storage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/errors';
import type { HonoEnv } from '@/lib/hono/context';

const MB = 1024 * 1024;
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

const state = vi.hoisted(() => ({
  tenancy: 'shared' as 'shared' | 'independent',
  membership: null as string | null,
  accessMode: 'PUBLIC',
  /** Open change requests of the caller. */
  openChangeRequests: 1,
  /** Bytes the caller has already uploaded to the wiki. */
  usedBytes: 0,
  /** Stored object sizes by key. */
  objects: new Map<string, number>(),
}));

const mocks = vi.hoisted(() => ({
  createAsset: vi.fn(async ({ data }: { data: unknown }) => data),
  lock: vi.fn(async () => 1),
  putObject: vi.fn(async (key: string, bytes: Uint8Array, _contentType: string) => {
    state.objects.set(key, bytes.byteLength);
  }),
  deleteObject: vi.fn(async (key: string) => {
    state.objects.delete(key);
  }),
}));

vi.mock('@/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/env')>();
  return {
    env: new Proxy(actual.env, { get: (target, key) => (key === 'TENANCY' ? state.tenancy : target[key as keyof typeof target]) }),
  };
});

vi.mock('@nibleaf/storage', () => ({
  presignPutUrl: vi.fn(async () => 'https://storage.example/upload'),
  putObject: mocks.putObject,
  deleteObject: mocks.deleteObject,
  headObject: vi.fn(async (key: string) => {
    const size = state.objects.get(key);
    if (size === undefined) throw new Error('NotFound');
    return { ContentLength: size };
  }),
  getObjectStream: vi.fn(),
}));

vi.mock('@nibleaf/database', () => {
  const asset = {
    aggregate: vi.fn(async () => ({ _sum: { size: state.usedBytes } })),
    findUnique: vi.fn(async () => null),
    create: mocks.createAsset,
  };
  return {
    prisma: {
      user: {
        findUnique: vi.fn(async () => ({ suspendedAt: null, role: 'user', members: state.membership ? [{ role: state.membership }] : [] })),
      },
      project: {
        findUnique: vi.fn(async () => ({ id: 'project', organizationId: 'org', config: null, accessMode: state.accessMode, takedownAt: null })),
      },
      deployment: { count: vi.fn(async () => 1) },
      changeRequest: { count: vi.fn(async () => state.openChangeRequests) },
      asset,
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({ asset, $executeRaw: mocks.lock })),
    },
  };
});

vi.mock('@/actions/projects', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/actions/projects')>()),
  assertProjectInOrg: vi.fn(async () => undefined),
}));

import handlers from './handlers';

const app = new Hono<HonoEnv>();
app.use('*', contextStorage());
app.use('*', async (ctx, next) => {
  ctx.set('user', { id: 'user', name: 'User', email: 'user@example.com' } as HonoEnv['Variables']['user']);
  ctx.set('organizationId', 'org');
  ctx.set('membership', null);
  await next();
});
app.onError((error, ctx) =>
  error instanceof AppError ? ctx.json(error.toJSON(), error.status) : ctx.json({ error: { message: error.message } }, 500),
);
app.route('/projects/:projectId/assets', handlers);

const key = 'projects/project/assets/abc-photo.png';
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const post = (path: string, body: unknown) =>
  app.request(`/projects/project/assets${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const presign = (size: number) => post('/presign', { filename: 'photo.png', contentType: 'image/png', size });
const confirm = (size: number) => post('/confirm', { key, contentType: 'image/png', size });

/** A PNG of `size` bytes. */
const png = (size: number) => {
  const bytes = new Uint8Array(size);
  bytes.set(PNG);
  return bytes;
};
const upload = (body: RequestInit['body'], headers: Record<string, string> = {}) =>
  app.request('/projects/project/assets/upload?filename=photo.png', {
    method: 'POST',
    headers: { 'content-type': 'image/png', ...headers },
    body,
    duplex: 'half',
  } as RequestInit);

/** A body streamed in 1 MB chunks without a Content-Length; counts the chunks read. */
const streamed = (chunks: number) => {
  const pulled = { count: 0 };
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled.count === chunks) return controller.close();
      controller.enqueue(pulled.count === 0 ? png(MB) : new Uint8Array(MB));
      pulled.count++;
    },
  });
  return { body, pulled };
};

const expectError = async (response: Response, status: number, code: string) => {
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({ error: { code } });
};

let test = 0;

beforeEach(() => {
  // Upload limits live in module state: each test starts a day past the last one's windows.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.UTC(2026, 0, 1) + ++test * 2 * DAY);
  vi.clearAllMocks();
  Object.assign(state, { tenancy: 'shared', membership: null, accessMode: 'PUBLIC', openChangeRequests: 1, usedBytes: 0 });
  state.objects = new Map();
});

afterEach(() => vi.useRealTimers());

const uploadTimes = async (times: number, size = MB) => {
  for (let i = 0; i < times; i++) {
    expect((await upload(png(size))).status).toBe(201);
  }
};

describe('contributor uploads', () => {
  it('stores an image while the contributor has an open change request', async () => {
    const response = await upload(png(4 * MB));
    expect(response.status).toBe(201);
    expect(mocks.lock).toHaveBeenCalledTimes(1);
    expect(mocks.createAsset).toHaveBeenCalledWith({
      data: expect.objectContaining({ contentType: 'image/png', size: 4 * MB, createdById: 'user' }),
    });
    expect([...state.objects.values()]).toEqual([4 * MB]);
  });

  it('accepts exactly 5 MB', async () => {
    expect((await upload(png(5 * MB))).status).toBe(201);
  });

  it('refuses a Content-Length over 5 MB before reading the body', async () => {
    const { body, pulled } = streamed(6);
    await expectError(await upload(body, { 'content-length': String(6 * MB) }), 413, 'assets:file_too_large');
    expect(pulled.count).toBeLessThanOrEqual(1);
    expect(mocks.putObject).not.toHaveBeenCalled();
  });

  it('stops reading a body without a Content-Length once it passes 5 MB', async () => {
    const { body, pulled } = streamed(20);
    await expectError(await upload(body), 413, 'assets:file_too_large');
    expect(pulled.count).toBeLessThan(8);
    expect(mocks.putObject).not.toHaveBeenCalled();
  });

  it('counts the bytes when the Content-Length understates the body', async () => {
    await expectError(await upload(png(6 * MB), { 'content-length': '1024' }), 413, 'assets:file_too_large');
    expect(mocks.putObject).not.toHaveBeenCalled();
  });

  it('refuses bytes that are not the image type they claim to be', async () => {
    await expectError(await upload(new TextEncoder().encode('<!doctype html><script>alert(1)</script>')), 400, 'http:bad_request');
    await expectError(await upload(png(MB), { 'content-type': 'text/html' }), 422, 'validation:failed');
    expect(mocks.putObject).not.toHaveBeenCalled();
  });

  it('stores the sniffed type and sanitizes SVG', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="1" height="1"/></svg>';
    expect((await upload(new TextEncoder().encode(svg), { 'content-type': 'image/svg+xml' })).status).toBe(201);
    const stored = new TextDecoder().decode(mocks.putObject.mock.calls[0]?.[1] as Uint8Array);
    expect(stored).toContain('<rect');
    expect(stored).not.toContain('script');
    expect(mocks.putObject.mock.calls[0]?.[2]).toBe('image/svg+xml');
  });

  it('refuses a contributor without an open change request', async () => {
    state.openChangeRequests = 0;
    await expectError(await upload(png(MB)), 403, 'auth:insufficient_role');
    expect(mocks.putObject).not.toHaveBeenCalled();
  });

  it('refuses uploads past the 50 MB quota per wiki', async () => {
    state.usedBytes = 47 * MB;
    expect((await upload(png(3 * MB))).status).toBe(201);
    await expectError(await upload(png(3 * MB + 1)), 422, 'assets:quota_exceeded');
    expect(mocks.createAsset).toHaveBeenCalledTimes(1);
  });

  it('deletes the stored object when the quota is exhausted meanwhile', async () => {
    const { prisma } = await import('@nibleaf/database');
    vi.mocked(prisma.asset.aggregate)
      .mockResolvedValueOnce({ _sum: { size: 0 } } as never)
      .mockResolvedValueOnce({ _sum: { size: 50 * MB } } as never);
    await expectError(await upload(png(MB)), 422, 'assets:quota_exceeded');
    expect(mocks.putObject).toHaveBeenCalledTimes(1);
    expect(mocks.deleteObject).toHaveBeenCalledWith(mocks.putObject.mock.calls[0]?.[0]);
    expect(state.objects.size).toBe(0);
  });

  it('refuses a 31st upload within 10 minutes until the window slides', async () => {
    await uploadTimes(30);
    const refused = await upload(png(MB));
    await expectError(refused, 429, 'http:rate_limited');
    expect(Number(refused.headers.get('retry-after'))).toBe(600);
    vi.advanceTimersByTime(10 * MINUTE + 1);
    expect((await upload(png(MB))).status).toBe(201);
    expect(mocks.createAsset).toHaveBeenCalledTimes(31);
  });

  it('refuses uploads once 200 MB were stored within 24 hours', async () => {
    await uploadTimes(30, 5 * MB);
    vi.advanceTimersByTime(10 * MINUTE + 1);
    await uploadTimes(10, 5 * MB);
    const refused = await upload(png(MB));
    await expectError(refused, 429, 'http:rate_limited');
    expect(Number(refused.headers.get('retry-after'))).toBe((DAY - 10 * MINUTE) / 1000);
    expect(mocks.putObject).toHaveBeenCalledTimes(40);
    vi.advanceTimersByTime(DAY);
    expect((await upload(png(MB))).status).toBe(201);
  });

  it('may not presign or confirm, so never receives a storage URL', async () => {
    await expectError(await presign(MB), 404, 'database:not_found');
    await expectError(await confirm(MB), 404, 'database:not_found');
    expect(mocks.createAsset).not.toHaveBeenCalled();
  });

  it('refuses non-members on wikis that do not accept outside contributions', async () => {
    state.accessMode = 'PRIVATE';
    await expectError(await upload(png(MB)), 404, 'database:not_found');
    expect(mocks.putObject).not.toHaveBeenCalled();
  });

  it('refuses non-members in independent tenancy', async () => {
    state.tenancy = 'independent';
    await expectError(await upload(png(MB)), 404, 'database:not_found');
    expect(mocks.putObject).not.toHaveBeenCalled();
  });
});

describe('member uploads', () => {
  it('keep presign and confirm with no change request or quota', async () => {
    state.membership = 'member';
    state.openChangeRequests = 0;
    state.usedBytes = 500 * MB;
    expect((await presign(50 * MB)).status).toBe(200);
    expect((await confirm(20 * MB)).status).toBe(201);
    expect(mocks.lock).not.toHaveBeenCalled();
    expect(mocks.createAsset).toHaveBeenCalledWith({ data: expect.objectContaining({ key, size: 20 * MB, createdById: 'user' }) });
  });

  it('do not use the contributor upload route and are not rate limited on it', async () => {
    state.membership = 'member';
    for (let i = 0; i < 31; i++) {
      await expectError(await upload(png(MB)), 403, 'auth:insufficient_role');
    }
    expect(mocks.putObject).not.toHaveBeenCalled();
    expect((await presign(MB)).status).toBe(200);
  });

  it('work in independent tenancy', async () => {
    state.tenancy = 'independent';
    state.membership = 'member';
    expect((await presign(50 * MB)).status).toBe(200);
  });
});
