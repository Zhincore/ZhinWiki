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

const assetCache = new Map<string, Buffer<ArrayBuffer> | null>();

/** A brand asset's bytes (null when absent), read once per process like the brand itself. */
const assetBytes = (file: string): Buffer<ArrayBuffer> | null => {
  if (!assetCache.has(file)) assetCache.set(file, existsSync(file) ? readFileSync(file) : null);
  return assetCache.get(file) ?? null;
};

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

/**
 * Serve `/brand-assets/<file>` from `BRAND_ASSETS_DIR`. An icon the directory
 * lacks redirects to the bundled default, so a partial icon set still works.
 * Null when the path is not a brand asset (or a missing `mark.svg`).
 */
export function brandAssetResponse(pathname: string): Response | null {
  const dir = assetsDir();
  if (!(dir && pathname.startsWith(`${BRAND_ASSETS_PATH}/`))) return null;
  const name = BRAND_ASSET_FILES.find((file) => pathname === `${BRAND_ASSETS_PATH}/${file}`);
  if (!name) return null;
  const body = assetBytes(join(dir, name));
  if (!body) return name === 'mark.svg' ? null : new Response(null, { status: 302, headers: { Location: `/${name}` } });
  const extension = name.slice(name.lastIndexOf('.'));
  return new Response(body, {
    headers: {
      'Content-Type': CONTENT_TYPES[extension] ?? 'application/octet-stream',
      'Cache-Control': 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      ...(extension === '.svg' ? { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" } : {}),
    },
  });
}
