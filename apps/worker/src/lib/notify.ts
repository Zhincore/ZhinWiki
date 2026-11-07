import { createHash } from 'node:crypto';
import { createJob, QueueNames } from '@nibleaf/bullmq';
import { prisma } from '@nibleaf/database';
import { renderDeploymentEmail, resolveEmailLanguage } from '@nibleaf/email';
import { notificationEnabled } from '@nibleaf/shared/notifications';

function deploymentNotificationId(opts: { deploymentId: string; projectId: string; outcome: 'ready' | 'failed' }, recipient: string): string {
  return `deployment-${createHash('sha256')
    .update(JSON.stringify([opts.projectId, opts.deploymentId, opts.outcome, recipient]))
    .digest('hex')}`;
}

/** Fan a deployment outcome out as one in-app notification (the dashboard bell)
 *  per org member. Mirrors createNotificationsForOrgMembers in apps/server —
 *  the worker can't import server actions, and the insert is a single createMany. */
async function createDeploymentNotifications(
  organizationId: string,
  opts: { deploymentId: string; projectId: string; projectName: string; version: number; outcome: 'ready' | 'failed'; error?: string },
): Promise<void> {
  const members = await prisma.member.findMany({ where: { organizationId }, select: { userId: true } });
  if (members.length === 0) {
    return;
  }
  const payload =
    opts.outcome === 'ready'
      ? {
          type: 'deploy_ready',
          title: `${opts.projectName} published`,
          body: `Version v${opts.version} is live.`,
        }
      : {
          type: 'deploy_failed',
          title: `${opts.projectName} publish failed`,
          body: `Version v${opts.version} did not publish.${opts.error ? ` ${opts.error.slice(0, 300)}` : ''}`,
        };
  await prisma.notification.createMany({
    data: members.map((member) => ({
      id: deploymentNotificationId(opts, member.userId),
      userId: member.userId,
      projectId: opts.projectId,
      ...payload,
      href: `/app/projects/${opts.projectId}`,
    })),
    skipDuplicates: true,
  });
}

/** Whether the outcome is emailed: the workspace toggle must allow it, and a
 *  publish on merge sends no success email since the merge already notified
 *  its people. */
async function deploymentEmailEnabled(organizationId: string, opts: { outcome: 'ready' | 'failed'; source?: 'merge' }): Promise<boolean> {
  if (opts.outcome === 'ready' && opts.source === 'merge') {
    return false;
  }
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { metadata: true } });
  return notificationEnabled(org?.metadata, opts.outcome === 'ready' ? 'project_deploy' : 'project_deploy_failed');
}

/** Drop an in-app notification (the dashboard bell) for every org member about a
 *  deployment outcome, and email the org admins/owners when the relevant
 *  notification toggle is enabled. Attempt both channels, then throw on partial
 *  failure so a READY retry repairs missing deliveries without revoking READY.
 *  Email deduplication lasts only while the BullMQ job is retained; it is not
 *  permanent exactly-once provider delivery. */
export async function notifyDeployment(opts: {
  deploymentId: string;
  projectId: string;
  projectName: string;
  version: number;
  siteUrl?: string;
  outcome: 'ready' | 'failed';
  error?: string;
  locale?: string;
  source?: 'merge';
}): Promise<void> {
  const project = await prisma.project.findUnique({ where: { id: opts.projectId }, select: { organizationId: true } });
  if (!project?.organizationId) {
    return;
  }
  const emailDelivery = async () => {
    const members = await prisma.member.findMany({
      where: { organizationId: project.organizationId, role: { in: ['owner', 'admin'] } },
      select: { user: { select: { email: true } } },
    });
    const recipients = [...new Set(members.map((m) => m.user.email).filter(Boolean))];
    if (recipients.length === 0) {
      return;
    }
    const email = await renderDeploymentEmail({
      error: opts.error,
      outcome: opts.outcome,
      projectName: opts.projectName,
      siteUrl: opts.siteUrl,
      version: opts.version,
      language: resolveEmailLanguage(opts.locale),
    });
    const queued = await Promise.allSettled(
      recipients.map((to) =>
        createJob(
          QueueNames.EMAIL,
          { name: 'send-email', data: { to, subject: email.subject, html: email.html, text: email.text } },
          { jobId: deploymentNotificationId(opts, to) },
        ),
      ),
    );
    if (queued.some((result) => result.status === 'rejected')) throw new Error('Deployment email enqueue incomplete');
  };
  const emailEnabled = await deploymentEmailEnabled(project.organizationId, opts);
  const deliveries: Promise<unknown>[] = [createDeploymentNotifications(project.organizationId, opts)];
  if (emailEnabled) {
    deliveries.push(emailDelivery());
  }
  const results = await Promise.allSettled(deliveries);
  if (results.some((result) => result.status === 'rejected')) throw new Error('Deployment notification delivery incomplete');
}
