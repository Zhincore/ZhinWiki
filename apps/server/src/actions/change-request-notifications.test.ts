import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  metadata: null as string | null,
  createMany: vi.fn(async () => ({ count: 1 })),
  createJob: vi.fn(async () => undefined),
}));

vi.mock('@nibleaf/database', () => ({
  prisma: {
    project: { findUnique: vi.fn(async () => ({ name: 'Docs', organization: { metadata: mocks.metadata } })) },
    notification: { createMany: mocks.createMany },
    user: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map((id) => ({ email: `${id}@example.com` }))),
    },
  },
}));
vi.mock('@nibleaf/bullmq', () => ({ createJob: mocks.createJob, QueueNames: { EMAIL: 'email' } }));

import { notifyChangeRequest } from './change-request-notifications';

const input = {
  projectId: 'project',
  changeRequest: { number: 3, title: 'Fix typos' },
  event: 'approved' as const,
  actor: { id: 'reviewer', name: 'Rita' },
  locale: 'en',
};

describe('notifyChangeRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.metadata = null;
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

  it('respects the wiki turning the event off', async () => {
    mocks.metadata = JSON.stringify({ notifications: { change_request_reviewed: false } });
    await notifyChangeRequest({ ...input, recipients: ['author'] });
    expect(mocks.createMany).not.toHaveBeenCalled();
    expect(mocks.createJob).not.toHaveBeenCalled();
  });
});
