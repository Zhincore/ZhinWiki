import { prisma } from '@nibleaf/database';
import type { Tenancy } from '@nibleaf/shared/rbac';
import { isReservedWikiSlug } from '@nibleaf/shared/wiki-paths';

/**
 * Whether a wiki may not take `slug`: another wiki uses it, or, under shared
 * tenancy (wikis served at `/<slug>`), it names an app path or another wiki
 * still redirects from it. `projectId` is the wiki taking the slug, which may
 * reclaim its own previous slug.
 */
export async function wikiSlugUnavailable(slug: string, tenancy: Tenancy, projectId?: string): Promise<boolean> {
  if (tenancy === 'shared' && isReservedWikiSlug(slug)) return true;
  const others = projectId ? { id: { not: projectId } } : {};
  const current = await prisma.project.findFirst({ where: { slug, ...others }, select: { id: true } });
  if (current || tenancy !== 'shared') return Boolean(current);
  const previous = await prisma.project.findFirst({
    where: { config: { path: ['previousSlugs'], array_contains: [slug] }, ...others },
    select: { id: true },
  });
  return Boolean(previous);
}
