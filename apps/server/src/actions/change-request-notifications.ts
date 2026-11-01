import { createJob, QueueNames } from '@nibleaf/bullmq';
import { prisma } from '@nibleaf/database';
import {
  type ChangeRequestEmailEvent,
  DEFAULT_EMAIL_LANGUAGE,
  type EmailLanguage,
  renderChangeRequestEmail,
  resolveEmailLanguage,
} from '@nibleaf/email';
import { env } from '@/env';
import { notificationEnabled, notificationName } from './notifications';

/** Stored notification type and the workspace toggle that silences each event. */
const EVENTS: Record<ChangeRequestEmailEvent, { type: string; preference: string }> = {
  reviewRequested: { type: 'change_request_review_requested', preference: 'change_request_review_requested' },
  approved: { type: 'change_request_approved', preference: 'change_request_reviewed' },
  changesRequested: { type: 'change_request_changes_requested', preference: 'change_request_reviewed' },
  merged: { type: 'change_request_merged', preference: 'change_request_merged' },
};

/**
 * Tell `recipients` (minus the actor and suspended users) about a change request
 * event: one in-app notification each, titled in English like the other inbox
 * entries, plus an email in the actor's interface language, unless the wiki
 * turned the event off. Best-effort: callers swallow failures.
 */
export const notifyChangeRequest = async (input: {
  projectId: string;
  changeRequest: { number: number; title: string };
  event: ChangeRequestEmailEvent;
  actor: { id: string; name: string; email: string };
  recipients: readonly (string | null)[];
  locale?: string;
}) => {
  const ids = [...new Set(input.recipients)].filter((id): id is string => Boolean(id) && id !== input.actor.id);
  if (ids.length === 0) return;
  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: { name: true, organization: { select: { metadata: true } } },
  });
  if (!project || !notificationEnabled(project.organization.metadata, EVENTS[input.event].preference)) return;
  const users = await prisma.user.findMany({ where: { id: { in: ids }, suspendedAt: null }, select: { id: true, email: true } });
  if (users.length === 0) return;
  const href = `/app/projects/${input.projectId}/changes/${input.changeRequest.number}`;
  const render = (language: EmailLanguage) =>
    renderChangeRequestEmail({
      event: input.event,
      actorName: notificationName(input.actor),
      projectName: project.name,
      number: input.changeRequest.number,
      title: input.changeRequest.title,
      url: `${env.APP_URL}${href}`,
      language,
    });
  const language = resolveEmailLanguage(input.locale);
  const email = await render(language);
  const inboxTitle = language === DEFAULT_EMAIL_LANGUAGE ? email.subject : (await render(DEFAULT_EMAIL_LANGUAGE)).subject;
  await prisma.notification.createMany({
    data: users.map((user) => ({
      userId: user.id,
      projectId: input.projectId,
      type: EVENTS[input.event].type,
      title: inboxTitle,
      body: project.name,
      href,
    })),
  });
  await Promise.allSettled(
    users.map((user) =>
      createJob(QueueNames.EMAIL, { name: 'send-email', data: { to: user.email, subject: email.subject, html: email.html, text: email.text } }),
    ),
  );
};
