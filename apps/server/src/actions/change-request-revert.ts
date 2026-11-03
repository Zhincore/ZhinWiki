import { joinPath } from '@nibleaf/shared/utils';
import type { MergedFields, MergePage, MergeRecordEntry } from './change-request-merge';

/** Why a page of the reverted change request did not get back where it was:
 *  its former parent is gone (it lands at the root), or its language is gone
 *  (it is not restored). */
type RevertWarningReason = 'PARENT_UNAVAILABLE' | 'LANGUAGE_MISSING';

export type RevertWarning = { pageId: string; title: string; path: string; reason: RevertWarningReason };

type PlannedPage = MergedFields & { id: string; languageId: string; path: string };

export type RevertPlan = {
  /** Pages re-created from their pre-merge state, parents before children. */
  creates: PlannedPage[];
  /** Existing branch rows rewritten (only the fields that change). */
  updates: { id: string; data: Partial<MergedFields> & { path?: string } }[];
  deletes: string[];
  warnings: RevertWarning[];
};

const FIELDS = ['parentId', 'kind', 'title', 'slug', 'icon', 'description', 'content', 'config', 'translationKey', 'position', 'hidden'] as const;

const fieldsOf = (page: MergedFields): MergedFields => Object.fromEntries(FIELDS.map((key) => [key, page[key]])) as MergedFields;

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Plan restoring the pages a merged change request touched to their state
 * before its merge, on a fresh fork of the default branch (`branch`, whose
 * copies link their default-branch page through `sourcePageId`). Pages the
 * merge added are deleted, removed ones re-created, edited or moved ones get
 * their former fields, position and parent back. Later edits on main to those
 * pages are overwritten, so the new change request's diff shows them. A former
 * parent missing by id is looked up by its former path; one that no longer
 * exists puts the page at the root, with a warning.
 */
export const planRevert = (input: {
  record: readonly MergeRecordEntry[];
  branch: readonly MergePage[];
  languageIds: ReadonlySet<string>;
  newId: () => string;
}): RevertPlan => {
  const original = new Map(input.branch.map((page) => [page.id, page]));
  const pages = new Map<string, PlannedPage>(
    input.branch.map((page) => [page.id, { ...fieldsOf(page), id: page.id, languageId: page.languageId, path: page.path }]),
  );
  /** Default-branch id (as recorded at merge time) → id in the revert branch. */
  const branchIdOf = new Map(input.branch.flatMap((page) => (page.sourcePageId ? [[page.sourcePageId, page.id] as const] : [])));
  const warnings: RevertWarning[] = [];
  const warn = (entry: MergeRecordEntry, reason: RevertWarningReason) => {
    const page = entry.before ?? entry.after;
    warnings.push({ pageId: entry.pageId, title: page?.title ?? '', path: page?.path ?? '', reason });
  };
  const created = new Set<string>();
  const restored: { id: string; entry: MergeRecordEntry }[] = [];
  const deletes = new Set<string>();

  for (const entry of input.record) {
    const existing = branchIdOf.get(entry.pageId);
    if (!entry.before) {
      if (existing) deletes.add(existing);
      continue;
    }
    if (existing) {
      restored.push({ id: existing, entry });
      continue;
    }
    if (!input.languageIds.has(entry.languageId)) {
      warn(entry, 'LANGUAGE_MISSING');
      continue;
    }
    const id = input.newId();
    branchIdOf.set(entry.pageId, id);
    created.add(id);
    restored.push({ id, entry });
  }

  /** Nearest ancestor that the revert keeps. */
  const survivingParent = (parentId: string | null) => {
    let id = parentId;
    while (id && deletes.has(id)) id = pages.get(id)?.parentId ?? null;
    return id;
  };

  /** Page at each path once the revert applies: pages it leaves in place keep
   *  theirs, restored pages take their former one where it is free. */
  const pathKey = (languageId: string, path: string) => `${languageId}\u0000${path}`;
  const restoredIds = new Set(restored.map(({ id }) => id));
  const revertedAt = new Map(
    input.branch.filter((page) => !restoredIds.has(page.id) && !deletes.has(page.id)).map((page) => [pathKey(page.languageId, page.path), page.id]),
  );
  for (const { id, entry } of restored) {
    const key = entry.before && pathKey(entry.languageId, entry.before.path);
    if (key && !revertedAt.has(key)) revertedAt.set(key, id);
  }
  /** The page at the former parent's path after the revert, for parents whose id is gone (e.g. replaced by a whole-wiki merge). */
  const pageAtParentPath = (languageId: string, path: string) => {
    const cut = path.lastIndexOf('/');
    return cut > 0 ? revertedAt.get(pathKey(languageId, path.slice(0, cut))) : undefined;
  };

  const placed = new Set<string>();
  for (const { id, entry } of restored) {
    const before = entry.before;
    if (!before) continue;
    const wanted = before.parentId ? (branchIdOf.get(before.parentId) ?? pageAtParentPath(entry.languageId, before.path)) : null;
    if (wanted === undefined) warn(entry, 'PARENT_UNAVAILABLE');
    pages.set(id, { ...fieldsOf(before), parentId: wanted ?? null, id, languageId: entry.languageId, path: before.path });
    placed.add(id);
  }
  for (const page of pages.values()) {
    if (deletes.has(page.id)) continue;
    const parentId = survivingParent(page.parentId);
    if (parentId !== page.parentId) {
      page.parentId = parentId;
      placed.add(page.id);
    }
  }
  for (const id of deletes) pages.delete(id);

  // Restoring a parent can close a loop with moves made on main since; the restored page then goes to the root.
  const entryOf = new Map(restored.map(({ id, entry }) => [id, entry]));
  for (const start of pages.keys()) {
    const seen: string[] = [];
    for (let id: string | null = start; id; id = pages.get(id)?.parentId ?? null) {
      const at = seen.indexOf(id);
      if (at < 0) {
        seen.push(id);
        continue;
      }
      const member = seen.slice(at).find((candidate) => entryOf.has(candidate)) ?? id;
      const page = pages.get(member);
      const entry = entryOf.get(member);
      if (page) page.parentId = null;
      placed.add(member);
      if (entry) warn(entry, 'PARENT_UNAVAILABLE');
      break;
    }
  }

  // Pages the revert wrote or moved yield their slug to siblings already there.
  const siblingKey = (page: PlannedPage) => `${page.languageId}\u0000${page.parentId ?? ''}\u0000${page.slug}`;
  const taken = new Set([...pages.values()].filter((page) => !placed.has(page.id)).map(siblingKey));
  for (const id of placed) {
    const page = pages.get(id);
    if (!page) continue;
    const base = page.slug;
    for (let suffix = 2; taken.has(siblingKey(page)); suffix += 1) page.slug = `${base}-${suffix}`;
    taken.add(siblingKey(page));
  }

  const pathOf = (id: string, seen = new Set<string>()): string => {
    const page = pages.get(id);
    if (!page || seen.has(id)) return '';
    seen.add(id);
    return page.parentId ? joinPath(pathOf(page.parentId, seen), page.slug) : page.slug;
  };
  for (const page of pages.values()) page.path = pathOf(page.id);

  const creates: PlannedPage[] = [];
  const emitted = new Set<string>();
  const emit = (id: string) => {
    const page = pages.get(id);
    if (!page || emitted.has(id) || !created.has(id)) return;
    emitted.add(id);
    if (page.parentId) emit(page.parentId);
    creates.push(page);
  };
  for (const id of created) emit(id);

  const updates: RevertPlan['updates'] = [];
  for (const page of pages.values()) {
    const before = original.get(page.id);
    if (!before) continue;
    const changed = FIELDS.filter((key) => !same(page[key], before[key]));
    if (changed.length === 0 && page.path === before.path) continue;
    updates.push({
      id: page.id,
      data: { ...Object.fromEntries(changed.map((key) => [key, page[key]])), ...(page.path === before.path ? {} : { path: page.path }) },
    });
  }
  return { creates, updates, deletes: [...deletes], warnings };
};
