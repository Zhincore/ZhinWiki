import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  metadata: null as string | null,
  suspended: new Set<string>(),
  createMany: vi.fn(async (_args: unknown) => ({ count: 1 })),
  createJob: vi.fn(async () => undefined),
}));

vi.mock('@nibleaf/database', () => ({
  prisma: {
    project: { findUnique: vi.fn(async () => ({ name: 'Docs', organization: { metadata: mocks.metadata } })) },
    notification: { createMany: mocks.createMany },
    user: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] }; suspendedAt: null } }) =>
        where.id.in.filter((id) => where.suspendedAt !== null || !mocks.suspended.has(id)).map((id) => ({ id, email: `${id}@example.com` })),
      ),
    },
  },
}));
vi.mock('@nibleaf/bullmq', () => ({ createJob: mocks.createJob, QueueNames: { EMAIL: 'email' } }));

import { notifyChangeRequest } from './change-request-notifications';

const input = {
  projectId: 'project',
  changeRequest: { number: 3, title: 'Fix typos' },
  event: 'approved' as const,
  actor: { id: 'reviewer', name: 'Rita', email: 'rita@example.com' },
  locale: 'en',
};

describe('notifyChangeRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.metadata = null;
    mocks.suspended = new Set();
  });

  it('notifies in-app and by email, linking the change request', async () => {
    await notifyChangeRequest({ ...input, recipients: ['author'] });
    expect(mocks.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ userId: 'author', type: 'change_request_approved', href: '/app/projects/project/changes/3' })],
    });
    expect(mocks.createJob).toHaveBeenCalledWith('email', expect.objectContaining({ data: expect.objectContaining({ to: 'author@example.com' }) }));
  });

  it('skips the actor and missing recipients', async () => {
    await notifyChangeRequest({ ...input, recipients: ['reviewer', null] });
    expect(mocks.createMany).not.toHaveBeenCalled();
    expect(mocks.createJob).not.toHaveBeenCalled();
  });

  it('skips suspended recipients', async () => {
    mocks.suspended = new Set(['author']);
    await notifyChangeRequest({ ...input, recipients: ['author', 'other'] });
    expect(mocks.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ userId: 'other' })] });
    expect(mocks.createJob).toHaveBeenCalledTimes(1);
    expect(mocks.createJob).toHaveBeenCalledWith('email', expect.objectContaining({ data: expect.objectContaining({ to: 'other@example.com' }) }));
  });

  it('titles the in-app notification in English whatever the actor reads', async () => {
    await notifyChangeRequest({ ...input, locale: 'de', recipients: ['author'] });
    const english = mocks.createMany.mock.calls[0]?.[0];
    vi.clearAllMocks();
    await notifyChangeRequest({ ...input, recipients: ['author'] });
    expect(mocks.createMany.mock.calls[0]?.[0]).toEqual(english);
  });

  it('names the actor by email when their name is empty', async () => {
    await notifyChangeRequest({ ...input, actor: { ...input.actor, name: '' }, recipients: ['author'] });
    expect(mocks.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ title: expect.stringMatching(/^rita@example\.com /) })] });
  });

  it('respects the wiki turning the event off', async () => {
    mocks.metadata = JSON.stringify({ notifications: { change_request_reviewed: false } });
    await notifyChangeRequest({ ...input, recipients: ['author'] });
    expect(mocks.createMany).not.toHaveBeenCalled();
    expect(mocks.createJob).not.toHaveBeenCalled();
  });
});
