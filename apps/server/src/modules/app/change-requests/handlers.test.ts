import { Hono } from 'hono';
import { contextStorage } from 'hono/context-storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/errors';
import type { HonoEnv } from '@/lib/hono/context';

const state = vi.hoisted(() => ({
  tenancy: 'shared' as 'shared' | 'independent',
  platformRole: 'user',
  membership: null as string | null,
  accessMode: 'PUBLIC',
  config: null as unknown,
  deployments: 1,
}));

const mocks = vi.hoisted(() => ({
  createChangeRequest: vi.fn(async () => ({ id: 'cr' })),
  updateChangeRequest: vi.fn(async () => ({ id: 'cr' })),
  mergeChangeRequest: vi.fn(async () => ({ number: 1, title: 'Fix', authorId: 'author' })),
  listChangeRequests: vi.fn(async () => []),
  submitReview: vi.fn(
    async (): Promise<{ changeRequest: { number: number; title: string; authorId: string }; previous: string | null }> => ({
      changeRequest: { number: 1, title: 'Fix', authorId: 'author' },
      previous: null,
    }),
  ),
  requestReview: vi.fn(async () => ({ number: 1, title: 'Fix', authorId: 'author' })),
  notifyChangeRequest: vi.fn(async () => undefined),
  listMergedChangeRequests: vi.fn(async () => ({ items: [], nextCursor: null })),
  revertChangeRequest: vi.fn(async () => ({ changeRequest: { number: 2 }, warnings: [] })),
  createDeployment: vi.fn(async () => ({ id: 'deployment' })),
  recordRefusedDeployment: vi.fn(async () => ({ id: 'failed' })),
}));

vi.mock('@/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/env')>();
  return {
    env: new Proxy(actual.env, { get: (target, key) => (key === 'TENANCY' ? state.tenancy : target[key as keyof typeof target]) }),
  };
});

vi.mock('@nibleaf/database', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async () => ({
        suspendedAt: null,
        role: state.platformRole,
        members: state.membership ? [{ role: state.membership }] : [],
      })),
    },
    project: {
      findUnique: vi.fn(async () => ({ id: 'project', organizationId: 'org', config: state.config, accessMode: state.accessMode, takedownAt: null })),
    },
    deployment: { count: vi.fn(async () => state.deployments) },
  },
}));

vi.mock('@/actions/projects', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/actions/projects')>()),
  assertProjectInOrg: vi.fn(async () => ({ id: 'project', organizationId: 'org', config: state.config })),
}));

vi.mock('@/actions/deployments', () => ({ createDeployment: mocks.createDeployment, recordRefusedDeployment: mocks.recordRefusedDeployment }));

vi.mock('@/actions/change-requests', () => ({
  createChangeRequest: mocks.createChangeRequest,
  getChangeRequest: vi.fn(async () => ({ id: 'cr' })),
  getChangeRequestPageDiff: vi.fn(),
  listChangeRequests: mocks.listChangeRequests,
  listMergedChangeRequests: mocks.listMergedChangeRequests,
  mergeChangeRequest: mocks.mergeChangeRequest,
  revertChangeRequest: mocks.revertChangeRequest,
  updateChangeRequest: mocks.updateChangeRequest,
}));

vi.mock('@/actions/change-request-reviews', () => ({
  listReviewerCandidates: vi.fn(async () => []),
  removeReviewer: vi.fn(async () => undefined),
  requestReview: mocks.requestReview,
  submitReview: mocks.submitReview,
}));

vi.mock('@/actions/change-request-notifications', () => ({ notifyChangeRequest: mocks.notifyChangeRequest }));

import handlers from './handlers';

const app = new Hono<HonoEnv>();
app.use('*', contextStorage());
app.use('*', async (ctx, next) => {
  ctx.set('user', { id: 'user', name: 'User', email: 'user@example.com' });
  ctx.set('organizationId', null);
  ctx.set('membership', null);
  ctx.set('contributor', false);
  ctx.set('locale', 'en');
  await next();
});
app.onError((error, ctx) =>
  error instanceof AppError ? ctx.json(error.toJSON(), error.status) : ctx.json({ error: { message: error.message } }, 500),
);
app.route('/projects/:projectId/change-requests', handlers);

const send = (method: string, path: string, body?: unknown) =>
  app.request(`/projects/project/change-requests${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const asContributor = () => Object.assign(state, { tenancy: 'shared', platformRole: 'user', membership: null });

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(state, { tenancy: 'shared', platformRole: 'user', membership: null, accessMode: 'PUBLIC', config: null, deployments: 1 });
});

describe('outside contributors (shared tenancy)', () => {
  it('list, open and update change requests, limited to their own', async () => {
    asContributor();
    expect((await send('GET', '')).status).toBe(200);
    expect((await send('GET', '/history')).status).toBe(200);
    expect((await send('POST', '', {})).status).toBe(201);
    expect((await send('PATCH', '/1', { status: 'IN_REVIEW' })).status).toBe(200);
    expect(mocks.updateChangeRequest).toHaveBeenCalledWith('project', 1, { status: 'IN_REVIEW' }, 'user');
    expect(mocks.createChangeRequest).toHaveBeenCalledWith('project', {}, expect.objectContaining({ id: 'user' }), {
      locale: 'en',
      contributor: true,
    });
  });

  it('cannot merge, review or manage reviewers', async () => {
    asContributor();
    expect((await send('POST', '/1/merge', {})).status).toBe(404);
    expect((await send('POST', '/1/reviews', { state: 'APPROVED' })).status).toBe(404);
    expect((await send('POST', '/1/reviewers', { userId: 'other' })).status).toBe(404);
    expect((await send('DELETE', '/1/reviewers/other')).status).toBe(404);
    expect((await send('GET', '/reviewer-candidates')).status).toBe(404);
    expect((await send('POST', '/1/revert')).status).toBe(404);
    expect(mocks.mergeChangeRequest).not.toHaveBeenCalled();
    expect(mocks.revertChangeRequest).not.toHaveBeenCalled();
    expect(mocks.submitReview).not.toHaveBeenCalled();
  });

  it.each([
    ['independent tenancy', { tenancy: 'independent' }],
    ['a private site', { accessMode: 'WORKSPACE' }],
    ['a reader-only site', { accessMode: 'READERS' }],
    ['an unpublished wiki', { deployments: 0 }],
    ['contributions turned off', { config: { changeRequests: { outsideContributions: false } } }],
  ])('get nothing on %s', async (_label, patch) => {
    Object.assign(state, patch);
    expect((await send('GET', '')).status).toBe(404);
    expect((await send('GET', '/history')).status).toBe(404);
    expect((await send('POST', '', {})).status).toBe(404);
  });
});

describe('members and platform roles', () => {
  it.each([
    ['a member', { membership: 'member' }],
    ['a platform editor', { platformRole: 'editor' }],
    ['a platform admin', { platformRole: 'admin' }],
  ])('%s updates any change request, reviews and merges', async (_label, patch) => {
    Object.assign(state, patch);
    expect((await send('PATCH', '/1', { title: 'Renamed' })).status).toBe(200);
    expect(mocks.updateChangeRequest).toHaveBeenCalledWith('project', 1, { title: 'Renamed' }, undefined);
    expect((await send('POST', '', {})).status).toBe(201);
    expect(mocks.createChangeRequest).toHaveBeenCalledWith('project', {}, expect.objectContaining({ id: 'user' }), {
      locale: 'en',
      contributor: false,
    });
    expect((await send('POST', '/1/reviews', { state: 'APPROVED' })).status).toBe(201);
    expect((await send('POST', '/1/merge', {})).status).toBe(200);
    expect((await send('GET', '/history?cursor=abc')).status).toBe(200);
    expect(mocks.listMergedChangeRequests).toHaveBeenCalledWith('project', 'abc');
    expect((await send('POST', '/1/revert')).status).toBe(201);
    expect(mocks.revertChangeRequest).toHaveBeenCalledWith('project', 1, expect.objectContaining({ id: 'user' }), 'en');
  });

  it('sees the history of a private wiki as a member', async () => {
    Object.assign(state, { membership: 'member', accessMode: 'WORKSPACE' });
    expect((await send('GET', '/history')).status).toBe(200);
  });

  it('gives platform editors nothing in independent tenancy', async () => {
    Object.assign(state, { tenancy: 'independent', platformRole: 'editor' });
    expect((await send('GET', '')).status).toBe(404);
  });
});

describe('notifications', () => {
  beforeEach(() => Object.assign(state, { membership: 'member' }));

  it('tells the reviewer about a review request', async () => {
    await send('POST', '/1/reviewers', { userId: 'reviewer' });
    expect(mocks.notifyChangeRequest).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'reviewRequested', recipients: ['reviewer'], actor: { id: 'user', name: 'User', email: 'user@example.com' } }),
    );
  });

  it.each([
    ['APPROVED', 'approved'],
    ['CHANGES_REQUESTED', 'changesRequested'],
  ])('tells the author about a %s review', async (reviewState, event) => {
    await send('POST', '/1/reviews', { state: reviewState });
    expect(mocks.notifyChangeRequest).toHaveBeenCalledWith(expect.objectContaining({ event, recipients: ['author'] }));
  });

  it('does not notify when the verdict is unchanged', async () => {
    mocks.submitReview.mockResolvedValueOnce({ changeRequest: { number: 1, title: 'Fix', authorId: 'author' }, previous: 'APPROVED' });
    await send('POST', '/1/reviews', { state: 'APPROVED' });
    expect(mocks.notifyChangeRequest).not.toHaveBeenCalled();
  });

  it('does not notify for a comment', async () => {
    await send('POST', '/1/reviews', { state: 'COMMENTED', body: 'Looks fine' });
    expect(mocks.notifyChangeRequest).not.toHaveBeenCalled();
  });

  it('tells the author about the merge', async () => {
    await send('POST', '/1/merge', {});
    expect(mocks.notifyChangeRequest).toHaveBeenCalledWith(expect.objectContaining({ event: 'merged', recipients: ['author'] }));
  });

  it('never fails the action when delivery fails', async () => {
    mocks.notifyChangeRequest.mockRejectedValueOnce(new Error('queue down'));
    expect((await send('POST', '/1/merge', {})).status).toBe(200);
  });
});

describe('publish on merge', () => {
  beforeEach(() => Object.assign(state, { membership: 'member' }));
  const merge = async () => {
    const response = await send('POST', '/1/merge', {});
    return { status: response.status, publish: ((await response.json()) as { data: { publish: unknown } }).data.publish };
  };

  it('does not publish when the wiki turns it off', async () => {
    state.config = { changeRequests: { publishOnMerge: false } };
    expect(await merge()).toEqual({ status: 200, publish: null });
    expect(mocks.createDeployment).not.toHaveBeenCalled();
  });

  it('publishes like the Publish button by default', async () => {
    expect(await merge()).toEqual({ status: 200, publish: 'queued' });
    expect(mocks.createDeployment).toHaveBeenCalledWith('org', 'project', 'user', { message: 'Merge #1: Fix' }, 'en', true);
  });

  it('keeps the merge and reports a publish that cannot start', async () => {
    mocks.createDeployment.mockRejectedValueOnce(new AppError({ code: 'http:bad_request', message: 'redirect loop' }));
    expect(await merge()).toEqual({ status: 200, publish: 'failed' });
    expect(mocks.recordRefusedDeployment).toHaveBeenCalledWith('project', 'user', 'Merge #1: Fix', 'redirect loop');
    expect(mocks.notifyChangeRequest).toHaveBeenCalledWith(expect.objectContaining({ event: 'merged' }));
  });

  it('records no refused publish when it failed after its deployment was created', async () => {
    mocks.createDeployment.mockRejectedValueOnce(new Error('queue down'));
    expect(await merge()).toEqual({ status: 200, publish: 'failed' });
    expect(mocks.recordRefusedDeployment).not.toHaveBeenCalled();
  });

  it('keeps the merge when the refused publish cannot be recorded either', async () => {
    mocks.createDeployment.mockRejectedValueOnce(new AppError({ code: 'http:bad_request', message: 'taken down' }));
    mocks.recordRefusedDeployment.mockRejectedValueOnce(new Error('database down'));
    expect(await merge()).toEqual({ status: 200, publish: 'failed' });
  });
});
