import { type Branch, Prisma, prisma } from '@nibleaf/database';
import { newId } from '@nibleaf/shared/ids';
import { conflict, notFound } from '@/errors';
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
  const idMap = new Map(sourcePages.map((p) => [p.id, newId()]));
  await tx.page.createMany({
    data: sourcePages.map((p) => ({
      id: idMap.get(p.id) ?? newId(),
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
  return Object.fromEntries(sourcePages.map((p) => [p.id, contentHash(p)]));
};

/** Imports give main pages new ids, which would orphan the fork links of
 *  tracked change requests that still have a branch. */
const assertNoTrackedChangeRequests = async (db: Prisma.TransactionClient, projectId: string) => {
  const open = await db.changeRequest.count({ where: { projectId, branchId: { not: null }, forkBase: { not: Prisma.DbNull } } });
  if (open > 0) {
    throw conflict('Merge or discard the open change requests before importing over this wiki.', { projectId, openChangeRequests: open });
  }
};

/** Create an empty, non-default branch used to assemble an authoritative
 * importer replacement away from the editable main tree. It is promoted only
 * after the whole import succeeds; failures can delete it without touching the
 * user's current draft. Replacement branches never get a change request. */
export const createImportReplacementBranch = async (projectId: string, source: string, preserveExisting: boolean) => {
  const name = `import-${source}-${newId()}`;
  return prisma.$transaction(async (tx) => {
    await assertNoTrackedChangeRequests(tx, projectId);
    const branch = await tx.branch.create({ data: { projectId, name, isDefault: false } });
    if (preserveExisting) await forkDefaultBranch(tx, projectId, branch.id, false);
    return branch;
  });
};

/** Atomically replace main with a completed import branch and, when supplied,
 * apply the imported project chrome in the same commit. */
export const promoteImportReplacementBranch = async (projectId: string, id: string, projectConfig?: Prisma.InputJsonValue) => {
  const branch = await assertBranchInProject(projectId, id);
  if (branch.isDefault) throw conflict('The default branch cannot be promoted as an import replacement.');
  const main = await getDefaultBranch(projectId);
  await prisma.$transaction(async (tx) => {
    await assertNoTrackedChangeRequests(tx, projectId);
    await tx.page.deleteMany({ where: { projectId, branchId: main.id } });
    await tx.page.updateMany({ where: { projectId, branchId: branch.id }, data: { branchId: main.id } });
    await tx.branch.delete({ where: { id: branch.id } });
    if (projectConfig !== undefined) {
      await tx.project.update({ where: { id: projectId }, data: { config: projectConfig } });
    }
  });
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
