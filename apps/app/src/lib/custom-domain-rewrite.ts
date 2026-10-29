/**
 * TanStack Router must match the same internal `/sites/:projectId` route in the
 * browser that the server entry used for custom-domain, home-wiki or `/<slug>`
 * SSR. These helpers keep that internal route invisible in the address bar.
 * `basePath` is the public prefix: `''` at a domain root, `/<slug>` on the app origin.
 */
const underBase = (pathname: string, basePath: string): boolean => !basePath || pathname === basePath || pathname.startsWith(`${basePath}/`);

export function rewriteSiteInput(url: URL, projectId: string, basePath = ''): URL {
  const prefix = `/sites/${projectId}`;
  if (url.pathname === prefix || url.pathname.startsWith(`${prefix}/`) || !underBase(url.pathname, basePath)) return url;
  const next = new URL(url);
  const rest = next.pathname.slice(basePath.length) || '/';
  next.pathname = `${prefix}${rest === '/' ? '' : rest}`;
  return next;
}

export function rewriteSiteOutput(url: URL, projectId: string, basePath = ''): URL {
  const next = new URL(url);
  const prefix = `/sites/${projectId}`;
  if (next.pathname === prefix) {
    next.pathname = basePath || '/';
  } else if (next.pathname.startsWith(`${prefix}/`)) {
    next.pathname = `${basePath}${next.pathname.slice(prefix.length)}`;
  }
  return next;
}

/** Read the SSR markers before router hydration: the site's project and its
 * public base path. Internal `/sites/:id` previews deliberately do not opt in,
 * even though they render the same markers. */
export function hydratedSiteDocument(): { projectId: string; basePath: string } | undefined {
  if (typeof document === 'undefined' || typeof window === 'undefined') return undefined;
  if (window.location.pathname.startsWith('/sites/')) return undefined;
  const projectId = document.querySelector<HTMLMetaElement>('meta[name="nibleaf-site-project"]')?.content;
  if (!projectId) return undefined;
  return { projectId, basePath: document.querySelector<HTMLMetaElement>(`meta[name="${SITE_BASE_META}"]`)?.content ?? '' };
}

/** `<meta name>` carrying a `/<slug>` site's public base path. */
export const SITE_BASE_META = 'nibleaf-site-base';
