import { beforeEach, describe, expect, it, vi } from 'vitest';

const findFirst = vi.hoisted(() => vi.fn());
vi.mock('@nibleaf/database', () => ({ prisma: { project: { findFirst } } }));

import { wikiSlugUnavailable } from './wiki-slugs';

/** A database where `p2` currently uses `handbook` and still redirects from `guide`. */
beforeEach(() => {
  findFirst
    .mockReset()
    .mockImplementation(async ({ where }: { where: { slug?: string; config?: { array_contains: string[] }; id?: { not: string } } }) => {
      const owner = where.slug === 'handbook' || where.config?.array_contains[0] === 'guide' ? 'p2' : null;
      return owner && where.id?.not !== owner ? { id: owner } : null;
    });
});

describe('wikiSlugUnavailable', () => {
  it('blocks app paths and other wikis’ previous slugs only under shared tenancy', async () => {
    expect(await wikiSlugUnavailable('app', 'shared')).toBe(true);
    expect(await wikiSlugUnavailable('guide', 'shared', 'p1')).toBe(true);
    expect(await wikiSlugUnavailable('app', 'independent')).toBe(false);
    expect(await wikiSlugUnavailable('guide', 'independent', 'p1')).toBe(false);
  });

  it('blocks a slug in use in both modes and lets a wiki reclaim its own', async () => {
    expect(await wikiSlugUnavailable('handbook', 'independent', 'p1')).toBe(true);
    expect(await wikiSlugUnavailable('handbook', 'shared')).toBe(true);
    expect(await wikiSlugUnavailable('guide', 'shared', 'p2')).toBe(false);
    expect(await wikiSlugUnavailable('fresh', 'shared', 'p1')).toBe(false);
  });
});
