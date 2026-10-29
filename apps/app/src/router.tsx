import { createRouter as createTanStackRouter } from '@tanstack/react-router';
import { createIsomorphicFn } from '@tanstack/react-start';
import { ErrorPage } from '@/components/error-page';
import { NotFound } from '@/components/not-found';
import { PageLoader } from '@/components/page-loader';
import { hydratedSiteDocument, rewriteSiteInput, rewriteSiteOutput } from '@/lib/custom-domain-rewrite';
import { homepageRewrite, isHomeSiteDocument } from '@/lib/homepage';
import { currentHomepage } from '@/lib/site-origin';
import { ssrNonce } from '@/lib/ssr-nonce.server';
import { routeTree } from './routeTree.gen';

const requestNonce = createIsomorphicFn()
  .server(() => ssrNonce.getStore())
  .client(() => undefined);

/** URL rewrite mapping a site document's public paths onto `/sites/:projectId`:
 *  a `/<slug>` wiki first, else the configured homepage, else a custom domain. */
const siteRewrite = () => {
  const site = hydratedSiteDocument();
  const documentRewrite = site
    ? {
        input: ({ url }: { url: URL }) => rewriteSiteInput(url, site.projectId, site.basePath),
        output: ({ url }: { url: URL }) => rewriteSiteOutput(url, site.projectId, site.basePath),
      }
    : undefined;
  if (site?.basePath) return documentRewrite;
  const homepage = currentHomepage();
  return homepageRewrite(homepage, isHomeSiteDocument(homepage)) ?? documentRewrite;
};

export function getRouter() {
  const router = createTanStackRouter({
    routeTree,
    // Start captures the hydration nonce before invoking the stream callback.
    ssr: { nonce: requestNonce() },
    defaultNotFoundComponent: NotFound,
    defaultErrorComponent: ErrorPage,
    // Branded loading screen for route transitions that resolve loaders/data.
    // The delay avoids a flash on fast navigations; the min duration prevents a
    // jarring flicker once it does show.
    defaultPendingComponent: PageLoader,
    defaultPendingMs: 200,
    defaultPendingMinMs: 400,
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    rewrite: siteRewrite(),
  });
  return router;
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
