import { Hono } from 'hono';
import { contextStorage } from 'hono/context-storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/errors';
import type { HonoEnv } from '@/lib/hono/context';

const MB = 1024 * 1024;

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
  putObject: vi.fn(),
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

const post = (path: string, body: unknown) =>
  app.request(`/projects/project/assets${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const presign = (size: number) => post('/presign', { filename: 'photo.png', contentType: 'image/png', size });
const confirm = (size: number) => post('/confirm', { key, contentType: 'image/png', size });

const expectError = async (response: Response, status: number, code: string) => {
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({ error: { code } });
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(state, { tenancy: 'shared', membership: null, accessMode: 'PUBLIC', openChangeRequests: 1, usedBytes: 0 });
  state.objects = new Map([[key, 4 * MB]]);
});

describe('contributor uploads', () => {
  it('presigns and records an image while the contributor has an open change request', async () => {
    expect((await presign(4 * MB)).status).toBe(200);
    expect((await confirm(4 * MB)).status).toBe(201);
    expect(mocks.lock).toHaveBeenCalledTimes(1);
    expect(mocks.createAsset).toHaveBeenCalledWith({ data: expect.objectContaining({ key, size: 4 * MB, createdById: 'user' }) });
  });

  it('refuses a contributor without an open change request and deletes the upload', async () => {
    state.openChangeRequests = 0;
    await expectError(await presign(MB), 403, 'auth:insufficient_role');
    await expectError(await confirm(MB), 403, 'auth:insufficient_role');
    expect(state.objects.has(key)).toBe(false);
    expect(mocks.createAsset).not.toHaveBeenCalled();
  });

  it('caps each file at 5 MB at presign and by the stored size at confirm', async () => {
    expect((await presign(5 * MB)).status).toBe(200);
    await expectError(await presign(5 * MB + 1), 413, 'assets:file_too_large');
    state.objects.set(key, 5 * MB + 1);
    await expectError(await confirm(MB), 413, 'assets:file_too_large');
    expect(state.objects.has(key)).toBe(false);
    expect(mocks.createAsset).not.toHaveBeenCalled();
  });

  it('refuses uploads past the 50 MB quota per wiki', async () => {
    state.usedBytes = 47 * MB;
    expect((await presign(3 * MB)).status).toBe(200);
    await expectError(await presign(3 * MB + 1), 422, 'assets:quota_exceeded');
    await expectError(await confirm(MB), 422, 'assets:quota_exceeded');
    expect(mocks.lock).toHaveBeenCalledTimes(1);
    expect(state.objects.has(key)).toBe(false);
    expect(mocks.createAsset).not.toHaveBeenCalled();
  });

  it('leaves an already recorded asset untouched', async () => {
    const { prisma } = await import('@nibleaf/database');
    vi.mocked(prisma.asset.findUnique).mockResolvedValueOnce({ id: 'existing' } as never);
    await expectError(await confirm(MB), 409, 'database:conflict');
    expect(state.objects.has(key)).toBe(true);
    expect(mocks.deleteObject).not.toHaveBeenCalled();
  });

  it('refuses non-contributors on wikis that do not accept outside contributions', async () => {
    state.accessMode = 'PRIVATE';
    await expectError(await presign(MB), 404, 'database:not_found');
    await expectError(await confirm(MB), 404, 'database:not_found');
    expect(mocks.createAsset).not.toHaveBeenCalled();
  });

  it('refuses non-members in independent tenancy', async () => {
    state.tenancy = 'independent';
    await expectError(await presign(MB), 404, 'database:not_found');
    expect(mocks.createAsset).not.toHaveBeenCalled();
  });
});

describe('member uploads', () => {
  it('keep the 50 MB limit with no change request or quota', async () => {
    state.membership = 'member';
    state.openChangeRequests = 0;
    state.usedBytes = 500 * MB;
    expect((await presign(50 * MB)).status).toBe(200);
    expect((await confirm(20 * MB)).status).toBe(201);
    expect(mocks.lock).not.toHaveBeenCalled();
    expect(mocks.createAsset).toHaveBeenCalledWith({ data: expect.objectContaining({ key, size: 20 * MB, createdById: 'user' }) });
  });

  it('work in independent tenancy', async () => {
    state.tenancy = 'independent';
    state.membership = 'member';
    expect((await presign(50 * MB)).status).toBe(200);
  });
});
