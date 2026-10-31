import { type ChangeRequestReviewState, type Prisma, prisma } from '@nibleaf/database';
import { PlatformRole } from '@nibleaf/shared/constants';
import { platformWikiGrant } from '@nibleaf/shared/rbac';
import type { SubmitChangeRequestReviewBody } from '@nibleaf/validators';
import { env } from '@/env';
import { badRequest, conflict, notFound } from '@/errors';

/** Long enough to wait out a running merge, which holds the project lock for up to 60 s. */
const REVIEW_WRITE_TIMEOUT_MS = 70_000;

type Reviewer = { userId: string; requestedAt: Date; addedAt: Date };
type Review = { authorId: string | null; state: ChangeRequestReviewState; createdAt: Date };

/**
 * Review state of a change request. Each reviewer's latest approval or change
 * request since they became a reviewer is their verdict (comments do not change
 * it); reviews by non-reviewers do not count. An approval older than the last
 * page edit (`editedAt`) is stale: no verdict, and the reviewer awaits review
 * again, as they do after being asked until they review.
 */
export const reviewSummary = ({
  reviewers,
  reviews,
  required,
  editedAt,
}: {
  reviewers: readonly Reviewer[];
  reviews: readonly Review[];
  required: number;
  editedAt: Date | null;
}) => {
  const ordered = [...reviews].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const states = reviewers.map((reviewer) => {
    let verdict: Review | undefined;
    let reviewedAt: Date | undefined;
    for (const review of ordered) {
      if (review.authorId !== reviewer.userId || review.createdAt < reviewer.addedAt) continue;
      reviewedAt = review.createdAt;
      if (review.state !== 'COMMENTED') verdict = review;
    }
    const stale = verdict?.state === 'APPROVED' && editedAt !== null && verdict.createdAt < editedAt;
    return {
      userId: reviewer.userId,
      state: stale ? null : (verdict?.state ?? null),
      awaiting: stale || !reviewedAt || reviewedAt < reviewer.requestedAt,
    };
  });
  const approvals = states.filter((reviewer) => reviewer.state === 'APPROVED').length;
  const changesRequested = states.filter((reviewer) => reviewer.state === 'CHANGES_REQUESTED').length;
  return { reviewers: states, approvals, changesRequested, required, mergeable: approvals >= required && changesRequested === 0 };
};

/** The subset of `userIds` with review rights on the organization's wiki: members, and platform editors/admins in shared tenancy. */
export const reviewCapableUserIds = async (organizationId: string, userIds: readonly string[], client: Prisma.TransactionClient = prisma) => {
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

const openChangeRequestSelect = {
  id: true,
  title: true,
  number: true,
  status: true,
  authorId: true,
  editedAt: true,
  project: { select: { organizationId: true } },
} as const satisfies Prisma.ChangeRequestSelect;

type OpenChangeRequest = Prisma.ChangeRequestGetPayload<{ select: typeof openChangeRequestSelect }>;

const reviewerSelect = { userId: true, requestedAt: true, addedAt: true } as const;
const reviewSelect = { authorId: true, state: true, createdAt: true } as const;

/**
 * Run `write` on an open change request under the per-project lock merges take,
 * so a review never lands on a change request merged meanwhile.
 */
const inOpenChangeRequest = <T>(
  projectId: string,
  number: number,
  write: (tx: Prisma.TransactionClient, changeRequest: OpenChangeRequest) => Promise<T>,
) =>
  prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${projectId}))`;
      const changeRequest = await tx.changeRequest.findUnique({
        where: { projectId_number: { projectId, number } },
        select: openChangeRequestSelect,
      });
      if (!changeRequest) throw notFound('changeRequest', { number });
      if (changeRequest.status !== 'DRAFT' && changeRequest.status !== 'IN_REVIEW') {
        throw conflict('Reviews are closed on a merged or archived change request.');
      }
      return write(tx, changeRequest);
    },
    { timeout: REVIEW_WRITE_TIMEOUT_MS },
  );

/** Ask `userId` for a review (again). Returns the change request to notify about. */
export const requestReview = (projectId: string, number: number, userId: string, requestedById: string) =>
  inOpenChangeRequest(projectId, number, async (tx, changeRequest) => {
    if (!(await reviewCapableUserIds(changeRequest.project.organizationId, [userId], tx)).has(userId)) {
      throw badRequest('Only members can review this change request.', { userId });
    }
    const now = new Date();
    await tx.changeRequestReviewer.upsert({
      where: { changeRequestId_userId: { changeRequestId: changeRequest.id, userId } },
      create: { changeRequestId: changeRequest.id, userId, requestedById, requestedAt: now, addedAt: now },
      update: { requestedById, requestedAt: now },
    });
    return changeRequest;
  });

/** Remove a reviewer; their reviews stay in the history and never count again. */
export const removeReviewer = (projectId: string, number: number, userId: string) =>
  inOpenChangeRequest(projectId, number, async (tx, changeRequest) => {
    await tx.changeRequestReviewer.deleteMany({ where: { changeRequestId: changeRequest.id, userId } });
  });

/**
 * Record a review; the reviewing user becomes a reviewer if they were not one.
 * `previous` is their verdict before this review.
 */
export const submitReview = (projectId: string, number: number, authorId: string, body: SubmitChangeRequestReviewBody) =>
  inOpenChangeRequest(projectId, number, async (tx, changeRequest) => {
    const [reviewer, reviews] = await Promise.all([
      tx.changeRequestReviewer.findUnique({
        where: { changeRequestId_userId: { changeRequestId: changeRequest.id, userId: authorId } },
        select: reviewerSelect,
      }),
      tx.changeRequestReview.findMany({ where: { changeRequestId: changeRequest.id, authorId }, select: reviewSelect }),
    ]);
    const previous = reviewer
      ? (reviewSummary({ reviewers: [reviewer], reviews, required: 0, editedAt: changeRequest.editedAt }).reviewers[0]?.state ?? null)
      : null;
    const now = new Date();
    if (!reviewer) {
      await tx.changeRequestReviewer.create({ data: { changeRequestId: changeRequest.id, userId: authorId, requestedAt: now, addedAt: now } });
    }
    await tx.changeRequestReview.create({
      data: { changeRequestId: changeRequest.id, authorId, state: body.state, body: body.body || null, createdAt: now },
    });
    return { changeRequest, previous };
  });

/** Review state counting only reviewers who still have review rights. */
export const capableReviewSummary = async (
  client: Prisma.TransactionClient,
  input: { organizationId: string; reviewers: readonly Reviewer[]; reviews: readonly Review[]; required: number; editedAt: Date | null },
) => {
  const capable = await reviewCapableUserIds(
    input.organizationId,
    input.reviewers.map((reviewer) => reviewer.userId),
    client,
  );
  return reviewSummary({ ...input, reviewers: input.reviewers.filter((reviewer) => capable.has(reviewer.userId)) });
};

/** The merge gate: approvals from current reviewers with review rights meet the
 *  wiki's requirement and none of them requests changes. */
export const mergeReviewSummary = async (
  client: Prisma.TransactionClient,
  changeRequest: { id: string; editedAt: Date | null },
  organizationId: string,
  required: number,
) => {
  const [reviewers, reviews] = await Promise.all([
    client.changeRequestReviewer.findMany({ where: { changeRequestId: changeRequest.id }, select: reviewerSelect }),
    client.changeRequestReview.findMany({ where: { changeRequestId: changeRequest.id }, select: reviewSelect }),
  ]);
  return capableReviewSummary(client, { organizationId, reviewers, reviews, required, editedAt: changeRequest.editedAt });
};
