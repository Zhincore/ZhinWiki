import { createHash } from 'node:crypto';
import { type Branch, Prisma, prisma } from '@nibleaf/database';
import { newId } from '@nibleaf/shared/ids';
import { AppError, conflict, forbidden, notFound } from '@/errors';
import { contentHash, type ForkBase, pageFingerprint } from './change-request-merge';

/** Every branch of a project, default ('main') first. */
export const listBranches = async (projectId: string): Promise<Branch[]> =>
  await prisma.branch.findMany({ where: { projectId }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] });

/** The project's required default branch. Missing data is an invariant error. */
export const getDefaultBranch = async (projectId: string) => {
  const defaults = await prisma.branch.findMany({ where: { projectId, isDefault: true }, take: 2 });
  if (defaults.length !== 1 || !defaults[0]) {
    throw new Error(`Project ${projectId} must have exactly one default branch.`);
  }
  return defaults[0];
};

/** Throw unless the branch exists in the project; returns it. */
export const assertBranchInProject = async (projectId: string, id: string) => {
  const branch = await prisma.branch.findFirst({ where: { id, projectId } });
  if (!branch) {
    throw notFound('branch', { id });
  }
  return branch;
};

/**
 * Members edit pages only inside open (draft or in-review) change requests;
 * contributors (`authorId`) only inside their own. `pageIds` are the pages
 * written (or the parent a page is created under); without them `branchId`
 * (default: main) is the target. Returns the change requests written to.
 * System writers (imports, Git sync, merges) call the page actions directly.
 */
export const assertPagesEditable = async (
  projectId: string,
  target: { branchId?: string; pageIds?: readonly string[] },
  authorId?: string,
): Promise<string[]> => {
  const main = await getDefaultBranch(projectId);
  const branchIds = target.pageIds
    ? (
        await prisma.page.findMany({
          where: { projectId, id: { in: [...target.pageIds] } },
          select: { branchId: true },
          distinct: ['branchId'],
        })
      ).map((page) => page.branchId)
    : [target.branchId ?? main.id];
  if (branchIds.includes(main.id)) {
    throw new AppError({ code: 'pages:main_read_only', message: 'Pages on main are read-only. Open a change request to edit them.' });
  }
  if (branchIds.length === 0) return [];
  const open = await prisma.changeRequest.findMany({
    where: { projectId, branchId: { in: branchIds }, status: { in: ['DRAFT', 'IN_REVIEW'] } },
    select: { id: true, authorId: true },
  });
  if (open.length < branchIds.length) {
    throw new AppError({ code: 'pages:branch_read_only', message: 'Pages are edited only in an open change request.' });
  }
  if (authorId && open.some((changeRequest) => changeRequest.authorId !== authorId)) {
    throw forbidden('Contributors edit only their own change requests.');
  }
  return open.map((changeRequest) => changeRequest.id);
};

/** Record a page write in change requests; earlier approvals stop counting. */
export const markChangeRequestsEdited = async (changeRequestIds: readonly string[]) => {
  if (changeRequestIds.length === 0) return;
  await prisma.changeRequest.updateMany({ where: { id: { in: [...changeRequestIds] } }, data: { editedAt: new Date() } });
};

/** Throw notFound unless a contributor may read the branch: main or a change request's. */
export const assertBranchReadable = async (projectId: string, branchId: string) => {
  const readable = await prisma.branch.count({ where: { id: branchId, projectId, OR: [{ isDefault: true }, { changeRequest: { isNot: null } }] } });
  if (readable === 0) {
    throw notFound('branch', { id: branchId });
  }
};

const UNIQUE_VIOLATION = 'P2002';
const MAX_NUMBER_ATTEMPTS = 5;

/** Copy every default-branch page onto `branchId` with fresh ids and remapped
 *  parents. Change-request copies also record their source page and its fork
 *  fingerprint so a merge can tell who changed what. Returns the fork base. */
const forkDefaultBranch = async (
  tx: Prisma.TransactionClient,
  projectId: string,
  branchId: string,
  link: boolean,
): Promise<NonNullable<ForkBase>> => {
  const main = await tx.branch.findFirstOrThrow({ where: { projectId, isDefault: true }, select: { id: true } });
  const sourcePages = await tx.page.findMany({ where: { projectId, branchId: main.id }, orderBy: { position: 'asc' } });
  if (sourcePages.length === 0) return {};
  const copies = sourcePages.map((p) => ({ p, id: newId() }));
  const idMap = new Map(copies.map(({ p, id }) => [p.id, id]));
  await tx.page.createMany({
    data: copies.map(({ p, id }) => ({
      id,
      projectId,
      branchId,
      languageId: p.languageId,
      parentId: p.parentId ? (idMap.get(p.parentId) ?? null) : null,
      kind: p.kind,
      title: p.title,
      slug: p.slug,
      path: p.path,
      icon: p.icon,
      description: p.description,
      content: p.content,
      config: p.config ?? undefined,
      translationKey: p.translationKey,
      position: p.position,
      hidden: p.hidden,
      ...(link ? { sourcePageId: p.id, forkFingerprint: pageFingerprint(p, p.parentId) } : {}),
    })),
  });
  return Object.fromEntries(copies.map(({ p, id }) => [p.id, { hash: contentHash(p), copyId: id }]));
};

/** Replacing main wholesale (imports, untracked merges) gives its pages new
 *  ids, which would orphan the fork links of tracked change requests that
 *  still have a branch. Throws a 409 with `message` while any exist. */
export const assertNoTrackedChangeRequests = async (db: Prisma.TransactionClient, projectId: string, message: string) => {
  const open = await db.changeRequest.count({ where: { projectId, branchId: { not: null }, forkBase: { not: Prisma.DbNull } } });
  if (open > 0) throw conflict(message, { projectId, openChangeRequests: open });
};

const IMPORT_OVER_CHANGE_REQUESTS = 'Merge or discard the open change requests before importing over this wiki.';

/** Create an empty, non-default branch used to assemble an authoritative
 * importer replacement away from the editable main tree. It is promoted only
 * after the whole import succeeds; failures can delete it without touching the
 * user's current draft. Replacement branches never get a change request. */
export const createImportReplacementBranch = async (projectId: string, source: string, preserveExisting: boolean) => {
  const name = `import-${source}-${newId()}`;
  return prisma.$transaction(async (tx) => {
    await assertNoTrackedChangeRequests(tx, projectId, IMPORT_OVER_CHANGE_REQUESTS);
    const branch = await tx.branch.create({ data: { projectId, name, isDefault: false } });
    if (preserveExisting) await forkDefaultBranch(tx, projectId, branch.id, false);
    return branch;
  });
};

const draftFingerprint = async (db: Prisma.TransactionClient, projectId: string, branchId: string) => {
  const pages = await db.page.findMany({
    where: { projectId, branchId },
    orderBy: { id: 'asc' },
    select: { id: true, branchId: true, languageId: true, parentId: true, path: true, slug: true, kind: true, position: true, updatedAt: true },
  });
  const project = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { config: true } });
  return createHash('sha256')
    .update(JSON.stringify({ pages, config: project.config }))
    .digest('hex');
};

const importTransactionOptions = { isolationLevel: 'Serializable', timeout: 30_000 } as const;
const draftChanged = () =>
  new AppError({ code: 'import:conflict', message: 'The draft changed during import. Your edits were preserved; retry the import.' });
const importTransactionFailure = (error: unknown): never => {
  if (error && typeof error === 'object' && 'code' in error) {
    if (error.code === 'P2034') throw draftChanged();
    if (error.code === 'P2028') throw new AppError({ code: 'import:busy', message: 'The import could not complete. Try again shortly.' });
  }
  throw error;
};

export const captureImportDraft = async (projectId: string) => {
  const main = await getDefaultBranch(projectId);
  return prisma.$transaction((tx) => draftFingerprint(tx, projectId, main.id), importTransactionOptions).catch(importTransactionFailure);
};

/** Atomically replace main with a completed import branch and, when supplied,
 * apply the imported project chrome in the same commit. */
export const promoteImportReplacementBranch = async (
  projectId: string,
  id: string,
  projectConfig?: Prisma.InputJsonValue,
  expectedDraft?: string,
) => {
  const branch = await assertBranchInProject(projectId, id);
  if (branch.isDefault) throw conflict('The default branch cannot be promoted as an import replacement.');
  const main = await getDefaultBranch(projectId);
  await prisma
    .$transaction(async (tx) => {
      await assertNoTrackedChangeRequests(tx, projectId, IMPORT_OVER_CHANGE_REQUESTS);
      if (expectedDraft !== undefined && (await draftFingerprint(tx, projectId, main.id)) !== expectedDraft) {
        throw draftChanged();
      }
      await tx.page.deleteMany({ where: { projectId, branchId: main.id } });
      await tx.page.updateMany({ where: { projectId, branchId: branch.id }, data: { branchId: main.id } });
      await tx.branch.delete({ where: { id: branch.id } });
      if (projectConfig !== undefined) {
        await tx.project.update({ where: { id: projectId }, data: { config: projectConfig } });
      }
    }, importTransactionOptions)
    .catch(importTransactionFailure);
  return main;
};

export type CreateBranchInput = {
  /** Branch name; `cr-<number>` when omitted. */
  name?: string;
  title: string;
  description?: string | null;
  authorId: string | null;
  /** Start from a copy of the default branch (default) or empty; an empty
   *  branch is untracked and merges by replacing the default branch. */
  fork?: boolean;
};

const isUniqueViolation = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_VIOLATION;

/** Create a non-default branch with its change request, numbered after the
 *  project's highest one. A concurrent create taking the same number or name
 *  is retried. */
export const createBranch = async (projectId: string, input: CreateBranchInput): Promise<Branch> => {
  const name = input.name?.trim();
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        // Same lock as merges, so a fork never copies links to main pages a running merge deletes.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${projectId}))`;
        if (name && (await tx.branch.findFirst({ where: { projectId, name }, select: { id: true } }))) {
          throw conflict('A branch with that name already exists.', { name });
        }
        const latest = await tx.changeRequest.aggregate({ where: { projectId }, _max: { number: true } });
        const number = (latest._max.number ?? 0) + 1;
        const fallbackName = `cr-${number}`;
        const branchName =
          name ??
          ((await tx.branch.findFirst({ where: { projectId, name: fallbackName }, select: { id: true } }))
            ? `${fallbackName}-${newId()}`
            : fallbackName);
        const branch = await tx.branch.create({ data: { projectId, name: branchName, isDefault: false } });
        const forkBase = input.fork === false ? null : await forkDefaultBranch(tx, projectId, branch.id, true);
        await tx.changeRequest.create({
          data: {
            projectId,
            number,
            title: input.title,
            description: input.description ?? null,
            authorId: input.authorId,
            branchId: branch.id,
            forkBase: forkBase ?? Prisma.DbNull,
          },
        });
        return branch;
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      if (attempt >= MAX_NUMBER_ATTEMPTS) throw conflict('Another change request was created at the same time. Try again.');
    }
  }
};

/** Delete a non-default branch (its pages cascade away); its change request is archived. */
export const deleteBranch = async (projectId: string, id: string) => {
  const branch = await assertBranchInProject(projectId, id);
  if (branch.isDefault) {
    throw conflict('You cannot delete the default branch.');
  }
  await prisma.$transaction([
    prisma.changeRequest.updateMany({ where: { branchId: id, status: { not: 'MERGED' } }, data: { status: 'ARCHIVED' } }),
    prisma.branch.delete({ where: { id } }),
  ]);
  return { id };
};
