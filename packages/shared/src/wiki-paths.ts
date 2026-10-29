/** Top-level dashboard, auth, legal and runtime pages the app serves at its root. */
export const DASHBOARD_ROOT_SEGMENTS = [
  'app',
  'sign-in',
  'sign-up',
  'forgot-password',
  'reset-password',
  'verify-email',
  'accept-invite',
  'git-preview',
  'brand-assets',
  'health',
  'terms',
  'privacy',
] as const;

/** Top-level paths the app runtime owns on every host, custom domains included. */
export const APP_OWNED_ROOT_SEGMENTS = ['api', 'assets', 'sites'] as const;

/** Wiki slugs: lowercase letters, digits and inner hyphens, at most 63 characters. Root files
 *  such as `robots.txt`, `favicon.ico` or `.well-known` can never match. */
export const WIKI_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

const RESERVED_WIKI_SLUGS: ReadonlySet<string> = new Set([...DASHBOARD_ROOT_SEGMENTS, ...APP_OWNED_ROOT_SEGMENTS]);

/** Whether a slug names an app path at the app root, so a wiki cannot be served at `/<slug>`. */
export const isReservedWikiSlug = (slug: string): boolean => RESERVED_WIKI_SLUGS.has(slug);

/** Previous slugs a wiki keeps for redirects: newest first, capped. */
export const MAX_PREVIOUS_WIKI_SLUGS = 10;

/** The `config.previousSlugs` list after a wiki moves from `from` to `to`. Reclaiming a
 *  remembered slug drops it from the list. */
export function nextPreviousSlugs(current: unknown, from: string, to: string): string[] {
  const kept = Array.isArray(current) ? current.filter((slug): slug is string => typeof slug === 'string' && slug !== from && slug !== to) : [];
  return [from, ...kept].slice(0, MAX_PREVIOUS_WIKI_SLUGS);
}

/** A project config without its slug history, which stays out of published snapshots and site shells. */
export function withoutSlugHistory<T extends Record<string, unknown> | null>(config: T): T {
  if (!config || !('previousSlugs' in config)) return config;
  const { previousSlugs: _history, ...rest } = config;
  return rest as T;
}
