import type { SiteSnapshot } from '@nibleaf/shared/site';
import { describe, expect, it } from 'vitest';
import { resolvePublishedSearchContext, resolvePublishedSearchLanguages, resolvePublishedSearchRequest } from './search-configuration';

const snapshot = (search: Record<string, unknown>): SiteSnapshot => ({
  project: {
    id: 'project-1',
    name: 'Docs',
    slug: 'docs',
    description: null,
    icon: null,
    config: { search },
    languages: [
      { code: 'en', label: 'English', direction: 'LTR', isDefault: true, enabled: true, config: null },
      { code: 'ar', label: 'Arabic', direction: 'RTL', isDefault: false, enabled: true, config: null },
    ],
  },
  pages: [],
  generatedAt: '2026-08-23T00:00:00.000Z',
});

describe('published search configuration', () => {
  it('defaults malformed legacy config and caps caller result limits', () => {
    expect(resolvePublishedSearchRequest({ search: { maxResults: 'all' } }, { language: 'ar', limit: 50 })).toMatchObject({
      language: 'ar',
      limit: 12,
      configuration: { maxResults: 12, filtersEnabled: true },
    });
    expect(resolvePublishedSearchRequest({ search: { maxResults: 20 } }, { limit: 5 }).limit).toBe(5);
  });

  it.each([{ filtersEnabled: false }, { filtersEnabled: true }])(
    'preserves the active language when selector visibility is $filtersEnabled',
    (visibility) => {
      expect(resolvePublishedSearchRequest({ search: { ...visibility, maxResults: 7 } }, { language: 'ar', limit: 40 })).toMatchObject({
        language: 'ar',
        limit: 7,
      });
    },
  );

  it.each([
    ['keyword', { filtersEnabled: false }],
    ['answer', { filtersEnabled: true, aiAnswers: true }],
  ])('%s action context keeps Arabic when its selector is hidden', (_path, search) => {
    expect(resolvePublishedSearchContext(snapshot(search), { language: 'ar' })).toMatchObject({ language: 'ar' });
  });

  it('falls back an unknown language to the published default', () => {
    expect(resolvePublishedSearchContext(snapshot({}), { language: 'unknown' })).toMatchObject({ language: 'en' });
  });

  it('searches every enabled published language when no language is requested', () => {
    expect(resolvePublishedSearchLanguages(snapshot({}))).toEqual(['en', 'ar']);
  });

  it('keeps the backwards-compatible single-language API scope when requested', () => {
    expect(resolvePublishedSearchLanguages(snapshot({}), 'ar')).toEqual(['ar']);
    expect(resolvePublishedSearchLanguages(snapshot({}), 'unknown')).toEqual(['en']);
  });
});
