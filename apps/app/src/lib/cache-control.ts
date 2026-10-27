/** Policy for session-dependent responses and anything a shared cache must never replay. */
export const PRIVATE_NO_STORE = 'private, no-store';

/** Policy for unhashed public files (favicons, manifest, brand images). */
export const PUBLIC_FILE_CACHE = 'public, max-age=3600';

/** Default a response to {@link PRIVATE_NO_STORE} unless its handler chose a
 *  policy. A response that sets a cookie is never cacheable. */
export function applyDefaultCacheControl(headers: Headers): void {
  if (!headers.has('cache-control') || headers.has('set-cookie')) {
    headers.set('cache-control', PRIVATE_NO_STORE);
  }
}
