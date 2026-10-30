import { describe, expect, it } from 'vitest';
import { ApiResponseError } from '@/hooks/api/client-helpers';
import type { MergeConflict } from '@/hooks/api/types';
import { conflictsFromError, forceList } from './merge-conflicts';

const conflict = (pageId: string): MergeConflict => ({ pageId, title: pageId, path: pageId, languageId: 'en', reason: 'BOTH_CHANGED' });

describe('conflictsFromError', () => {
  it('reads the conflicts of a refused merge', () => {
    const error = new ApiResponseError('Conflicts', 409, 'database:conflict', undefined, { conflicts: [conflict('a')] });
    expect(conflictsFromError(error)).toEqual([conflict('a')]);
  });

  it('ignores other conflicts and errors', () => {
    expect(conflictsFromError(new ApiResponseError('Already merged', 409, 'database:conflict'))).toBeNull();
    expect(conflictsFromError(new ApiResponseError('Oops', 500, undefined, undefined, { conflicts: [conflict('a')] }))).toBeNull();
    expect(conflictsFromError(new Error('network'))).toBeNull();
  });
});

describe('forceList', () => {
  it('forces only picked pages that still conflict', () => {
    expect(forceList([conflict('a'), conflict('b')], new Set(['b', 'stale']))).toEqual(['b']);
  });
});
