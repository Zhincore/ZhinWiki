import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { BRAND_ASSET_FILES, BRAND_ASSETS_PATH, type Brand, readBrand } from './brand';

const CONTENT_TYPES: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

const CACHE_CONTROL = 'public, max-age=3600';

const assetsDir = (): string | undefined => process.env.BRAND_ASSETS_DIR?.trim() || undefined;

/** Whether `path` is a regular file (a directory mounted at an asset path counts as absent). */
const isFile = (path: string): boolean => statSync(path, { throwIfNoEntry: false })?.isFile() ?? false;

/** Icon files whose presence switches the favicon set to `BRAND_ASSETS_DIR`. */
const ICON_FILES = BRAND_ASSET_FILES.filter((file) => file !== 'site.webmanifest' && file !== 'mark.svg');

let cached: Brand | undefined;

const assetCache = new Map<string, Buffer<ArrayBuffer> | null>();

/** A brand asset's bytes (null when absent), read once per process like the brand itself. */
const assetBytes = (file: string): Buffer<ArrayBuffer> | null => {
  if (!assetCache.has(file)) assetCache.set(file, isFile(file) ? readFileSync(file) : null);
  return assetCache.get(file) ?? null;
};

/** The instance brand from runtime env; read once per process. Throws on an invalid brand variable. */
export function instanceBrand(): Brand {
  if (!cached) {
    const dir = assetsDir();
    cached = readBrand(process.env, {
      icons: Boolean(dir && ICON_FILES.some((file) => isFile(join(dir, file)))),
      mark: Boolean(dir && isFile(join(dir, 'mark.svg'))),
    });
  }
  return cached;
}

/** Per-app web manifest wording; `label` is appended to the brand name (e.g. `Admin`). */
export interface ManifestOptions {
  label?: string;
  description?: string;
}

/** Web manifest for the brand, with icons resolved against its active icon base. */
export function brandManifest(brand: Brand, { label, description }: ManifestOptions = {}) {
  const name = label ? `${brand.name} ${label}` : brand.name;
  const icon = (file: string, type: string, sizes: string, purpose: string) => ({ src: `${brand.iconBase}/${file}`, type, sizes, purpose });
  return {
    name,
    short_name: name,
    description: description ?? `${brand.name} — documentation workspace`,
    lang: 'en',
    dir: 'ltr',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    theme_color: '#181612',
    background_color: '#FBF7EE',
    icons: [
      icon('favicon.svg', 'image/svg+xml', 'any', 'any'),
      icon('apple-touch-icon.png', 'image/png', '180x180', 'any'),
      icon('android-chrome-192x192.png', 'image/png', '192x192', 'any maskable'),
      icon('android-chrome-512x512.png', 'image/png', '512x512', 'any maskable'),
    ],
  };
}

/**
 * Serve GET/HEAD `/brand-assets/<file>` from `BRAND_ASSETS_DIR`. The web manifest
 * falls back to the generated {@link brandManifest}; any other icon the directory
 * lacks redirects to the bundled default, so a partial icon set still works.
 * Null when the request is not for a brand asset (or a missing `mark.svg`).
 */
export function brandAssetResponse(request: Request, manifest?: ManifestOptions): Response | null {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const { pathname } = new URL(request.url);
  if (!pathname.startsWith(`${BRAND_ASSETS_PATH}/`)) return null;
  const name = BRAND_ASSET_FILES.find((file) => pathname === `${BRAND_ASSETS_PATH}/${file}`);
  if (!name) return null;
  const dir = assetsDir();
  const extension = name.slice(name.lastIndexOf('.'));
  const headers = {
    'Content-Type': CONTENT_TYPES[extension] ?? 'application/octet-stream',
    'Cache-Control': CACHE_CONTROL,
    'X-Content-Type-Options': 'nosniff',
    ...(extension === '.svg' ? { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" } : {}),
  };
  const head = request.method === 'HEAD';
  const file = dir ? assetBytes(join(dir, name)) : null;
  if (file) return new Response(head ? null : file, { headers });
  if (name === 'site.webmanifest') {
    return new Response(head ? null : JSON.stringify(brandManifest(instanceBrand(), manifest)), { headers });
  }
  if (name === 'mark.svg') return null;
  return new Response(null, { status: 302, headers: { Location: `/${name}`, 'Cache-Control': CACHE_CONTROL } });
}
