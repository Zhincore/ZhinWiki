/** The instance brand shown to users. Read at runtime from env, so one prebuilt image serves any brand. */
export interface Brand {
  /** Product name (`APP_NAME`). */
  name: string;
  /** Public homepage (`BRAND_URL`). */
  url: string;
  /** Support and abuse contact (`BRAND_SUPPORT_EMAIL`). */
  supportEmail: string;
  /** Source of the running code, linked for AGPL-3.0 §13 (`BRAND_SOURCE_URL`). */
  sourceUrl: string;
  /** Path prefix of the favicon set and web manifest: `''` = bundled, `/brand-assets` = `BRAND_ASSETS_DIR`. */
  iconBase: string;
  /** Custom mark image (`BRAND_ASSETS_DIR/mark.svg`); null = built-in mark. */
  markUrl: string | null;
}

/** Public path prefix `BRAND_ASSETS_DIR` is served under. */
export const BRAND_ASSETS_PATH = '/brand-assets';

/** Files `BRAND_ASSETS_DIR` may provide. */
export const BRAND_ASSET_FILES = [
  'favicon.svg',
  'favicon.ico',
  'favicon-16x16.png',
  'favicon-32x32.png',
  'apple-touch-icon.png',
  'android-chrome-192x192.png',
  'android-chrome-512x512.png',
  'site.webmanifest',
  'mark.svg',
] as const;

export const DEFAULT_BRAND: Brand = {
  name: 'Nibleaf',
  url: 'https://nibleaf.com',
  supportEmail: 'support@nibleaf.com',
  sourceUrl: 'https://github.com/lord007tn/nibleaf',
  iconBase: '',
  markUrl: null,
};

const value = (raw: string | undefined, fallback: string): string => raw?.trim() || fallback;

/** Build the brand from env, given which parts the asset directory provides. */
export const readBrand = (
  env: Record<string, string | undefined>,
  assets: { icons: boolean; mark: boolean } = { icons: false, mark: false },
): Brand => ({
  name: value(env.APP_NAME, DEFAULT_BRAND.name),
  url: value(env.BRAND_URL, DEFAULT_BRAND.url),
  supportEmail: value(env.BRAND_SUPPORT_EMAIL, DEFAULT_BRAND.supportEmail),
  sourceUrl: value(env.BRAND_SOURCE_URL, DEFAULT_BRAND.sourceUrl),
  iconBase: assets.icons ? BRAND_ASSETS_PATH : '',
  markUrl: assets.mark ? `${BRAND_ASSETS_PATH}/mark.svg` : null,
});
