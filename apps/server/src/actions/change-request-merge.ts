import { createHash } from 'node:crypto';
import { joinPath } from '@nibleaf/shared/utils';

/** The page columns a change-request merge reads. */
export type MergePage = {
  id: string;
  languageId: string;
  parentId: string | null;
  kind: 'PAGE' | 'GROUP';
  title: string;
  slug: string;
  path: string;
  icon: string | null;
  description: string | null;
  content: string;
  config: unknown;
  translationKey: string | null;
  position: number;
  hidden: boolean;
  sourcePageId: string | null;
  forkFingerprint: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/** Fields a merge copies from a change-request page onto the default branch. */
export type MergedFields = Pick<
  MergePage,
  'parentId' | 'kind' | 'title' | 'slug' | 'icon' | 'description' | 'content' | 'config' | 'translationKey' | 'position' | 'hidden'
>;

type MergeConflictReason = 'BOTH_CHANGED' | 'DELETED_ON_MAIN' | 'DELETED_IN_BRANCH';

/** `pageId` is the main page for BOTH_CHANGED / DELETED_IN_BRANCH and the
 *  change-request page for DELETED_ON_MAIN (its main page no longer exists). */
type MergeConflict = { pageId: string; title: string; path: string; languageId: string; reason: MergeConflictReason };

export type MergeRecordEntry = {
  pageId: string;
  languageId: string;
  action: 'added' | 'modified' | 'removed';
  before: MergedFields | null;
  after: MergedFields | null;
};

export type MergePlan =
  | { legacy: true }
  | {
      legacy: false;
      conflicts: MergeConflict[];
      /** Change-request rows moved onto the default branch, keeping their ids. */
      inserts: { id: string; data: Partial<MergedFields> & { path: string } }[];
      /** Default-branch rows rewritten in place (same id, so comments and grants stay). */
      updates: { id: string; data: Partial<MergedFields> & { path?: string } }[];
      deletes: string[];
      record: MergeRecordEntry[];
    };

const CONTENT_FIELDS = ['kind', 'title', 'slug', 'icon', 'description', 'content', 'config', 'hidden', 'translationKey'] as const;
const TREE_FIELDS = ['parentId', 'position'] as const;

const normalize = (value: unknown): unknown => {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, normalize((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
};

const hash = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(normalize(value)))
    .digest('hex')
    .slice(0, 32);

const contentHash = (page: MergePage) => hash(CONTENT_FIELDS.map((field) => page[field]));
const treeHash = (parentKey: string | null, position: number) => hash([parentKey, position]);

/** `<content hash>.<tree hash>` of a page. The content group (kind, title, slug,
 *  icon, description, content, config, hidden, translationKey) decides
 *  conflicts; the tree group (parent as a default-branch page id, position) is
 *  last-write-wins. */
export const pageFingerprint = (page: MergePage, parentKey: string | null) => `${contentHash(page)}.${treeHash(parentKey, page.position)}`;

export const mergedFields = (page: MergePage): MergedFields => ({
  parentId: page.parentId,
  kind: page.kind,
  title: page.title,
  slug: page.slug,
  icon: page.icon,
  description: page.description,
  content: page.content,
  config: page.config,
  translationKey: page.translationKey,
  position: page.position,
  hidden: page.hidden,
});

const pick = <K extends keyof MergedFields>(page: MergedFields, keys: readonly K[]) =>
  Object.fromEntries(keys.map((key) => [key, page[key]])) as Pick<MergedFields, K>;

type MergeInput = { main: MergePage[]; branch: MergePage[]; forkedAt: Date };

/** A branch with pages but no fork links, forked from a non-empty main,
 *  predates fork tracking. */
const isLegacyBranch = ({ main, branch, forkedAt }: MergeInput) =>
  branch.length > 0 && branch.every((page) => !page.forkFingerprint) && main.some((page) => page.createdAt < forkedAt);

type BranchPageState = { page: MergePage; source: MergePage | undefined; contentChanged: boolean; treeChanged: boolean };

/** How each change-request page relates to its fork point. Pages without a
 *  fingerprint were created in the branch. */
const branchStates = ({ main, branch }: MergeInput) => {
  const mainById = new Map(main.map((page) => [page.id, page]));
  const branchById = new Map(branch.map((page) => [page.id, page]));
  const parentKey = (page: MergePage) => {
    const parent = page.parentId ? branchById.get(page.parentId) : undefined;
    if (!parent) return null;
    return parent.sourcePageId && mainById.has(parent.sourcePageId) ? parent.sourcePageId : `branch:${parent.id}`;
  };
  return branch.map((page): BranchPageState => {
    const [forkContent, forkTree] = page.forkFingerprint?.split('.') ?? [];
    return {
      page,
      source: page.sourcePageId ? mainById.get(page.sourcePageId) : undefined,
      contentChanged: contentHash(page) !== forkContent,
      treeChanged: treeHash(parentKey(page), page.position) !== forkTree,
    };
  });
};

/** Forked default-branch pages whose change-request copy was deleted. */
const deletedInBranch = ({ main, branch, forkedAt }: MergeInput) => {
  const linked = new Set(branch.map((page) => page.sourcePageId));
  return main.filter((page) => page.createdAt < forkedAt && !linked.has(page.id));
};

export type PageChange = {
  change: 'added' | 'removed' | 'modified' | 'moved';
  mainPageId: string | null;
  branchPageId: string | null;
  title: string;
  languageId: string;
};

/** Pages a change request adds, removes, edits or moves relative to its fork point. */
export const summarizeChanges = (input: MergeInput): PageChange[] => {
  const change = (kind: PageChange['change'], main: MergePage | undefined, copy: MergePage | undefined): PageChange => ({
    change: kind,
    mainPageId: main?.id ?? null,
    branchPageId: copy?.id ?? null,
    title: (copy ?? main)?.title ?? '',
    languageId: (copy ?? main)?.languageId ?? '',
  });
  if (isLegacyBranch(input)) {
    return [
      ...input.branch.map((page) => change('added', undefined, page)),
      ...input.main.filter((page) => page.createdAt < input.forkedAt).map((page) => change('removed', page, undefined)),
    ];
  }
  const changes = branchStates(input).flatMap(({ page, source, contentChanged, treeChanged }) => {
    if (!page.forkFingerprint) return [change('added', undefined, page)];
    if (contentChanged) return [change('modified', source, page)];
    return treeChanged && source ? [change('moved', source, page)] : [];
  });
  return [...changes, ...deletedInBranch(input).map((page) => change('removed', page, undefined))];
};

/**
 * Plan merging a change-request branch into the default branch. Pages are
 * matched through `sourcePageId`; `forkedAt` (the branch creation time) tells
 * pages deleted in the branch apart from pages created on main after the fork,
 * which are kept. With `force`, the branch wins on every conflicting page.
 * Legacy branches are merged by replacing main.
 */
export const planMerge = (input: MergeInput & { force: boolean }): MergePlan => {
  if (isLegacyBranch(input)) return { legacy: true };
  const { main, branch, forkedAt, force } = input;
  const mainById = new Map(main.map((page) => [page.id, page]));
  const branchById = new Map(branch.map((page) => [page.id, page]));
  const conflicts: MergeConflict[] = [];
  const inserted = new Set<string>();
  const updates = new Map<string, Partial<MergedFields>>();
  const deletes = new Set<string>();
  const record: MergeRecordEntry[] = [];

  for (const { page, source, contentChanged, treeChanged } of branchStates(input)) {
    if (!page.forkFingerprint) {
      inserted.add(page.id);
      continue;
    }
    if (!source) {
      if (!contentChanged) continue;
      if (force) inserted.add(page.id);
      else conflicts.push({ pageId: page.id, title: page.title, path: page.path, languageId: page.languageId, reason: 'DELETED_ON_MAIN' });
      continue;
    }
    if (!contentChanged && !treeChanged) continue;
    const forkContent = page.forkFingerprint.split('.')[0];
    const mainContent = contentHash(source);
    if (contentChanged && mainContent !== forkContent && mainContent !== contentHash(page)) {
      conflicts.push({ pageId: source.id, title: source.title, path: source.path, languageId: source.languageId, reason: 'BOTH_CHANGED' });
      if (!force) continue;
    }
    updates.set(source.id, {
      ...(contentChanged ? pick(mergedFields(page), CONTENT_FIELDS) : {}),
      ...(treeChanged ? pick(mergedFields(page), TREE_FIELDS) : {}),
    });
  }

  for (const page of deletedInBranch(input)) {
    if (page.updatedAt > forkedAt) {
      conflicts.push({ pageId: page.id, title: page.title, path: page.path, languageId: page.languageId, reason: 'DELETED_IN_BRANCH' });
      if (!force) continue;
    }
    deletes.add(page.id);
  }

  if (conflicts.length > 0 && !force) {
    return { legacy: false, conflicts, inserts: [], updates: [], deletes: [], record: [] };
  }

  /** Default-branch id a change-request parent resolves to after the merge. */
  const mainParent = (branchParentId: string | null): string | null => {
    const parent = branchParentId ? branchById.get(branchParentId) : undefined;
    if (!parent) return null;
    if (inserted.has(parent.id)) return parent.id;
    return parent.sourcePageId && mainById.has(parent.sourcePageId) && !deletes.has(parent.sourcePageId) ? parent.sourcePageId : null;
  };

  const final = new Map<string, MergedFields & { id: string; languageId: string; path: string }>();
  for (const page of main) {
    if (!deletes.has(page.id)) final.set(page.id, { ...mergedFields(page), id: page.id, languageId: page.languageId, path: page.path });
  }
  for (const [id, patch] of updates) {
    const current = final.get(id);
    if (!current) continue;
    const parentId = 'parentId' in patch ? mainParent(patch.parentId ?? null) : current.parentId;
    final.set(id, { ...current, ...patch, parentId });
  }
  for (const id of inserted) {
    const page = branchById.get(id);
    if (page) final.set(id, { ...mergedFields(page), parentId: mainParent(page.parentId), id, languageId: page.languageId, path: page.path });
  }
  // A kept page under a deleted parent moves to its nearest surviving ancestor.
  for (const page of final.values()) {
    let parentId = page.parentId;
    while (parentId && deletes.has(parentId)) parentId = mainById.get(parentId)?.parentId ?? null;
    page.parentId = parentId;
  }

  const applied = new Set([...updates.keys(), ...inserted]);
  const siblingKey = (page: { languageId: string; parentId: string | null; slug: string }) =>
    `${page.languageId}\u0000${page.parentId ?? ''}\u0000${page.slug}`;
  const takenSlugs = new Set([...final.values()].filter((page) => !applied.has(page.id)).map(siblingKey));
  for (const id of applied) {
    const page = final.get(id);
    if (!page) continue;
    const base = page.slug;
    for (let suffix = 2; takenSlugs.has(siblingKey(page)); suffix += 1) page.slug = `${base}-${suffix}`;
    takenSlugs.add(siblingKey(page));
  }

  const pathOf = (id: string, seen = new Set<string>()): string => {
    const page = final.get(id);
    if (!page || seen.has(id)) return '';
    seen.add(id);
    return page.parentId ? joinPath(pathOf(page.parentId, seen), page.slug) : page.slug;
  };

  const inserts: Extract<MergePlan, { legacy: false }>['inserts'] = [];
  const updateList: Extract<MergePlan, { legacy: false }>['updates'] = [];
  for (const page of final.values()) {
    const path = pathOf(page.id);
    const { id, languageId, path: _path, ...after } = page;
    if (inserted.has(id)) {
      inserts.push({ id, data: { ...after, path } });
      record.push({ pageId: id, languageId, action: 'added', before: null, after });
      continue;
    }
    const before = mainById.get(id);
    if (!before) continue;
    const changed = (Object.keys(after) as (keyof MergedFields)[]).filter(
      (key) => JSON.stringify(normalize(after[key])) !== JSON.stringify(normalize(before[key])),
    );
    if (changed.length === 0 && path === before.path) continue;
    updateList.push({ id, data: { ...pick(after, changed), ...(path === before.path ? {} : { path }) } });
    if (applied.has(id) || changed.length > 0) {
      record.push({ pageId: id, languageId, action: 'modified', before: mergedFields(before), after });
    }
  }
  for (const id of deletes) {
    const before = mainById.get(id);
    if (before) record.push({ pageId: id, languageId: before.languageId, action: 'removed', before: mergedFields(before), after: null });
  }
  return { legacy: false, conflicts, inserts, updates: updateList, deletes: [...deletes], record };
};
