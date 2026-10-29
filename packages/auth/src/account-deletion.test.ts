import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  memberFindMany: vi.fn(),
  platformEventDeleteMany: vi.fn(),
  notificationDeleteMany: vi.fn(),
  transaction: vi.fn(),
  eraseProjectOrganization: vi.fn(),
  PendingError: class TenantUsageDeletionPendingError extends Error {},
}));

vi.mock('@nibleaf/database', () => ({
  prisma: {
    member: { findMany: mocks.memberFindMany },
    platformEvent: { deleteMany: mocks.platformEventDeleteMany },
    notification: { deleteMany: mocks.notificationDeleteMany },
    $transaction: mocks.transaction,
  },
}));
vi.mock('./tenant-erasure', () => ({
  eraseProjectOrganization: mocks.eraseProjectOrganization,
  TenantUsageDeletionPendingError: mocks.PendingError,
}));

import { prepareAccountDeletion } from './account-deletion';
import { ACCOUNT_DELETION_ERROR } from './account-deletion-errors';

const membership = (id: string, role: string, members: number, project: { id: string; name: string } | null = null) => ({
  role,
  organization: { id, name: `${id} workspace`, projects: project ? [project] : [], _count: { members } },
});

describe('Better Auth account deletion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.eraseProjectOrganization.mockResolvedValue(undefined);
    mocks.platformEventDeleteMany.mockReturnValue('delete-events');
    mocks.notificationDeleteMany.mockReturnValue('delete-notifications');
    mocks.transaction.mockResolvedValue([]);
  });

  it('erases sole-member workspaces and removes the user product events and notifications', async () => {
    mocks.memberFindMany.mockResolvedValue([membership('org-a', 'owner', 1), membership('org-b', 'editor', 3)]);

    await prepareAccountDeletion('user-a', 'independent');

    expect(mocks.eraseProjectOrganization).toHaveBeenCalledTimes(1);
    expect(mocks.eraseProjectOrganization).toHaveBeenCalledWith('org-a');
    expect(mocks.platformEventDeleteMany).toHaveBeenCalledWith({ where: { userId: 'user-a' } });
    expect(mocks.notificationDeleteMany).toHaveBeenCalledWith({ where: { userId: 'user-a' } });
    expect(mocks.transaction).toHaveBeenCalledWith(['delete-events', 'delete-notifications']);
  });

  it('refuses deletion while the user owns a workspace with other members, before erasing anything', async () => {
    mocks.memberFindMany.mockResolvedValue([
      membership('org-solo', 'owner', 1),
      membership('org-shared', 'owner', 2, { id: 'project-shared', name: 'Shared docs' }),
    ]);

    const error = await prepareAccountDeletion('user-a', 'independent').catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      statusCode: 409,
      body: {
        code: ACCOUNT_DELETION_ERROR.OWNS_SHARED_WORKSPACES,
        workspaces: [{ organizationId: 'org-shared', projectId: 'project-shared', name: 'Shared docs' }],
      },
    });
    expect(mocks.eraseProjectOrganization).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('reports pending usage erasure as a retryable conflict', async () => {
    mocks.memberFindMany.mockResolvedValue([membership('org-a', 'owner', 1)]);
    mocks.eraseProjectOrganization.mockRejectedValue(new mocks.PendingError('pending'));

    await expect(prepareAccountDeletion('user-a', 'independent')).rejects.toMatchObject({
      statusCode: 409,
      body: { code: ACCOUNT_DELETION_ERROR.ERASURE_PENDING },
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('fails account deletion closed when retained-store erasure cannot complete', async () => {
    mocks.memberFindMany.mockResolvedValue([membership('org-a', 'owner', 1)]);
    mocks.eraseProjectOrganization.mockRejectedValue(new Error('clickhouse unavailable'));

    await expect(prepareAccountDeletion('user-a', 'independent')).rejects.toThrow('clickhouse unavailable');
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('refuses deletion in shared tenancy while the user is the only member of a wiki, before erasing anything', async () => {
    mocks.memberFindMany.mockResolvedValue([
      membership('org-solo', 'owner', 1, { id: 'project-solo', name: 'Solo wiki' }),
      membership('org-team', 'editor', 3),
    ]);

    const error = await prepareAccountDeletion('user-a', 'shared').catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      statusCode: 409,
      body: {
        code: ACCOUNT_DELETION_ERROR.SOLE_WIKI_OWNER,
        workspaces: [{ organizationId: 'org-solo', projectId: 'project-solo', name: 'Solo wiki' }],
      },
    });
    expect(mocks.eraseProjectOrganization).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('deletes a shared-tenancy account whose wikis all have other members without erasing them', async () => {
    mocks.memberFindMany.mockResolvedValue([membership('org-team', 'editor', 3)]);

    await prepareAccountDeletion('user-a', 'shared');

    expect(mocks.eraseProjectOrganization).not.toHaveBeenCalled();
    expect(mocks.transaction).toHaveBeenCalledWith(['delete-events', 'delete-notifications']);
  });
});
