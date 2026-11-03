import { prisma } from '@nibleaf/database';
import { isWikiPathSlug } from '@nibleaf/shared/wiki-paths';
import { env } from '@/env';
import { TtlCache } from '@/lib/lru';
import { publishedProjectWhere } from './sites';

/** A public, published wiki as listed on the instance homepage. */
interface WikiDirectoryEntry {
  id: string;
  name: string;
  description: string | null;
  /** Emoji icon of the wiki. */
  icon: string | null;
  /** Branding image: favicon, else the light or dark logo. */
  logo: string | null;
  url: string;
}

/** Upper bound on listed wikis. */
export const WIKI_DIRECTORY_LIMIT = 500;

type Branding = { favicon?: unknown; logoLight?: unknown; logoDark?: unknown };

const PICTOGRAPHIC = /\p{Extended_Pictographic}/u;

const directoryCache = new TtlCache<'all', WikiDirectoryEntry[]>(1, 15_000);

const imageUrl = (...candidates: unknown[]): string | null =>
  (candidates.find((value) => typeof value === 'string' && value.trim()) as string | undefined)?.trim() ?? null;

/** Public URL with the edge's precedence: primary domain, slug subdomain, `/<slug>`, `/sites/<id>`. */
const wikiPublicUrl = (project: { id: string; slug: string; primaryDomain: string | null }): string => {
  if (project.primaryDomain) return `https://${project.primaryDomain.toLowerCase()}`;
  const baseDomain = env.SITE_BASE_DOMAIN?.trim().replace(/^\*\./, '').replace(/\.$/, '');
  if (baseDomain) return `https://${project.slug}.${baseDomain}`;
  const appUrl = env.APP_URL.replace(/\/$/, '');
  return isWikiPathSlug(project.slug) ? `${appUrl}/${project.slug}` : `${appUrl}/sites/${project.id}`;
};

/** Every public, published, not taken-down wiki by name (shared tenancy only; null otherwise).
 *  Name, description and icon come from the project row, which the site shell overlays on its snapshot. */
export const listWikiDirectory = async (): Promise<WikiDirectoryEntry[] | null> => {
  if (env.TENANCY !== 'shared') return null;
  const cached = directoryCache.get('all');
  if (cached) return cached;
  const projects = await prisma.project.findMany({
    where: { ...publishedProjectWhere, accessMode: 'PUBLIC' },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: WIKI_DIRECTORY_LIMIT,
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      icon: true,
      config: true,
      domains: {
        where: { verified: true, isPrimary: true },
        orderBy: [{ verifiedAt: 'asc' }, { createdAt: 'asc' }],
        take: 1,
        select: { domain: true },
      },
    },
  });
  const wikis = projects.map((project): WikiDirectoryEntry => {
    const branding = ((project.config as { branding?: Branding } | null)?.branding ?? {}) as Branding;
    return {
      id: project.id,
      name: project.name,
      description: project.description?.trim() || null,
      icon: project.icon && PICTOGRAPHIC.test(project.icon) ? project.icon.trim() : null,
      logo: imageUrl(branding.favicon, branding.logoLight, branding.logoDark),
      url: wikiPublicUrl({ id: project.id, slug: project.slug, primaryDomain: project.domains[0]?.domain ?? null }),
    };
  });
  directoryCache.set('all', wikis);
  return wikis;
};
