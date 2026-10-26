import { createIsomorphicFn } from '@tanstack/react-start';
import { serverEnv } from '@/env.server';

/** Instance URLs read from runtime env, so one image serves any deployment. */
export interface PublicUrls {
  /** Dashboard origin (`APP_URL`). */
  appUrl: string;
  /** Free-subdomain base (`SITE_BASE_DOMAIN`), when configured. */
  siteBaseDomain?: string;
}

/** `<meta name>` the root document renders for each public URL. */
export const PUBLIC_URL_META = {
  appUrl: 'nibleaf-app-url',
  siteBaseDomain: 'nibleaf-site-base-domain',
} as const satisfies Record<keyof PublicUrls, string>;

/** A base domain without its wildcard prefix or trailing dot. */
export const normalizeBaseDomain = (raw?: string): string | undefined => raw?.trim().replace(/^\*\./, '').replace(/\.$/, '') || undefined;

/** The public URLs the root document rendered; throws when they are missing. */
export function readPublicUrls(doc: Pick<Document, 'querySelector'>): PublicUrls {
  const read = (name: string) => doc.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content || undefined;
  const appUrl = read(PUBLIC_URL_META.appUrl);
  if (!appUrl) {
    throw new Error('The document is missing its public URL meta tags.');
  }
  return { appUrl, siteBaseDomain: normalizeBaseDomain(read(PUBLIC_URL_META.siteBaseDomain)) };
}

/** Server: validated runtime env. Client: the meta tags the root route rendered from it. */
export const publicUrls = createIsomorphicFn()
  .server(
    (): PublicUrls => ({
      appUrl: serverEnv.APP_URL,
      siteBaseDomain: normalizeBaseDomain(serverEnv.SITE_BASE_DOMAIN),
    }),
  )
  .client((): PublicUrls => readPublicUrls(document));
