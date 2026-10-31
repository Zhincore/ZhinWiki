import { type ChangeRequestReviewState, type Prisma, prisma } from '@nibleaf/database';
import { PlatformRole } from '@nibleaf/shared/constants';
import { platformWikiGrant } from '@nibleaf/shared/rbac';
import type { SubmitChangeRequestReviewBody } from '@nibleaf/validators';
import { env } from '@/env';
import { badRequest, conflict, notFound } from '@/errors';

type Reviewer = { userId: string; requestedAt: Date };
type Review = { authorId: string | null; state: ChangeRequestReviewState; createdAt: Date };

/**
 * Review state of a change request. Each reviewer's latest approval or change
 * request is their verdict (comments do not change it); reviews by non-reviewers
 * do not count. A reviewer awaits review until they review after being asked.
 */
export const reviewSummary = ({ reviewers, reviews, required }: { reviewers: readonly Reviewer[]; reviews: readonly Review[]; required: number }) => {
  const ordered = [...reviews].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const verdicts = new Map<string, ChangeRequestReviewState>();
  const lastReviewAt = new Map<string, Date>();
  for (const review of ordered) {
    if (!review.authorId) continue;
    lastReviewAt.set(review.authorId, review.createdAt);
    if (review.state !== 'COMMENTED') verdicts.set(review.authorId, review.state);
  }
  const states = reviewers.map((reviewer) => {
    const reviewedAt = lastReviewAt.get(reviewer.userId);
    return {
      userId: reviewer.userId,
      state: verdicts.get(reviewer.userId) ?? null,
      awaiting: !reviewedAt || reviewedAt < reviewer.requestedAt,
    };
  });
  const approvals = states.filter((reviewer) => reviewer.state === 'APPROVED').length;
  const changesRequested = states.filter((reviewer) => reviewer.state === 'CHANGES_REQUESTED').length;
  return { reviewers: states, approvals, changesRequested, required, mergeable: approvals >= required && changesRequested === 0 };
};

/** The subset of `userIds` with review rights on the organization's wiki: members, and platform editors/admins in shared tenancy. */
const reviewCapableUserIds = async (organizationId: string, userIds: readonly string[], client: Prisma.TransactionClient = prisma) => {
  if (userIds.length === 0) return new Set<string>();
  const users = await client.user.findMany({
    where: { id: { in: [...userIds] }, suspendedAt: null },
    select: { id: true, role: true, members: { where: { organizationId }, select: { id: true } } },
  });
  return new Set(users.filter((user) => user.members.length > 0 || platformWikiGrant(env.TENANCY, user.role)).map((user) => user.id));
};

/** Users who can be asked to review: the wiki's members and, in shared tenancy, platform editors and admins. Name and avatar only. */
export const listReviewerCandidates = async (organizationId: string) => {
  const platformRoles: string[] = env.TENANCY === 'shared' ? [PlatformRole.EDITOR, PlatformRole.ADMIN] : [];
  return prisma.user.findMany({
    where: { suspendedAt: null, OR: [{ members: { some: { organizationId } } }, { role: { in: platformRoles } }] },
    select: { id: true, name: true, image: true },
    orderBy: { name: 'asc' },
    take: 500,
  });
};

const findOpenChangeRequest = async (projectId: string, number: number) => {
  const changeRequest = await prisma.changeRequest.findUnique({
    where: { projectId_number: { projectId, number } },
    select: { id: true, title: true, number: true, status: true, authorId: true, project: { select: { organizationId: true } } },
  });
  if (!changeRequest) throw notFound('changeRequest', { number });
  if (changeRequest.status !== 'DRAFT' && changeRequest.status !== 'IN_REVIEW') {
    throw conflict('Reviews are closed on a merged or archived change request.');
  }
  return changeRequest;
};

/** Ask `userId` for a review (again). Returns the change request when a request notification is due. */
export const requestReview = async (projectId: string, number: number, userId: string, requestedById: string) => {
  const changeRequest = await findOpenChangeRequest(projectId, number);
  if (!(await reviewCapableUserIds(changeRequest.project.organizationId, [userId])).has(userId)) {
    throw badRequest('Only members can review this change request.', { userId });
  }
  const requestedAt = new Date();
  await prisma.changeRequestReviewer.upsert({
    where: { changeRequestId_userId: { changeRequestId: changeRequest.id, userId } },
    create: { changeRequestId: changeRequest.id, userId, requestedById, requestedAt },
    update: { requestedById, requestedAt },
  });
  return changeRequest;
};

/** Remove a reviewer; their reviews stay in the history but stop counting. */
export const removeReviewer = async (projectId: string, number: number, userId: string) => {
  const changeRequest = await findOpenChangeRequest(projectId, number);
  await prisma.changeRequestReviewer.deleteMany({ where: { changeRequestId: changeRequest.id, userId } });
};

/** Record a review; the author becomes a reviewer if they were not one. */
export const submitReview = async (projectId: string, number: number, authorId: string, body: SubmitChangeRequestReviewBody) => {
  const changeRequest = await findOpenChangeRequest(projectId, number);
  await prisma.$transaction([
    prisma.changeRequestReviewer.upsert({
      where: { changeRequestId_userId: { changeRequestId: changeRequest.id, userId: authorId } },
      create: { changeRequestId: changeRequest.id, userId: authorId },
      update: {},
    }),
    prisma.changeRequestReview.create({
      data: { changeRequestId: changeRequest.id, authorId, state: body.state, body: body.body || null },
    }),
  ]);
  return changeRequest;
};

/** The merge gate: approvals from current reviewers with review rights meet the
 *  wiki's requirement and none of them requests changes. */
export const mergeReviewSummary = async (client: Prisma.TransactionClient, changeRequestId: string, organizationId: string, required: number) => {
  const [reviewers, reviews] = await Promise.all([
    client.changeRequestReviewer.findMany({ where: { changeRequestId }, select: { userId: true, requestedAt: true } }),
    client.changeRequestReview.findMany({ where: { changeRequestId }, select: { authorId: true, state: true, createdAt: true } }),
  ]);
  const capable = await reviewCapableUserIds(
    organizationId,
    reviewers.map((reviewer) => reviewer.userId),
    client,
  );
  return reviewSummary({ reviewers: reviewers.filter((reviewer) => capable.has(reviewer.userId)), reviews, required });
};
