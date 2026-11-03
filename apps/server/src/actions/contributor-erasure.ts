import { prisma } from '@nibleaf/database';
import { INTERFACE_LOCALES } from '@nibleaf/i18n/locales';
import { changerequest_defaulttitle, changerequest_unknownauthor } from '@nibleaf/i18n/messages';
import { OPEN_CHANGE_REQUEST_STATUSES } from '@/lib/change-request-status';
import { cleanupContributorAssets } from './assets';

/**
 * Account deletion step: archives the user's open change requests, replaces
 * their name in default change request titles, then deletes their contributor
 * uploads in every wiki they uploaded to or had an open change request in.
 * Database errors propagate; upload cleanup is best-effort. Safe to re-run.
 */
export const eraseUserContributions = async (user: { id: string; name: string }): Promise<void> => {
  const open = { authorId: user.id, status: { in: [...OPEN_CHANGE_REQUEST_STATUSES] } };
  const [changeRequests, assets] = await Promise.all([
    prisma.changeRequest.findMany({ where: open, select: { projectId: true }, distinct: ['projectId'] }),
    prisma.asset.findMany({ where: { createdById: user.id }, select: { projectId: true }, distinct: ['projectId'] }),
  ]);
  await prisma.$transaction([
    prisma.changeRequest.updateMany({ where: open, data: { status: 'ARCHIVED' } }),
    ...INTERFACE_LOCALES.map(({ code: locale }) =>
      prisma.changeRequest.updateMany({
        where: { authorId: user.id, title: changerequest_defaulttitle({ name: user.name }, { locale }) },
        data: { title: changerequest_defaulttitle({ name: changerequest_unknownauthor(undefined, { locale }) }, { locale }) },
      }),
    ),
  ]);
  for (const projectId of new Set([...changeRequests, ...assets].map((row) => row.projectId))) {
    await cleanupContributorAssets(projectId, user.id);
  }
};
