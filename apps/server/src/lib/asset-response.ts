import { normalizeAssetContentType, SVG_CONTENT_TYPE, safeInlineAssetContentType } from '@nibleaf/validators';

/** Renders as an image but can run no script, load nothing external, nor submit or navigate,
 * even when the SVG is opened directly. */
const SVG_CONTENT_SECURITY_POLICY = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox";

/**
 * Turn untrusted object-storage metadata into safe browser response headers.
 *
 * Asset URLs share an origin with the dashboard. Anything other than our small
 * raster-image allowlist must therefore download rather than render as HTML or
 * another active document. SVG (sanitized when stored) renders inline under a
 * script-free CSP sandbox.
 */
export const publicAssetResponseHeaders = (storedContentType: string | undefined) => {
  const inlineContentType = safeInlineAssetContentType(storedContentType);
  if (inlineContentType) {
    return { contentType: inlineContentType, contentDisposition: undefined, contentSecurityPolicy: undefined };
  }
  if (storedContentType && normalizeAssetContentType(storedContentType) === SVG_CONTENT_TYPE) {
    return { contentType: SVG_CONTENT_TYPE, contentDisposition: undefined, contentSecurityPolicy: SVG_CONTENT_SECURITY_POLICY };
  }
  return {
    contentType: 'application/octet-stream',
    contentDisposition: 'attachment',
    // Defense in depth for clients that choose to render a downloaded response.
    contentSecurityPolicy: 'sandbox',
  };
};
