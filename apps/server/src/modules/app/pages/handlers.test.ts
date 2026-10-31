import { Hono } from 'hono';
import { contextStorage } from 'hono/context-storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/errors';
import type { HonoEnv } from '@/lib/hono/context';

const mocks = vi.hoisted(() => ({
  /** Branch of each page; `cr` (by `user`) and `other-cr` are open, `archived` and `import` are not. */
  pageBranches: new Map<string, string>(),
  /** Platform role and membership of the caller. */
  caller: { role: 'user', members: [{ role: 'member' }] as { role: string }[] },
  createPage: vi.fn(async () => ({ id: 'new' })),
  updatePage: vi.fn(async () => ({ id: 'page' })),
  deletePage: vi.fn(async () => ({ id: 'page' })),
  reorderPages: vi.fn(async () => []),
}));

vi.mock('@nibleaf/database', () => ({
  prisma: {
    user: { findUnique: vi.fn(async () => ({ suspendedAt: null, ...mocks.caller })) },
    project: {
      findUnique: vi.fn(async () => ({ id: 'project', organizationId: 'org', config: null, accessMode: 'PUBLIC', takedownAt: null })),
    },
    deployment: { count: vi.fn(async () => 1) },
    branch: {
      findMany: vi.fn(async () => [{ id: 'main', isDefault: true }]),
      count: vi.fn(async ({ where }: { where: { id: string } }) => (['main', 'cr', 'other-cr'].includes(where.id) ? 1 : 0)),
    },
    page: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        [...new Set(where.id.in.flatMap((id) => mocks.pageBranches.get(id) ?? []))].map((branchId) => ({ branchId })),
      ),
    },
    changeRequest: {
      findMany: vi.fn(async ({ where }: { where: { branchId: { in: string[] } } }) =>
        where.branchId.in.flatMap((id) => (id === 'cr' ? [{ authorId: 'user' }] : id === 'other-cr' ? [{ authorId: 'other' }] : [])),
      ),
    },
  },
}));

vi.mock('@/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/env')>();
  return { env: new Proxy(actual.env, { get: (target, key) => (key === 'TENANCY' ? 'shared' : target[key as keyof typeof target]) }) };
});

vi.mock('@/actions/projects', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/actions/projects')>()),
  assertProjectInOrg: vi.fn(async () => undefined),
}));

vi.mock('@/actions/pages', () => ({
  createPage: mocks.createPage,
  updatePage: mocks.updatePage,
  deletePage: mocks.deletePage,
  reorderPages: mocks.reorderPages,
  getPage: vi.fn(async (_projectId: string, id: string) => ({ id, branchId: mocks.pageBranches.get(id) })),
  listPages: vi.fn(async () => []),
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
app.route('/projects/:projectId/pages', handlers);

const send = (method: string, path: string, body?: unknown) =>
  app.request(`/projects/project/pages${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const expectLocked = async (response: Response, code = 'pages:main_read_only') => {
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ error: { code } });
};

describe('page writes on the default branch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.caller = { role: 'user', members: [{ role: 'member' }] };
    mocks.pageBranches = new Map([
      ['main-page', 'main'],
      ['main-parent', 'main'],
      ['cr-page', 'cr'],
      ['cr-parent', 'cr'],
      ['archived-page', 'archived'],
      ['import-page', 'import'],
    ]);
  });

  it('refuses creating a page on main, directly or under a main parent', async () => {
    await expectLocked(await send('POST', '', { title: 'New', languageId: 'en' }));
    await expectLocked(await send('POST', '', { title: 'New', languageId: 'en', branchId: 'main' }));
    await expectLocked(await send('POST', '', { title: 'New', languageId: 'en', parentId: 'main-parent', branchId: 'cr' }));
    expect(mocks.createPage).not.toHaveBeenCalled();
  });

  it('creates pages in a change request', async () => {
    expect((await send('POST', '', { title: 'New', languageId: 'en', branchId: 'cr' })).status).toBe(201);
    expect((await send('POST', '', { title: 'New', languageId: 'en', parentId: 'cr-parent' })).status).toBe(201);
    expect(mocks.createPage).toHaveBeenCalledTimes(2);
  });

  it('refuses updating, deleting and reordering main pages', async () => {
    await expectLocked(await send('PATCH', '/main-page', { title: 'Edited' }));
    await expectLocked(await send('DELETE', '/main-page'));
    await expectLocked(
      await send('POST', '/reorder', {
        items: [
          { id: 'cr-page', parentId: null, position: 0 },
          { id: 'main-page', parentId: null, position: 1 },
        ],
      }),
    );
    expect(mocks.updatePage).not.toHaveBeenCalled();
    expect(mocks.deletePage).not.toHaveBeenCalled();
    expect(mocks.reorderPages).not.toHaveBeenCalled();
  });

  it('updates, deletes and reorders change-request pages', async () => {
    expect((await send('PATCH', '/cr-page', { title: 'Edited' })).status).toBe(200);
    expect((await send('DELETE', '/cr-page')).status).toBe(200);
    expect((await send('POST', '/reorder', { items: [{ id: 'cr-page', parentId: null, position: 0 }] })).status).toBe(200);
    expect(mocks.updatePage).toHaveBeenCalledOnce();
    expect(mocks.deletePage).toHaveBeenCalledOnce();
    expect(mocks.reorderPages).toHaveBeenCalledOnce();
  });

  it('refuses writes to pages of closed change requests and branches without one', async () => {
    await expectLocked(await send('PATCH', '/archived-page', { title: 'Edited' }), 'pages:branch_read_only');
    await expectLocked(await send('DELETE', '/import-page'), 'pages:branch_read_only');
    await expectLocked(await send('POST', '', { title: 'New', languageId: 'en', branchId: 'archived' }), 'pages:branch_read_only');
    await expectLocked(
      await send('POST', '/reorder', {
        items: [
          { id: 'cr-page', parentId: null, position: 0 },
          { id: 'archived-page', parentId: null, position: 1 },
        ],
      }),
      'pages:branch_read_only',
    );
    expect(mocks.createPage).not.toHaveBeenCalled();
    expect(mocks.updatePage).not.toHaveBeenCalled();
    expect(mocks.deletePage).not.toHaveBeenCalled();
    expect(mocks.reorderPages).not.toHaveBeenCalled();
  });
});

describe('outside contributors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.caller = { role: 'user', members: [] };
    mocks.pageBranches = new Map([
      ['main-page', 'main'],
      ['cr-page', 'cr'],
      ['other-page', 'other-cr'],
      ['import-page', 'import'],
    ]);
  });

  it('edit pages of their own change request', async () => {
    expect((await send('PATCH', '/cr-page', { title: 'Edited' })).status).toBe(200);
    expect((await send('POST', '', { title: 'New', languageId: 'en', branchId: 'cr' })).status).toBe(201);
    expect((await send('DELETE', '/cr-page')).status).toBe(200);
  });

  it("cannot write to someone else's change request", async () => {
    expect((await send('PATCH', '/other-page', { title: 'Edited' })).status).toBe(403);
    expect((await send('POST', '', { title: 'New', languageId: 'en', branchId: 'other-cr' })).status).toBe(403);
    expect((await send('DELETE', '/other-page')).status).toBe(403);
    expect(
      (
        await send('POST', '/reorder', {
          items: [
            { id: 'cr-page', parentId: null, position: 0 },
            { id: 'other-page', parentId: null, position: 1 },
          ],
        })
      ).status,
    ).toBe(403);
    expect(mocks.updatePage).not.toHaveBeenCalled();
    expect(mocks.createPage).not.toHaveBeenCalled();
  });

  it('read main and change requests but not internal branches', async () => {
    expect((await send('GET', '/main-page')).status).toBe(200);
    expect((await send('GET', '/other-page')).status).toBe(200);
    expect((await send('GET', '?branchId=other-cr')).status).toBe(200);
    expect((await send('GET', '/import-page')).status).toBe(404);
    expect((await send('GET', '?branchId=import')).status).toBe(404);
  });
});
