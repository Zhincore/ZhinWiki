import { readdirSync, readFileSync } from 'node:fs';
import { isWikiPathSlug, WIKI_SLUG_PATTERN } from '@nibleaf/shared/wiki-paths';
import { describe, expect, it } from 'vitest';

const routeTree = readFileSync(new URL('../routeTree.gen.ts', import.meta.url), 'utf8');

describe('reserved wiki slugs', () => {
  it('cover every top-level app route', () => {
    const fullPaths = routeTree.slice(routeTree.indexOf('fullPaths:'), routeTree.indexOf('fileRoutesByTo:'));
    const segments = new Set([...fullPaths.matchAll(/'\/([^/'$]+)/g)].map((match) => match[1] ?? ''));
    expect(segments.size).toBeGreaterThan(0);
    for (const segment of segments) {
      expect(isWikiPathSlug(segment), segment).toBe(false);
    }
  });

  it('leave public root files unreachable as wiki slugs', () => {
    for (const file of readdirSync(new URL('../../public', import.meta.url))) expect(WIKI_SLUG_PATTERN.test(file), file).toBe(false);
  });
});
