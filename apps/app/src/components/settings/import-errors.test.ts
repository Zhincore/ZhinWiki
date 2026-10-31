import { describe, expect, it } from 'vitest';
import { ApiResponseError } from '@/hooks/api/client-helpers';
import { importFailureMessage, importMayStillRun } from './import-errors';

describe('uncertain import outcomes', () => {
  it.each([502, 503, 504, 408])('warns after HTTP %s', (status) => {
    expect(importMayStillRun(new ApiResponseError('proxy', status))).toBe(true);
  });
  it('warns after network failures and invalid proxy responses', () => {
    expect(importMayStillRun(new TypeError('fetch failed'))).toBe(true);
    expect(importMayStillRun(new SyntaxError('Unexpected token'))).toBe(true);
  });
  it.each([400, 401, 403, 409, 422, 429, 500])('keeps a definite HTTP %s error', (status) => {
    expect(importMayStillRun(new ApiResponseError('rejected', status))).toBe(false);
  });
});

it.each([408, 500, 502, 503, 504])('keeps an application error envelope with status %s definite', (status) => {
  expect(importMayStillRun(new ApiResponseError('failed', status, 'http:internal'))).toBe(false);
});

describe('importFailureMessage', () => {
  const t = ((key: string, variables?: Record<string, unknown>) => (variables ? `${key} ${JSON.stringify(variables)}` : key)) as Parameters<
    typeof importFailureMessage
  >[0];

  it.each([
    ['import:in_progress', 'settings.import.inProgress'],
    ['import:busy', 'settings.import.busy'],
    ['import:conflict', 'settings.import.conflict'],
    ['import:limit', 'settings.import.limit'],
  ])('translates %s', (code, key) => {
    expect(importFailureMessage(t, { code, message: 'English' })).toBe(key);
  });

  it('names the exceeded limit and the missing source', () => {
    expect(importFailureMessage(t, { code: 'import:limit', details: { limit: 1000 }, message: 'English' })).toBe(
      'settings.import.nodeLimit {"limit":1000}',
    );
    expect(importFailureMessage(t, { code: 'import:incomplete', details: { path: 'a.md', sourceFile: 'SUMMARY.md' }, message: 'English' })).toBe(
      'settings.import.incomplete (SUMMARY.md: a.md)',
    );
  });

  it.each([null, undefined, 'import:not_found'])('keeps the server message for code %s', (code) => {
    expect(importFailureMessage(t, { code, message: 'English' })).toBe('English');
  });
});
