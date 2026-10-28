import { prisma } from '@nibleaf/database';
import { APIError } from 'better-auth/api';
import { ACCOUNT_DELETION_ERROR, type BlockingWorkspace } from './account-deletion-errors';
import { eraseProjectOrganization, TenantUsageDeletionPendingError } from './tenant-erasure';

/**
 * Better Auth `beforeDelete` hook. Refuses deletion while the user owns a
 * workspace with other members, erases sole-member workspaces through the
 * shared tenant erasure workflow, then removes the user's product events and
 * notifications. Memberships, sessions, and accounts cascade with the user row.
 */
export const prepareAccountDeletion = async (userId: string): Promise<void> => {
  const memberships = await prisma.member.findMany({
    where: { userId },
    select: {
      role: true,
      organization: {
        select: {
          id: true,
          name: true,
          projects: { select: { id: true, name: true }, take: 1 },
          _count: { select: { members: true } },
        },
      },
    },
  });

  const blocking: BlockingWorkspace[] = memberships
    .filter(({ role, organization }) => role === 'owner' && organization._count.members > 1)
    .map(({ organization }) => {
      const [project] = organization.projects;
      return { organizationId: organization.id, projectId: project?.id ?? null, name: project?.name ?? organization.name };
    });
  if (blocking.length > 0) {
    throw new APIError('CONFLICT', {
      code: ACCOUNT_DELETION_ERROR.OWNS_SHARED_WORKSPACES,
      message: 'Transfer ownership or remove the other members of your workspaces before deleting your account.',
      workspaces: blocking,
    });
  }

  for (const { organization } of memberships) {
    if (organization._count.members > 1) continue;
    try {
      await eraseProjectOrganization(organization.id);
    } catch (error) {
      if (error instanceof TenantUsageDeletionPendingError) {
        throw new APIError('CONFLICT', {
          code: ACCOUNT_DELETION_ERROR.ERASURE_PENDING,
          message: 'Workspace usage is still being processed. Try again in a few minutes.',
        });
      }
      throw error;
    }
  }

  await prisma.$transaction([prisma.platformEvent.deleteMany({ where: { userId } }), prisma.notification.deleteMany({ where: { userId } })]);
};
