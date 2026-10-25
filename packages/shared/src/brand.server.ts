import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BRAND_ASSET_FILES, BRAND_ASSETS_PATH, type Brand, readBrand } from './brand';

const CONTENT_TYPES: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

const assetsDir = (): string | undefined => process.env.BRAND_ASSETS_DIR?.trim() || undefined;

let cached: Brand | undefined;

/** The instance brand from runtime env; read once per process. */
export function instanceBrand(): Brand {
  if (!cached) {
    const dir = assetsDir();
    cached = readBrand(process.env, {
      icons: Boolean(dir && existsSync(join(dir, 'favicon.svg'))),
      mark: Boolean(dir && existsSync(join(dir, 'mark.svg'))),
    });
  }
  return cached;
}

/** Serve `/brand-assets/<file>` from `BRAND_ASSETS_DIR`; null when not a present brand asset. */
export function brandAssetResponse(pathname: string): Response | null {
  const dir = assetsDir();
  if (!(dir && pathname.startsWith(`${BRAND_ASSETS_PATH}/`))) return null;
  const name = BRAND_ASSET_FILES.find((file) => pathname === `${BRAND_ASSETS_PATH}/${file}`);
  const file = name && join(dir, name);
  if (!(file && existsSync(file))) return null;
  const extension = file.slice(file.lastIndexOf('.'));
  return new Response(readFileSync(file), {
    headers: {
      'Content-Type': CONTENT_TYPES[extension] ?? 'application/octet-stream',
      'Cache-Control': 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      ...(extension === '.svg' ? { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" } : {}),
    },
  });
}
