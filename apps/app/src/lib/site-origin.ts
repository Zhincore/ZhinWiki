import { createIsomorphicFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
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
 * The custom-domain origin the server entry (src/server.ts) stamped on a
 * rewritten request, e.g. "https://docs.acme.com". Returns undefined for
 * app-origin requests and on the client (where window.location.origin already
 * is the right origin). Used so a custom domain's SSR canonical / og:url /
 * hreflang point at the domain root instead of the internal
 * http://localhost:4310/sites/:id origin.
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
