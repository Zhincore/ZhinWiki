import { Hono } from 'hono';
import { contextStorage } from 'hono/context-storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/errors';
import type { HonoEnv } from '@/lib/hono/context';

const mocks = vi.hoisted(() => ({
  /** Ids of the pages that live on the default branch. */
  mainPages: new Set<string>(),
  createPage: vi.fn(async () => ({ id: 'new' })),
  updatePage: vi.fn(async () => ({ id: 'page' })),
  deletePage: vi.fn(async () => ({ id: 'page' })),
  reorderPages: vi.fn(async () => []),
}));

vi.mock('@nibleaf/database', () => ({
  prisma: {
    user: { findUnique: vi.fn(async () => ({ suspendedAt: null, role: 'user', members: [{ role: 'member' }] })) },
    project: { findUnique: vi.fn(async () => ({ id: 'project', organizationId: 'org' })) },
    branch: { findMany: vi.fn(async () => [{ id: 'main', isDefault: true }]) },
    page: {
      count: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.filter((id) => mocks.mainPages.has(id)).length),
    },
  },
}));

vi.mock('@/actions/projects', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/actions/projects')>()),
  assertProjectInOrg: vi.fn(async () => undefined),
}));

vi.mock('@/actions/pages', () => ({
  createPage: mocks.createPage,
  updatePage: mocks.updatePage,
  deletePage: mocks.deletePage,
  reorderPages: mocks.reorderPages,
  getPage: vi.fn(),
  listPages: vi.fn(),
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

const expectLocked = async (response: Response) => {
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ error: { code: 'pages:main_read_only' } });
};

describe('page writes on the default branch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mainPages = new Set(['main-page', 'main-parent']);
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
});
