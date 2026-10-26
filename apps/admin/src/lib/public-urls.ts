import { createIsomorphicFn } from '@tanstack/react-start';
import { serverEnv } from '@/env.server';

/** `<meta name>` the root document renders the dashboard origin into. */
export const APP_URL_META = 'nibleaf-app-url';

/** The dashboard origin the root document rendered; throws when it is missing. */
export function readAppUrl(doc: Pick<Document, 'querySelector'>): string {
  const appUrl = doc.querySelector<HTMLMetaElement>(`meta[name="${APP_URL_META}"]`)?.content;
  if (!appUrl) {
    throw new Error('The document is missing its app URL meta tag.');
  }
  return appUrl;
}

/** Dashboard origin (`APP_URL`). Server: validated runtime env. Client: the root route's meta tag. */
export const appUrl = createIsomorphicFn()
  .server((): string => serverEnv.APP_URL)
  .client((): string => readAppUrl(document));
