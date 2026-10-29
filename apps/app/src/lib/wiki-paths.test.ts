import { readdirSync, readFileSync } from 'node:fs';
import { isReservedWikiSlug, WIKI_SLUG_PATTERN } from '@nibleaf/shared/wiki-paths';
import { describe, expect, it } from 'vitest';

const routeTree = readFileSync(new URL('../routeTree.gen.ts', import.meta.url), 'utf8');

describe('reserved wiki slugs', () => {
  it('cover every top-level app route', () => {
    const fullPaths = routeTree.slice(routeTree.indexOf('fullPaths:'), routeTree.indexOf('fileRoutesByTo:'));
    const segments = new Set([...fullPaths.matchAll(/'\/([^/'$]+)/g)].map((match) => match[1] ?? ''));
    expect(segments.size).toBeGreaterThan(0);
    for (const segment of segments) {
      expect(isReservedWikiSlug(segment) || !WIKI_SLUG_PATTERN.test(segment), segment).toBe(true);
    }
  });

  it('leave root files unreachable as wiki slugs', () => {
    const files = [...readdirSync(new URL('../../public', import.meta.url)), 'robots.txt', 'sitemap.xml', 'llms.txt', 'llms-full.txt', '.well-known'];
    for (const file of files) expect(WIKI_SLUG_PATTERN.test(file), file).toBe(false);
  });
});
