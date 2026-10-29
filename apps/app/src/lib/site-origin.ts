import { createIsomorphicFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { SITE_BASE_META } from '@/lib/custom-domain-rewrite';
import { type Homepage, parseHomepage } from '@/lib/homepage';

/** Marker the server entry sets on a home-site request it rewrote onto `/sites/:id`. */
export const HOME_SITE_HEADER = 'x-nibleaf-home-site';

const WELCOME: Homepage = { mode: 'welcome' };

/**
 * The `HOMEPAGE` mode of the current document. The server reads the env (a
 * custom-domain request is always `welcome`), the root route mirrors a
 * non-default mode into a `nibleaf-homepage` meta tag, and the client reads it.
 */
export const currentHomepage = createIsomorphicFn()
  .client((): Homepage => {
    try {
      return parseHomepage(document.querySelector<HTMLMetaElement>('meta[name="nibleaf-homepage"]')?.content);
    } catch {
      return WELCOME;
    }
  })
  .server((): Homepage => {
    let headers: Headers | undefined;
    try {
      headers = getRequest()?.headers;
    } catch {
      headers = undefined;
    }
    if (headers?.has('x-nibleaf-site-origin') && !headers.has(HOME_SITE_HEADER)) return WELCOME;
    return parseHomepage(process.env.HOMEPAGE);
  });

/**
 * The public base URL the server entry (src/server.ts) stamped on a rewritten
 * request: a custom domain or home-wiki origin (e.g. "https://docs.acme.com"),
 * or a shared-tenancy wiki's app-origin path ("https://wiki.example.com/guide").
 * Returns undefined for internal `/sites/:id` requests and on the client (where
 * window.location already is the right origin). Used so SSR canonical / og:url /
 * hreflang point at the public base instead of the internal /sites/:id path.
 *
 * Built with createIsomorphicFn so the server-only `getRequest` import is kept
 * out of the client bundle (TanStack Start's import-protection plugin).
 */
export const customDomainOrigin = createIsomorphicFn()
  .client((): string | undefined => undefined)
  .server((): string | undefined => {
    try {
      return getRequest()?.headers.get('x-nibleaf-site-origin') ?? undefined;
    } catch {
      return undefined;
    }
  });

/** The `/<slug>` path a shared-tenancy wiki document is served under: the path of
 *  the stamped base URL on the server, the root route's marker on the client. */
export const slugSiteBasePath = createIsomorphicFn()
  .client((): string | undefined => document.querySelector<HTMLMetaElement>(`meta[name="${SITE_BASE_META}"]`)?.content || undefined)
  .server((): string | undefined => {
    const base = customDomainOrigin();
    return base ? new URL(base).pathname.replace(/\/+$/, '') || undefined : undefined;
  });
