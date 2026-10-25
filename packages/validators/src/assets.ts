/**
 * Types we may serve inline from the dashboard/API origin. SVG is intentionally
 * excluded: when navigated directly it can execute script in that origin.
 */
export const SAFE_INLINE_ASSET_CONTENT_TYPES = [
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/vnd.microsoft.icon',
  'image/webp',
  'image/x-icon',
] as const;

const safeInlineAssetContentTypeSet = new Set<string>(SAFE_INLINE_ASSET_CONTENT_TYPES);

const contentTypeByExtension: Record<string, (typeof SAFE_INLINE_ASSET_CONTENT_TYPES)[number]> = {
  avif: 'image/avif',
  gif: 'image/gif',
  ico: 'image/x-icon',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/** SVG is stored only after server-side sanitizing and is always served under a
 * script-free CSP sandbox, so it may be uploaded although it is not "safe inline". */
export const SVG_CONTENT_TYPE = 'image/svg+xml';

/** SVGs are parsed in memory to sanitize them, so they get a tighter size cap. */
export const MAX_SVG_BYTES = 5 * 1024 * 1024;

/** Strip parameters and normalize a media type before it is stored or compared. */
export const normalizeAssetContentType = (value: string): string => value.split(';', 1)[0]?.trim().toLowerCase() ?? '';

export const isSafeInlineAssetContentType = (value: string): boolean => safeInlineAssetContentTypeSet.has(value);

/** Best-effort browser fallback when File.type is empty; never guesses active types. */
export const inferSafeInlineAssetContentType = (filename: string): string | undefined => {
  const extension = filename.trim().toLowerCase().split('.').pop();
  return extension ? contentTypeByExtension[extension] : undefined;
};

/** Types a browser upload or an importer may store: the raster allowlist plus SVG. */
export const isUploadableAssetContentType = (value: string): boolean => isSafeInlineAssetContentType(value) || value === SVG_CONTENT_TYPE;

/** Like inferSafeInlineAssetContentType, but also recognises `.svg` for uploads. */
export const inferUploadableAssetContentType = (filename: string): string | undefined =>
  inferSafeInlineAssetContentType(filename) ?? (filename.trim().toLowerCase().endsWith('.svg') ? SVG_CONTENT_TYPE : undefined);

/** Return a canonical safe type, or undefined when an object must download. */
export const safeInlineAssetContentType = (value: string | null | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }
  const normalized = normalizeAssetContentType(value);
  return isSafeInlineAssetContentType(normalized) ? normalized : undefined;
};
