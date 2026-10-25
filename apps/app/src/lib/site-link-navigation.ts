import { useRouter } from '@tanstack/react-router';
import { useEffect } from 'react';
import { isAppOwnedPath, isDocumentPath } from '@/lib/request-negotiation';
import { isCustomDomainSite } from '@/lib/site-paths';

/**
 * The router href for a click on a link to another page of this published
 * site, or null when the browser should handle the click itself: modified or
 * non-primary clicks, `target`/`download` links, other origins, non-document
 * paths (files such as `.md` or `sitemap.xml`, exactly as the server classifies
 * them; page slugs never contain a dot), and in-page `#fragment` jumps.
 */
export function siteNavigationHref(
  event: MouseEvent,
  projectId: string,
  location: Pick<Location, 'href' | 'origin' | 'pathname' | 'search'>,
): string | null {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
  if (!(anchor instanceof HTMLAnchorElement) || (anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) return null;

  const url = new URL(anchor.href, location.href);
  if (url.origin !== location.origin || !isDocumentPath(url.pathname)) return null;
  if (url.hash && url.pathname === location.pathname && url.search === location.search) return null;

  const sitePrefix = `/sites/${projectId}`;
  const inSite = isCustomDomainSite(projectId)
    ? !isAppOwnedPath(url.pathname)
    : url.pathname === sitePrefix || url.pathname.startsWith(`${sitePrefix}/`);
  return inSite ? `${url.pathname}${url.search}${url.hash}` : null;
}

/** Route clicks on links between pages of a published site through the client
 * router instead of a full document load. Links stay plain `<a href>` so they
 * work without JavaScript and in server-rendered HTML. */
export function useSiteLinkNavigation(projectId: string): void {
  const router = useRouter();
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const href = siteNavigationHref(event, projectId, window.location);
      if (!href) return;
      event.preventDefault();
      void router.navigate({ href });
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [router, projectId]);
}
