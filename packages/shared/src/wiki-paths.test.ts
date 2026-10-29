import { describe, expect, it } from 'vitest';
import { MAX_PREVIOUS_WIKI_SLUGS, nextPreviousSlugs, withoutSlugHistory } from './wiki-paths';

describe('nextPreviousSlugs', () => {
  it('remembers the old slug first and drops the reclaimed one', () => {
    expect(nextPreviousSlugs(undefined, 'guide', 'handbook')).toEqual(['guide']);
    expect(nextPreviousSlugs(['manual', 'handbook'], 'guide', 'handbook')).toEqual(['guide', 'manual']);
    expect(nextPreviousSlugs(['guide', 7, null], 'guide', 'manual')).toEqual(['guide']);
  });

  it('caps the history, forgetting the oldest slug', () => {
    const history = Array.from({ length: MAX_PREVIOUS_WIKI_SLUGS }, (_, index) => `old-${index}`);
    const next = nextPreviousSlugs(history, 'current', 'renamed');
    expect(next).toHaveLength(MAX_PREVIOUS_WIKI_SLUGS);
    expect(next[0]).toBe('current');
    expect(next).not.toContain(`old-${MAX_PREVIOUS_WIKI_SLUGS - 1}`);
  });
});

describe('withoutSlugHistory', () => {
  it('keeps the slug history out of public config', () => {
    expect(withoutSlugHistory({ visibility: 'public', previousSlugs: ['guide'] })).toEqual({ visibility: 'public' });
    expect(withoutSlugHistory(null)).toBeNull();
  });
});
