import type { LocationRewrite } from '@tanstack/react-router';
import { rewriteCustomDomainInput, rewriteCustomDomainOutput } from '@/lib/custom-domain-rewrite';
import { isAppOwnedPath } from '@/lib/request-negotiation';

/** What the app origin serves at `/` (env `HOMEPAGE`). */
export type Homepage = { mode: 'welcome' } | { mode: 'app' } | { mode: 'site'; projectId: string };

/** Parse `HOMEPAGE`: unset/empty (welcome page), `app`, or `site:<projectId>`. Throws on anything else. */
export function parseHomepage(value?: string): Homepage {
  const raw = value?.trim() ?? '';
  if (!raw) return { mode: 'welcome' };
  if (raw === 'app') return { mode: 'app' };
  const projectId = /^site:([A-Za-z0-9_-]+)$/.exec(raw)?.[1];
  if (projectId) return { mode: 'site', projectId };
  throw new Error(`Invalid HOMEPAGE "${raw}": leave it empty for the welcome page, or use app or site:<projectId>.`);
}

/** The `HOMEPAGE` value that parses back to `homepage`. */
export const formatHomepage = (homepage: Homepage): string =>
  homepage.mode === 'site' ? `site:${homepage.projectId}` : homepage.mode === 'app' ? 'app' : '';

const DASHBOARD_PATH =
  /^\/(?:app|sign-in|sign-up|forgot-password|reset-password|verify-email|accept-invite|git-preview|brand-assets|health|terms|privacy)(?:\/|$)/;

/** Dashboard, auth, legal and runtime paths the app owns at its root; never part of a home wiki. */
export const isDashboardPath = (pathname: string): boolean => DASHBOARD_PATH.test(pathname) || isAppOwnedPath(pathname);

/** Whether the hydrating document is a home-site page rather than a dashboard page or a `/sites/*` preview. */
export function isHomeSiteDocument(homepage: Homepage): boolean {
  return homepage.mode === 'site' && typeof window !== 'undefined' && !isDashboardPath(window.location.pathname);
}

/**
 * Router URL rewrite for a homepage mode, the same on server and client. `app`
 * maps `/` to the dashboard. `site` maps non-dashboard paths onto the home
 * site; only a home-site document (`homeDocument`) maps `/sites/:id` hrefs back
 * to the root.
 */
export function homepageRewrite(homepage: Homepage, homeDocument: boolean): LocationRewrite | undefined {
  if (homepage.mode === 'app') {
    return {
      input: ({ url }) => {
        if (url.pathname !== '/') return url;
        const next = new URL(url);
        next.pathname = '/app';
        return next;
      },
    };
  }
  if (homepage.mode === 'site') {
    const { projectId } = homepage;
    return {
      input: ({ url }) => (isDashboardPath(url.pathname) ? url : rewriteCustomDomainInput(url, projectId)),
      output: homeDocument ? ({ url }) => rewriteCustomDomainOutput(url, projectId) : undefined,
    };
  }
  return undefined;
}
