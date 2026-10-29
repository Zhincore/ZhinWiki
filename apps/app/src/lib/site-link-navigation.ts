import { useRouter } from '@tanstack/react-router';
import { useEffect } from 'react';
import type { NavNode, SiteShell } from '@/hooks/api/types';
import { isAppOwnedPath, isDocumentPath } from '@/lib/request-negotiation';
import { siteBasePath } from '@/lib/site-paths';

/** The decoded first segment of a pathname (`''` at the root). */
const rootSegment = (pathname: string): string => {
  const segment = pathname.split('/')[1] ?? '';
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

/**
 * The router href for a click on a link to another page of this published
 * site, or null when the browser should handle the click itself: modified or
 * non-primary clicks, `target`/`download` links, other origins, non-document
 * paths (files such as `.md` or `sitemap.xml`, exactly as the server classifies
 * them; page slugs never contain a dot), and in-page `#fragment` jumps. At a
 * root base, `ownsRootSegment` (when given) limits routing to first segments the
 * site is known to own; other wikis' `/<slug>` paths load as documents.
 */
export function siteNavigationHref(
  event: MouseEvent,
  projectId: string,
  location: Pick<Location, 'href' | 'origin' | 'pathname' | 'search'>,
  ownsRootSegment?: (segment: string) => boolean,
): string | null {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
  if (!(anchor instanceof HTMLAnchorElement) || (anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) return null;

  const url = new URL(anchor.href, location.href);
  if (url.origin !== location.origin || !isDocumentPath(url.pathname)) return null;
  if (url.hash && url.pathname === location.pathname && url.search === location.search) return null;

  const base = siteBasePath(projectId);
  const inSite = base
    ? url.pathname === base || url.pathname.startsWith(`${base}/`)
    : !isAppOwnedPath(url.pathname) && (!ownsRootSegment || ownsRootSegment(rootSegment(url.pathname)));
  return inSite ? `${url.pathname}${url.search}${url.hash}` : null;
}

/** First path segments a published site is known to own: its navigation,
 *  versions, API reference and changelog. */
export function siteRootSegments(site: Pick<SiteShell, 'nav' | 'versions' | 'openapi'>): Set<string> {
  const segments = new Set(['', 'changelog', ...site.versions.map((version) => version.slug)]);
  const visit = (nodes: NavNode[]) => {
    for (const node of nodes) {
      segments.add(node.path.split('/').find(Boolean) ?? '');
      visit(node.children);
    }
  };
  visit(site.nav);
  if (site.openapi) segments.add(site.openapi.path.split('/').find(Boolean) ?? '');
  return segments;
}

/** Route clicks on links between pages of a published site through the client
 * router instead of a full document load. Links stay plain `<a href>` so they
 * work without JavaScript and in server-rendered HTML. */
export function useSiteLinkNavigation(projectId: string, ownsRootSegment?: (segment: string) => boolean): void {
  const router = useRouter();
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const href = siteNavigationHref(event, projectId, window.location, ownsRootSegment);
      if (!href) return;
      event.preventDefault();
      void router.navigate({ href });
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [router, projectId, ownsRootSegment]);
}
