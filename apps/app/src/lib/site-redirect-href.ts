import { normalizeRedirectPath } from '@nibleaf/shared/redirects';

/** Build the browser-visible Location for one validated internal redirect.
 * Configured query/fragment values are retained. The current locale is carried
 * only when the destination did not deliberately choose another locale. */
export function buildSiteRedirectHref(input: { target: string; lang?: string; basePath: string }): string {
  const targetUrl = new URL(input.target, 'https://redirect.nibleaf.invalid');
  const target = normalizeRedirectPath(targetUrl.pathname);
  if (input.lang && !targetUrl.searchParams.has('lang')) {
    targetUrl.searchParams.set('lang', input.lang);
  }
  const suffix = `${targetUrl.search}${targetUrl.hash}`;
  return `${input.basePath}${target || !input.basePath ? `/${target}` : ''}${suffix}`;
}
