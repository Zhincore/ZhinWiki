import { type ChangeRequestStatus, Prisma, prisma } from '@nibleaf/database';
import type { Locale } from '@nibleaf/i18n/locales';
import { changerequest_defaulttitle } from '@nibleaf/i18n/messages';
import type { CreateChangeRequestBody, UpdateChangeRequestBody } from '@nibleaf/validators';
import { badRequest, conflict, notFound } from '@/errors';
import { assertBranchInProject, createBranch, getDefaultBranch } from './branches';
import { type MergedFields, type MergePage, type MergeRecordEntry, mergedFields, planMerge, summarizeChanges } from './change-request-merge';

const MERGE_TIMEOUT_MS = 60_000;

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
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PageSelect;

const userSelect = { select: { id: true, name: true, image: true } } as const;

/** Default title of a change request opened by `name`, in the caller's interface locale. */
export const defaultChangeRequestTitle = (name: string, locale?: Locale) => changerequest_defaulttitle({ name }, { locale });

const findChangeRequest = async (projectId: string, number: number) => {
  const changeRequest = await prisma.changeRequest.findUnique({ where: { projectId_number: { projectId, number } } });
  if (!changeRequest) throw notFound('changeRequest', { number });
  return changeRequest;
};

export const listChangeRequests = async (projectId: string, status?: ChangeRequestStatus) =>
  prisma.changeRequest.findMany({
    where: { projectId, ...(status ? { status } : {}) },
    orderBy: { number: 'desc' },
    omit: { mergeRecord: true },
    include: { author: userSelect },
  });

/** Open a change request on a fresh copy of the default branch. */
export const createChangeRequest = async (
  projectId: string,
  body: CreateChangeRequestBody,
  author: { id: string; name: string },
  locale?: Locale,
) => {
  const branch = await createBranch(projectId, {
    title: body.title?.trim() || defaultChangeRequestTitle(author.name, locale),
    description: body.description ?? null,
    authorId: author.id,
  });
  return prisma.changeRequest.findUniqueOrThrow({ where: { branchId: branch.id }, omit: { mergeRecord: true }, include: { author: userSelect } });
};

const loadPages = (projectId: string, branchId: string, client: Prisma.TransactionClient = prisma): Promise<MergePage[]> =>
  client.page.findMany({ where: { projectId, branchId }, select: mergePageSelect, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] });

/** A change request with the pages it changes: compared against the default
 *  branch while open, read from the merge record once merged. */
export const getChangeRequest = async (projectId: string, number: number) => {
  const changeRequest = await prisma.changeRequest.findUnique({
    where: { projectId_number: { projectId, number } },
    include: { author: userSelect, mergedBy: userSelect, branch: true },
  });
  if (!changeRequest) throw notFound('changeRequest', { number });
  const { mergeRecord, branch, ...rest } = changeRequest;
  if (!branch) {
    const entries = (mergeRecord as { pages?: MergeRecordEntry[] } | null)?.pages ?? [];
    const changes = entries.map((entry) => ({
      change: entry.action,
      mainPageId: entry.pageId,
      branchPageId: null,
      title: (entry.after ?? entry.before)?.title ?? '',
      languageId: entry.languageId,
    }));
    return { ...rest, changes, conflicts: [] };
  }
  const main = await getDefaultBranch(projectId);
  const [mainPages, branchPages] = await Promise.all([loadPages(projectId, main.id), loadPages(projectId, branch.id)]);
  const input = { main: mainPages, branch: branchPages, forkedAt: branch.createdAt };
  const plan = planMerge({ ...input, force: false });
  return { ...rest, changes: summarizeChanges(input), conflicts: plan.legacy ? [] : plan.conflicts };
};

export const updateChangeRequest = async (projectId: string, number: number, body: UpdateChangeRequestBody) => {
  const changeRequest = await findChangeRequest(projectId, number);
  if (body.status && body.status !== changeRequest.status) {
    if (changeRequest.status === 'MERGED') throw conflict('A merged change request cannot change status.');
    if (changeRequest.status === 'ARCHIVED' && !changeRequest.branchId) {
      throw conflict('This change request lost its branch and cannot be reopened.');
    }
  }
  return prisma.changeRequest.update({
    where: { id: changeRequest.id },
    data: {
      ...(body.title === undefined ? {} : { title: body.title.trim() }),
      ...(body.description === undefined ? {} : { description: body.description }),
      ...(body.status === undefined ? {} : { status: body.status }),
    },
    omit: { mergeRecord: true },
    include: { author: userSelect },
  });
};

const jsonValue = (value: unknown) => (value === null || value === undefined ? Prisma.JsonNull : (value as Prisma.InputJsonValue));

const pageData = <T extends Partial<MergedFields>>(data: T) => {
  const { config, ...rest } = data;
  return { ...rest, ...('config' in data ? { config: jsonValue(config) } : {}) };
};

/**
 * Merge a change request into the default branch page by page, then delete its
 * branch. Pages edited on both sides since the fork are refused with a 409
 * listing them, unless `force` lets the branch win on those pages.
 */
export const mergeChangeRequest = async (projectId: string, number: number, userId: string, force: boolean) => {
  const changeRequest = await findChangeRequest(projectId, number);
  if (changeRequest.status === 'MERGED') throw conflict('This change request is already merged.');
  if (changeRequest.status === 'ARCHIVED') throw conflict('Reopen this change request before merging it.');
  if (!changeRequest.branchId) throw conflict('This change request has no branch to merge.');
  const branch = await assertBranchInProject(projectId, changeRequest.branchId);
  const main = await getDefaultBranch(projectId);
  return prisma.$transaction(
    async (tx) => {
      const [mainPages, branchPages] = await Promise.all([loadPages(projectId, main.id, tx), loadPages(projectId, branch.id, tx)]);
      const plan = planMerge({ main: mainPages, branch: branchPages, forkedAt: branch.createdAt, force });
      let record: MergeRecordEntry[];
      if (plan.legacy) {
        record = [
          ...mainPages.map(
            (page): MergeRecordEntry => ({
              pageId: page.id,
              languageId: page.languageId,
              action: 'removed',
              before: mergedFields(page),
              after: null,
            }),
          ),
          ...branchPages.map(
            (page): MergeRecordEntry => ({
              pageId: page.id,
              languageId: page.languageId,
              action: 'added',
              before: null,
              after: mergedFields(page),
            }),
          ),
        ];
        await tx.page.deleteMany({ where: { projectId, branchId: main.id } });
        await tx.page.updateMany({ where: { projectId, branchId: branch.id }, data: { branchId: main.id } });
      } else {
        if (plan.conflicts.length > 0 && !force) {
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
        record = plan.record;
      }
      await tx.branch.delete({ where: { id: branch.id } });
      return tx.changeRequest.update({
        where: { id: changeRequest.id },
        data: {
          status: 'MERGED',
          mergedById: userId,
          mergedAt: new Date(),
          mergeRecord: { pages: record } as unknown as Prisma.InputJsonValue,
        },
        omit: { mergeRecord: true },
        include: { author: userSelect, mergedBy: userSelect },
      });
    },
    { timeout: MERGE_TIMEOUT_MS },
  );
};

type DiffSide = { id: string; title: string; path: string; content: string } | null;

const diffSide = (page: { id: string; title: string; path?: string; slug?: string; content: string } | null | undefined): DiffSide =>
  page ? { id: page.id, title: page.title, path: page.path ?? page.slug ?? '', content: page.content } : null;

/** Raw Markdown of one page on the default branch and in the change request.
 *  `pageId` may name either side; a merged request answers from its record. */
export const getChangeRequestPageDiff = async (projectId: string, number: number, pageId: string) => {
  const changeRequest = await findChangeRequest(projectId, number);
  if (!changeRequest.branchId) {
    const entry = ((changeRequest.mergeRecord as { pages?: MergeRecordEntry[] } | null)?.pages ?? []).find((item) => item.pageId === pageId);
    if (!entry) throw notFound('page', { id: pageId });
    return { main: diffSide(entry.before && { id: pageId, ...entry.before }), change: diffSide(entry.after && { id: pageId, ...entry.after }) };
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

/** The change request backed by a branch; every non-default branch except import replacements has one. */
export const changeRequestNumberForBranch = async (projectId: string, branchId: string) => {
  const changeRequest = await prisma.changeRequest.findFirst({ where: { projectId, branchId }, select: { number: true } });
  if (!changeRequest) throw badRequest('This branch has no change request to merge.', { branchId });
  return changeRequest.number;
};
