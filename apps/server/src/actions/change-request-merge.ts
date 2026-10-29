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
};

/** Fields a merge copies from a change-request page onto the default branch. */
export type MergedFields = Pick<
  MergePage,
  'parentId' | 'kind' | 'title' | 'slug' | 'icon' | 'description' | 'content' | 'config' | 'translationKey' | 'position' | 'hidden'
>;

/** `{ [defaultBranchPageId]: content hash }` of the pages copied at fork time;
 *  null for change requests without fork tracking. */
export type ForkBase = Record<string, string> | null;

type MergeConflictReason = 'BOTH_CHANGED' | 'DELETED_ON_MAIN' | 'DELETED_IN_BRANCH';

/** `pageId` is the main page for BOTH_CHANGED / DELETED_IN_BRANCH and the
 *  change-request page for DELETED_ON_MAIN (its main page no longer exists). */
type MergeConflict = { pageId: string; title: string; path: string; languageId: string; reason: MergeConflictReason };

type PageChangeKind = 'added' | 'removed' | 'modified' | 'moved';

type RecordedPage = MergedFields & { path: string };

export type MergeRecordEntry = {
  pageId: string;
  languageId: string;
  action: PageChangeKind;
  before: RecordedPage | null;
  after: RecordedPage | null;
};

export type MergePlan =
  | { legacy: true; record: MergeRecordEntry[] }
  | {
      legacy: false;
      conflicts: MergeConflict[];
      /** True when a conflict is not covered by `force`; nothing is written. */
      blocked: boolean;
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

const same = (a: unknown, b: unknown) => JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));

const hash = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(normalize(value)))
    .digest('hex')
    .slice(0, 32);

/** Hash of the content group (kind, title, slug, icon, description, content,
 *  config, hidden, translationKey), which decides conflicts. */
export const contentHash = (page: Pick<MergePage, (typeof CONTENT_FIELDS)[number]>) => hash(CONTENT_FIELDS.map((field) => page[field]));
const treeHash = (parentKey: string | null, position: number) => hash([parentKey, position]);

/** `<content hash>.<tree hash>` of a page. The tree group (parent as a
 *  default-branch page id, position) is last-write-wins. */
export const pageFingerprint = (page: MergePage, parentKey: string | null) => `${contentHash(page)}.${treeHash(parentKey, page.position)}`;

const mergedFields = (page: MergePage): MergedFields => ({
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

const recorded = (page: MergePage): RecordedPage => ({ ...mergedFields(page), path: page.path });

const pick = <K extends keyof MergedFields>(page: MergedFields, keys: readonly K[]) =>
  Object.fromEntries(keys.map((key) => [key, page[key]])) as Pick<MergedFields, K>;

type MergeInput = { main: MergePage[]; branch: MergePage[]; forkBase: ForkBase };

type LegacyPair = { change: PageChangeKind; main: MergePage | undefined; copy: MergePage | undefined };

/** Untracked branches replace main wholesale; pages are paired by language
 *  and path only to describe the change. */
const legacyPairs = ({ main, branch }: MergeInput): LegacyPair[] => {
  const key = (page: MergePage) => `${page.languageId}\u0000${page.path}`;
  const mainByKey = new Map(main.map((page) => [key(page), page]));
  const matched = new Set<string>();
  const pairs = branch.flatMap((copy): LegacyPair[] => {
    const source = mainByKey.get(key(copy));
    if (!source) return [{ change: 'added', main: undefined, copy }];
    matched.add(source.id);
    const before = { ...mergedFields(source), parentId: null };
    const after = { ...mergedFields(copy), parentId: null };
    return same(before, after) ? [] : [{ change: 'modified', main: source, copy }];
  });
  return [...pairs, ...main.filter((page) => !matched.has(page.id)).map((page): LegacyPair => ({ change: 'removed', main: page, copy: undefined }))];
};

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
const deletedInBranch = ({ main, branch, forkBase }: MergeInput) => {
  const linked = new Set(branch.map((page) => page.sourcePageId));
  return main.filter((page) => forkBase?.[page.id] !== undefined && !linked.has(page.id));
};

export type PageChange = {
  change: PageChangeKind;
  mainPageId: string | null;
  branchPageId: string | null;
  title: string;
  path: string;
  languageId: string;
};

const pageChange = (change: PageChangeKind, main: MergePage | undefined, copy: MergePage | undefined): PageChange => {
  const page = copy ?? main;
  return {
    change,
    mainPageId: main?.id ?? null,
    branchPageId: copy?.id ?? null,
    title: page?.title ?? '',
    path: page?.path ?? '',
    languageId: page?.languageId ?? '',
  };
};

/** Pages a change request adds, removes, edits or moves relative to its fork point. */
export const summarizeChanges = (input: MergeInput): PageChange[] => {
  if (input.forkBase === null) return legacyPairs(input).map(({ change, main, copy }) => pageChange(change, main, copy));
  const changes = branchStates(input).flatMap(({ page, source, contentChanged, treeChanged }) => {
    if (!page.forkFingerprint) return [pageChange('added', undefined, page)];
    if (contentChanged) return [pageChange('modified', source, page)];
    return treeChanged && source ? [pageChange('moved', source, page)] : [];
  });
  return [...changes, ...deletedInBranch(input).map((page) => pageChange('removed', page, undefined))];
};

/**
 * Plan merging a change-request branch into the default branch. Pages are
 * matched through `sourcePageId`; `forkBase` tells pages deleted in the branch
 * apart from pages created on main after the fork, which are kept. `force`
 * lists the conflicting page ids the branch wins on; any other conflict blocks
 * the merge. Branches without fork tracking are merged by replacing main.
 */
export const planMerge = (input: MergeInput & { force: ReadonlySet<string> }): MergePlan => {
  if (input.forkBase === null) {
    const record = legacyPairs(input).map(
      ({ change, main, copy }): MergeRecordEntry => ({
        pageId: (copy ?? main)?.id ?? '',
        languageId: (copy ?? main)?.languageId ?? '',
        action: change,
        before: main ? recorded(main) : null,
        after: copy ? recorded(copy) : null,
      }),
    );
    return { legacy: true, record };
  }
  const { main, branch, forkBase, force } = input;
  const mainById = new Map(main.map((page) => [page.id, page]));
  const branchById = new Map(branch.map((page) => [page.id, page]));
  const conflicts: MergeConflict[] = [];
  const conflict = (page: MergePage, reason: MergeConflictReason) => {
    conflicts.push({ pageId: page.id, title: page.title, path: page.path, languageId: page.languageId, reason });
    return force.has(page.id);
  };
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
      if (contentChanged && conflict(page, 'DELETED_ON_MAIN')) inserted.add(page.id);
      continue;
    }
    if (!contentChanged && !treeChanged) continue;
    const forkContent = page.forkFingerprint.split('.')[0];
    const mainContent = contentHash(source);
    if (contentChanged && mainContent !== forkContent && mainContent !== contentHash(page) && !conflict(source, 'BOTH_CHANGED')) continue;
    updates.set(source.id, {
      ...(contentChanged ? pick(mergedFields(page), CONTENT_FIELDS) : {}),
      ...(treeChanged ? pick(mergedFields(page), TREE_FIELDS) : {}),
    });
  }

  for (const page of deletedInBranch(input)) {
    if (contentHash(page) !== forkBase[page.id] && !conflict(page, 'DELETED_IN_BRANCH')) continue;
    deletes.add(page.id);
  }

  if (conflicts.some((item) => !force.has(item.pageId))) {
    return { legacy: false, conflicts, blocked: true, inserts: [], updates: [], deletes: [], record: [] };
  }

  /** Default-branch id a change-request parent resolves to after the merge:
   *  the nearest branch ancestor that is inserted or still has its main page. */
  const mainParent = (branchParentId: string | null): string | null => {
    let parent = branchParentId ? branchById.get(branchParentId) : undefined;
    while (parent) {
      if (inserted.has(parent.id)) return parent.id;
      if (parent.sourcePageId && mainById.has(parent.sourcePageId)) return parent.sourcePageId;
      parent = parent.parentId ? branchById.get(parent.parentId) : undefined;
    }
    return null;
  };
  /** Nearest main ancestor that survives the merge. */
  const survivingParent = (parentId: string | null) => {
    let id = parentId;
    while (id && deletes.has(id)) id = mainById.get(id)?.parentId ?? null;
    return id;
  };

  const final = new Map<string, MergedFields & { id: string; languageId: string; path: string }>();
  for (const page of main) {
    if (!deletes.has(page.id)) final.set(page.id, { ...mergedFields(page), id: page.id, languageId: page.languageId, path: page.path });
  }
  const moved = new Set<string>();
  for (const [id, patch] of updates) {
    const current = final.get(id);
    if (!current) continue;
    if ('parentId' in patch) moved.add(id);
    const parentId = 'parentId' in patch ? mainParent(patch.parentId ?? null) : current.parentId;
    final.set(id, { ...current, ...patch, parentId });
  }
  for (const id of inserted) {
    const page = branchById.get(id);
    if (page) final.set(id, { ...mergedFields(page), parentId: mainParent(page.parentId), id, languageId: page.languageId, path: page.path });
  }
  for (const page of final.values()) page.parentId = survivingParent(page.parentId);

  // Moves on both sides can close a loop; a page the branch moved then keeps its main parent.
  const cycleThrough = (id: string) => {
    const path: string[] = [];
    for (let current: string | null = id; current; current = final.get(current)?.parentId ?? null) {
      const at = path.indexOf(current);
      if (at >= 0) return path.slice(at);
      path.push(current);
    }
    return null;
  };
  for (const id of final.keys()) {
    for (let cycle = cycleThrough(id); cycle; cycle = cycleThrough(id)) {
      const revert = cycle.find((member) => moved.has(member));
      const page = revert ? final.get(revert) : undefined;
      if (!revert || !page) throw new Error(`Merged page tree has a cycle through ${id}.`);
      moved.delete(revert);
      page.parentId = survivingParent(mainById.get(revert)?.parentId ?? null);
    }
  }

  const applied = new Set([...updates.keys(), ...inserted]);
  const siblingKey = (page: { languageId: string; parentId: string | null; slug: string }) =>
    `${page.languageId}\u0000${page.parentId ?? ''}\u0000${page.slug}`;
  // Pages the branch wrote or that land under a new parent yield their slug to pages already there.
  const placed = new Set([
    ...applied,
    ...[...final.values()].filter((page) => page.parentId !== mainById.get(page.id)?.parentId).map((page) => page.id),
  ]);
  const takenSlugs = new Set([...final.values()].filter((page) => !placed.has(page.id)).map(siblingKey));
  for (const id of placed) {
    const page = final.get(id);
    if (!page) continue;
    const base = page.slug;
    for (let suffix = 2; takenSlugs.has(siblingKey(page)); suffix += 1) page.slug = `${base}-${suffix}`;
    takenSlugs.add(siblingKey(page));
  }

  const pathOf = (id: string): string => {
    const page = final.get(id);
    if (!page) return '';
    return page.parentId ? joinPath(pathOf(page.parentId), page.slug) : page.slug;
  };

  const inserts: Extract<MergePlan, { legacy: false }>['inserts'] = [];
  const updateList: Extract<MergePlan, { legacy: false }>['updates'] = [];
  for (const page of final.values()) {
    const path = pathOf(page.id);
    const { id, languageId, path: _path, ...after } = page;
    if (inserted.has(id)) {
      inserts.push({ id, data: { ...after, path } });
      record.push({ pageId: id, languageId, action: 'added', before: null, after: { ...after, path } });
      continue;
    }
    const before = mainById.get(id);
    if (!before) continue;
    const changed = (Object.keys(after) as (keyof MergedFields)[]).filter((key) => !same(after[key], before[key]));
    if (changed.length === 0 && path === before.path) continue;
    updateList.push({ id, data: { ...pick(after, changed), ...(path === before.path ? {} : { path }) } });
    if (applied.has(id) || changed.length > 0) {
      const action = changed.every((key) => (TREE_FIELDS as readonly string[]).includes(key)) ? 'moved' : 'modified';
      record.push({ pageId: id, languageId, action, before: recorded(before), after: { ...after, path } });
    }
  }
  for (const id of deletes) {
    const before = mainById.get(id);
    if (before) record.push({ pageId: id, languageId: before.languageId, action: 'removed', before: recorded(before), after: null });
  }
  return { legacy: false, conflicts, blocked: false, inserts, updates: updateList, deletes: [...deletes], record };
};
