import { ApiResponseError } from '@/hooks/api/client-helpers';
import type { MergeConflict } from '@/hooks/api/types';

/** The conflicting pages of a refused merge (409 `details.conflicts`), or null for any other error. */
export function conflictsFromError(error: unknown): MergeConflict[] | null {
  if (!(error instanceof ApiResponseError) || error.status !== 409) return null;
  const conflicts = error.details?.conflicts;
  return Array.isArray(conflicts) ? (conflicts as MergeConflict[]) : null;
}

/** Pages the change request wins on: the picked ids that are still conflicts. */
export function forceList(conflicts: readonly MergeConflict[], picked: ReadonlySet<string>): string[] {
  return conflicts.filter((conflict) => picked.has(conflict.pageId)).map((conflict) => conflict.pageId);
}
