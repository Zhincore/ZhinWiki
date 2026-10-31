import { type ChangeRequestStatus, Prisma, prisma } from '@nibleaf/database';
import type { Locale } from '@nibleaf/i18n/locales';
import { changerequest_defaulttitle } from '@nibleaf/i18n/messages';
import { changeRequestPolicy } from '@nibleaf/shared/rbac';
import type { CreateChangeRequestBody, UpdateChangeRequestBody } from '@nibleaf/validators';
import { AppError, conflict, forbidden, notFound } from '@/errors';
import { assertNoTrackedChangeRequests, createBranch, getDefaultBranch } from './branches';
import { type ForkBase, type MergedFields, type MergePage, type MergeRecordEntry, planMerge, summarizeChanges } from './change-request-merge';
import { capableReviewSummary, mergeReviewSummary, reviewCapableUserIds, reviewSummary } from './change-request-reviews';

const MERGE_TIMEOUT_MS = 60_000;
/** Open change requests one outside contributor may have per wiki. */
export const CONTRIBUTOR_OPEN_LIMIT = 5;

const mergePageSelect = {
  id: true,
  languageId: true,
  parentId: true,
  kind: true,
  title: true,
  slug: true,
  path: true,
  icon: true,
  description: true,
  content: true,
  config: true,
  translationKey: true,
  position: true,
  hidden: true,
  sourcePageId: true,
  forkFingerprint: true,
} satisfies Prisma.PageSelect;

const userSelect = { select: { id: true, name: true, image: true } } as const;

/** Merge bookkeeping columns, left out of API responses. */
const internalColumns = { mergeRecord: true, forkBase: true } as const;

/** Default title of a change request opened by `name`, in the caller's interface locale. */
const defaultChangeRequestTitle = (name: string, locale?: Locale) => changerequest_defaulttitle({ name }, { locale });

const findChangeRequest = async (projectId: string, number: number) => {
  const changeRequest = await prisma.changeRequest.findUnique({ where: { projectId_number: { projectId, number } } });
  if (!changeRequest) throw notFound('changeRequest', { number });
  return changeRequest;
};

const reviewInclude = {
  reviewers: { select: { userId: true, requestedAt: true, addedAt: true, user: userSelect }, orderBy: { addedAt: 'asc' } },
  reviews: { select: { id: true, authorId: true, state: true, body: true, createdAt: true, author: userSelect }, orderBy: { createdAt: 'asc' } },
} as const satisfies Prisma.ChangeRequestInclude;

/** Change requests with each reviewer who can still review and whether they owe a review. */
export const listChangeRequests = async (projectId: string, organizationId: string, status?: ChangeRequestStatus) => {
  const rows = await prisma.changeRequest.findMany({
    where: { projectId, ...(status ? { status } : {}) },
    orderBy: { number: 'desc' },
    omit: internalColumns,
    include: {
      author: userSelect,
      reviewers: { select: { userId: true, requestedAt: true, addedAt: true } },
      reviews: { select: { authorId: true, state: true, createdAt: true } },
    },
  });
  const capable = await reviewCapableUserIds(organizationId, [...new Set(rows.flatMap((row) => row.reviewers.map((reviewer) => reviewer.userId)))]);
  return rows.map(({ reviewers, reviews, ...row }) => ({
    ...row,
    reviewers: reviewSummary({
      reviewers: reviewers.filter((reviewer) => capable.has(reviewer.userId)),
      reviews,
      required: 0,
      editedAt: row.editedAt,
    }).reviewers.map(({ userId, awaiting }) => ({ userId, awaiting })),
  }));
};

/** Open a change request on a fresh copy of the default branch; an outside
 *  contributor only while they have fewer than `CONTRIBUTOR_OPEN_LIMIT` open. */
export const createChangeRequest = async (
  projectId: string,
  body: CreateChangeRequestBody,
  author: { id: string; name: string },
  options: { locale?: Locale; contributor?: boolean } = {},
) => {
  if (options.contributor) {
    const open = await prisma.changeRequest.count({ where: { projectId, authorId: author.id, status: { in: ['DRAFT', 'IN_REVIEW'] } } });
    if (open >= CONTRIBUTOR_OPEN_LIMIT) {
      throw new AppError({
        code: 'change_requests:open_limit',
        message: `Contributors may have ${CONTRIBUTOR_OPEN_LIMIT} open change requests per wiki. Archive one first.`,
        details: { limit: CONTRIBUTOR_OPEN_LIMIT },
      });
    }
  }
  const branch = await createBranch(projectId, {
    title: body.title?.trim() || defaultChangeRequestTitle(author.name, options.locale),
    description: body.description ?? null,
    authorId: author.id,
  });
  return prisma.changeRequest.findUniqueOrThrow({ where: { branchId: branch.id }, omit: internalColumns, include: { author: userSelect } });
};

const loadPages = (projectId: string, branchId: string, client: Prisma.TransactionClient = prisma): Promise<MergePage[]> =>
  client.page.findMany({ where: { projectId, branchId }, select: mergePageSelect, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] });

const recordEntries = (mergeRecord: Prisma.JsonValue | null) => (mergeRecord as { pages?: MergeRecordEntry[] } | null)?.pages ?? [];

/** A change request with the pages it changes: compared against the default
 *  branch while open, read from the merge record once merged. */
export const getChangeRequest = async (projectId: string, number: number) => {
  const changeRequest = await prisma.changeRequest.findUnique({
    where: { projectId_number: { projectId, number } },
    include: {
      author: userSelect,
      mergedBy: userSelect,
      branch: true,
      project: { select: { organizationId: true, config: true } },
      ...reviewInclude,
    },
  });
  if (!changeRequest) throw notFound('changeRequest', { number });
  const { mergeRecord, forkBase, branch, project, reviewers, reviews, ...fields } = changeRequest;
  const review = await capableReviewSummary(prisma, {
    organizationId: project.organizationId,
    reviewers,
    reviews,
    required: changeRequestPolicy(project.config).requiredApprovals,
    editedAt: fields.editedAt,
  });
  const users = new Map(reviewers.map((reviewer) => [reviewer.userId, reviewer.user]));
  const participants = new Map<string, { id: string; name: string; image: string | null }>();
  for (const user of [fields.author, ...reviewers.map((reviewer) => reviewer.user), ...reviews.map((item) => item.author)]) {
    if (user) participants.set(user.id, user);
  }
  const rest = {
    ...fields,
    reviewers: review.reviewers.flatMap(({ userId, state, awaiting }) => {
      const user = users.get(userId);
      return user ? [{ user, state, awaiting }] : [];
    }),
    reviews: reviews.map(({ authorId: _authorId, ...item }) => item),
    participants: [...participants.values()],
    review: { required: review.required, approvals: review.approvals, changesRequested: review.changesRequested, mergeable: review.mergeable },
  };
  if (!branch) {
    const changes = recordEntries(mergeRecord).map((entry) => {
      const page = entry.after ?? entry.before;
      return {
        change: entry.action,
        mainPageId: entry.pageId,
        branchPageId: null,
        title: page?.title ?? '',
        path: page?.path ?? '',
        languageId: entry.languageId,
      };
    });
    return { ...rest, changes, conflicts: [] };
  }
  const main = await getDefaultBranch(projectId);
  const [mainPages, branchPages] = await Promise.all([loadPages(projectId, main.id), loadPages(projectId, branch.id)]);
  const input = { main: mainPages, branch: branchPages, forkBase: forkBase as ForkBase };
  const plan = planMerge({ ...input, force: new Set() });
  return { ...rest, changes: summarizeChanges(input), conflicts: plan.legacy ? [] : plan.conflicts };
};

/** Update a change request; a contributor (`contributorId`) only their own. */
export const updateChangeRequest = async (projectId: string, number: number, body: UpdateChangeRequestBody, contributorId?: string) => {
  const changeRequest = await findChangeRequest(projectId, number);
  if (contributorId && changeRequest.authorId !== contributorId) {
    throw forbidden('Contributors change only their own change requests.');
  }
  const statusChange = body.status !== undefined && body.status !== changeRequest.status;
  if (contributorId && statusChange && changeRequest.status === 'ARCHIVED') {
    throw forbidden('Ask a member to reopen an archived change request.');
  }
  if (statusChange) {
    if (changeRequest.status === 'MERGED') throw conflict('A merged change request cannot change status.');
    if (changeRequest.status === 'ARCHIVED' && !changeRequest.branchId) {
      throw conflict('This change request lost its branch and cannot be reopened.');
    }
  }
  // A status change applies only if no merge or branch deletion changed the status since it was read.
  const { count } = await prisma.changeRequest.updateMany({
    where: { id: changeRequest.id, ...(statusChange ? { status: changeRequest.status, branchId: changeRequest.branchId } : {}) },
    data: {
      ...(body.title === undefined ? {} : { title: body.title.trim() }),
      ...(body.description === undefined ? {} : { description: body.description }),
      ...(body.status === undefined ? {} : { status: body.status }),
    },
  });
  if (count === 0) throw conflict('This change request changed meanwhile. Reload and try again.');
  return prisma.changeRequest.findUniqueOrThrow({ where: { id: changeRequest.id }, omit: internalColumns, include: { author: userSelect } });
};

const jsonValue = (value: unknown) => (value === null || value === undefined ? Prisma.JsonNull : (value as Prisma.InputJsonValue));

const pageData = <T extends Partial<MergedFields>>(data: T) => {
  const { config, ...rest } = data;
  return { ...rest, ...('config' in data ? { config: jsonValue(config) } : {}) };
};

/**
 * Merge a change request into the default branch page by page, then delete its
 * branch. Conflicting pages are refused with a 409 listing them unless every
 * one of them is named in `force`, which lets the branch win on those pages.
 */
export const mergeChangeRequest = async (projectId: string, number: number, userId: string, force: readonly string[]) => {
  const { id } = await findChangeRequest(projectId, number);
  const main = await getDefaultBranch(projectId);
  return prisma.$transaction(
    async (tx) => {
      // Serialize merges per project and hold main's rows against concurrent edits until commit.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${projectId}))`;
      await tx.$executeRaw`SELECT 1 FROM "page" WHERE "branchId" = ${main.id} ORDER BY "id" FOR UPDATE`;
      const changeRequest = await tx.changeRequest.findUniqueOrThrow({ where: { id } });
      if (changeRequest.status === 'MERGED') throw conflict('This change request is already merged.');
      if (changeRequest.status === 'ARCHIVED') throw conflict('Reopen this change request before merging it.');
      if (!changeRequest.branchId) throw conflict('This change request has no branch to merge.');
      const project = await tx.project.findUniqueOrThrow({ where: { id: projectId }, select: { organizationId: true, config: true } });
      const review = await mergeReviewSummary(tx, changeRequest, project.organizationId, changeRequestPolicy(project.config).requiredApprovals);
      if (!review.mergeable) {
        throw new AppError({
          code: 'change_requests:review_required',
          message:
            review.changesRequested > 0
              ? 'A reviewer requested changes on this change request.'
              : `This change request needs ${review.required} approval(s) before merging.`,
          details: { approvals: review.approvals, required: review.required, changesRequested: review.changesRequested },
        });
      }
      const branchId = changeRequest.branchId;
      const [mainPages, branchPages] = await Promise.all([loadPages(projectId, main.id, tx), loadPages(projectId, branchId, tx)]);
      const plan = planMerge({ main: mainPages, branch: branchPages, forkBase: changeRequest.forkBase as ForkBase, force: new Set(force) });
      if (plan.legacy) {
        await assertNoTrackedChangeRequests(tx, projectId, 'Merge or discard the other open change requests first; this one replaces every page.');
        await tx.page.deleteMany({ where: { projectId, branchId: main.id } });
        await tx.page.updateMany({ where: { projectId, branchId }, data: { branchId: main.id } });
      } else {
        if (plan.blocked) {
          throw conflict('Some pages changed on both sides since this change request was opened.', { conflicts: plan.conflicts });
        }
        for (const insert of plan.inserts) {
          await tx.page.update({
            where: { id: insert.id },
            data: { ...pageData(insert.data), branchId: main.id, sourcePageId: null, forkFingerprint: null },
          });
        }
        for (const update of plan.updates) {
          await tx.page.update({ where: { id: update.id }, data: pageData(update.data) });
        }
        if (plan.deletes.length > 0) await tx.page.deleteMany({ where: { id: { in: plan.deletes }, branchId: main.id } });
      }
      await tx.branch.delete({ where: { id: branchId } });
      return tx.changeRequest.update({
        where: { id },
        data: {
          status: 'MERGED',
          mergedById: userId,
          mergedAt: new Date(),
          forkBase: Prisma.DbNull,
          mergeRecord: { pages: plan.record } as unknown as Prisma.InputJsonValue,
        },
        omit: internalColumns,
        include: { author: userSelect, mergedBy: userSelect },
      });
    },
    { timeout: MERGE_TIMEOUT_MS },
  );
};

type DiffPage = {
  id: string;
  title: string;
  slug: string;
  path: string;
  icon: string | null;
  description: string | null;
  hidden: boolean;
  position: number;
  content: string;
  config: unknown;
  translationKey: string | null;
};

const diffSide = (page: DiffPage | null | undefined) =>
  page
    ? {
        id: page.id,
        title: page.title,
        slug: page.slug,
        path: page.path,
        icon: page.icon,
        description: page.description,
        hidden: page.hidden,
        position: page.position,
        content: page.content,
        config: page.config,
        translationKey: page.translationKey,
      }
    : null;

/** Markdown and metadata of one page on the default branch and in the change request.
 *  `pageId` may name either side; a merged request answers from its record. */
export const getChangeRequestPageDiff = async (projectId: string, number: number, pageId: string) => {
  const changeRequest = await findChangeRequest(projectId, number);
  if (!changeRequest.branchId) {
    const entry = recordEntries(changeRequest.mergeRecord).find((item) => item.pageId === pageId);
    if (!entry) throw notFound('page', { id: pageId });
    return { main: diffSide(entry.before && { ...entry.before, id: pageId }), change: diffSide(entry.after && { ...entry.after, id: pageId }) };
  }
  const main = await getDefaultBranch(projectId);
  const page = await prisma.page.findFirst({ where: { id: pageId, projectId, branchId: { in: [main.id, changeRequest.branchId] } } });
  if (!page) throw notFound('page', { id: pageId });
  if (page.branchId === main.id) {
    const copy = await prisma.page.findFirst({ where: { projectId, branchId: changeRequest.branchId, sourcePageId: page.id } });
    return { main: diffSide(page), change: diffSide(copy) };
  }
  const source = page.sourcePageId ? await prisma.page.findFirst({ where: { id: page.sourcePageId, projectId, branchId: main.id } }) : null;
  return { main: diffSide(source), change: diffSide(page) };
};
