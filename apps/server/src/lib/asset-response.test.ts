import { describe, expect, it } from 'vitest';
import { publicAssetResponseHeaders } from './asset-response';

describe('publicAssetResponseHeaders', () => {
  it.each(['image/png', 'IMAGE/JPEG; charset=binary', 'image/webp', 'image/avif', 'image/vnd.microsoft.icon'])(
    'keeps safe raster image type inline: %s',
    (contentType) => {
      expect(publicAssetResponseHeaders(contentType)).toEqual({
        contentType: contentType.toLowerCase().split(';')[0],
        contentDisposition: undefined,
        contentSecurityPolicy: undefined,
      });
    },
  );

  it.each(['image/svg+xml', 'IMAGE/SVG+XML; charset=utf-8'])('renders SVG inline under a script-free CSP sandbox: %s', (contentType) => {
    const headers = publicAssetResponseHeaders(contentType);
    expect(headers).toMatchObject({ contentType: 'image/svg+xml', contentDisposition: undefined });
    expect(headers.contentSecurityPolicy).toBe("default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox");
  });

  it.each(['text/html', 'application/xhtml+xml', 'text/plain', undefined])('forces unsafe stored content to download: %s', (contentType) => {
    expect(publicAssetResponseHeaders(contentType)).toEqual({
      contentType: 'application/octet-stream',
      contentDisposition: 'attachment',
      contentSecurityPolicy: 'sandbox',
    });
  });
});
