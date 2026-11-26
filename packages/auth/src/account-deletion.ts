import { prisma } from '@nibleaf/database';
import type { Tenancy } from '@nibleaf/shared/rbac';
import type { BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';
import { ACCOUNT_DELETION_ERROR, type BlockingWorkspace } from './account-deletion-errors';
import { eraseProjectOrganization, TenantUsageDeletionPendingError } from './tenant-erasure';

type Membership = {
  organization: { id: string; name: string; projects: { id: string; name: string }[] };
};

/** Closes a deleted user's open change requests and removes their contributor data. */
type ContributionErasure = (user: { id: string; name: string }) => Promise<void>;

let eraseContributions: ContributionErasure | null = null;

/** Registers the contribution erasure step; account deletion is refused until one is set. */
export const setContributionErasure = (erase: ContributionErasure): void => {
  eraseContributions = erase;
};

const toBlockingWorkspace = ({ organization }: Membership): BlockingWorkspace => {
  const [project] = organization.projects;
  return { organizationId: organization.id, projectId: project?.id ?? null, name: project?.name ?? organization.name };
};

/**
 * Better Auth `beforeDelete` hook. Refuses deletion while the user owns a
 * workspace with other members; in shared tenancy also while the user is the
 * only member of a wiki. Otherwise erases sole-member workspaces through the
 * shared tenant erasure workflow, runs the registered contribution erasure,
 * then removes the user's product events and notifications. Memberships,
 * sessions, and accounts cascade with the user row.
 */
export const prepareAccountDeletion = async (user: { id: string; name: string }, tenancy: Tenancy): Promise<void> => {
  const userId = user.id;
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

  const blocking = memberships.filter(({ role, organization }) => role === 'owner' && organization._count.members > 1).map(toBlockingWorkspace);
  if (blocking.length > 0) {
    throw new APIError('CONFLICT', {
      code: ACCOUNT_DELETION_ERROR.OWNS_SHARED_WORKSPACES,
      message: 'Transfer ownership or remove the other members of your workspaces before deleting your account.',
      workspaces: blocking,
    });
  }

  if (tenancy === 'shared') {
    const soleWikis = memberships.filter(({ organization }) => organization._count.members === 1).map(toBlockingWorkspace);
    if (soleWikis.length > 0) {
      throw new APIError('CONFLICT', {
        code: ACCOUNT_DELETION_ERROR.SOLE_WIKI_OWNER,
        message:
          'Invite another member and transfer ownership to them, or delete the sites where you are the only member, before deleting your account.',
        workspaces: soleWikis,
      });
    }
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

  if (!eraseContributions) throw new Error('Contribution erasure is not configured.');
  await eraseContributions(user);

  await prisma.$transaction([prisma.platformEvent.deleteMany({ where: { userId } }), prisma.notification.deleteMany({ where: { userId } })]);
};

const ADMIN_REMOVE_USER_PATH = '/admin/remove-user';

/**
 * Better Auth plugin: the admin plugin's remove-user endpoint deletes the row
 * directly and skips `beforeDelete`. This runs the same preparation first, only
 * for a signed-in admin removing another existing user, so any other request is
 * left to the endpoint's own authorization and validation.
 */
export const adminUserRemoval = (tenancy: Tenancy) =>
  ({
    id: 'admin-user-removal',
    hooks: {
      before: [
        {
          matcher: (context) => context.path === ADMIN_REMOVE_USER_PATH,
          handler: createAuthMiddleware(async (context) => {
            const session = await getSessionFromCtx(context);
            const targetId = (context.body as { userId?: unknown } | undefined)?.userId;
            const roles = String(session?.user.role ?? '').split(',');
            if (!session || !roles.includes('admin') || typeof targetId !== 'string' || targetId === session.user.id) return;
            const target = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true, name: true } });
            if (target) await prepareAccountDeletion(target, tenancy);
          }),
        },
      ],
    },
  }) satisfies BetterAuthPlugin;
