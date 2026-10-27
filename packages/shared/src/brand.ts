import { contrastingText } from './themes';

/** The instance brand shown to users. Read at runtime from env, so one prebuilt image serves any brand. */
export interface Brand {
  /** Product name (`APP_NAME`). */
  name: string;
  /** Public homepage (`BRAND_URL`). */
  url: string;
  /** Support contact (`BRAND_SUPPORT_EMAIL`). */
  supportEmail: string;
  /** Abuse-report contact (`BRAND_ABUSE_EMAIL`, else `BRAND_SUPPORT_EMAIL`). */
  abuseEmail: string;
  /** Source of the running code, linked for AGPL-3.0 §13 (`BRAND_SOURCE_URL`). */
  sourceUrl: string;
  /** Terms of service: `BRAND_TERMS_URL`, else the built-in `/terms` page. */
  termsUrl: string;
  /** Privacy policy: `BRAND_PRIVACY_URL`, else the built-in `/privacy` page. */
  privacyUrl: string;
  /** Browser UI / address-bar color: `theme-color` meta and the generated manifest (`BRAND_THEME_COLOR`). */
  themeColor: string;
  /** Dashboard accent (buttons, links, focus rings) per mode (`BRAND_ACCENT_COLOR`); null = the built-in orange. */
  accentColor: BrandAccent | null;
  /** Path prefix of the favicon set: `''` = bundled, `/brand-assets` = `BRAND_ASSETS_DIR`. */
  iconBase: string;
  /** Custom mark image (`BRAND_ASSETS_DIR/mark.svg`); null = built-in mark. */
  markUrl: string | null;
}

/** Dashboard accent hex per color mode. */
export interface BrandAccent {
  light: string;
  dark: string;
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
  name: 'ZhinDocs',
  url: 'https://github.com/Zhincore/zhindocs',
  supportEmail: 'support@zhindocs.invalid',
  abuseEmail: 'abuse@zhindocs.invalid',
  sourceUrl: 'https://github.com/Zhincore/zhindocs',
  termsUrl: '/terms',
  privacyUrl: '/privacy',
  themeColor: '#000000',
  accentColor: null,
  iconBase: '',
  markUrl: null,
};

/** `<head>` icon and manifest links for a brand's icon set. */
export const brandIconLinks = (iconBase: string) => [
  { rel: 'icon', href: `${iconBase}/favicon.ico`, sizes: 'any' },
  { rel: 'icon', href: `${iconBase}/favicon.svg`, type: 'image/svg+xml' },
  { rel: 'icon', href: `${iconBase}/favicon-32x32.png`, type: 'image/png', sizes: '32x32' },
  { rel: 'apple-touch-icon', href: `${iconBase}/apple-touch-icon.png` },
  { rel: 'manifest', href: `${BRAND_ASSETS_PATH}/site.webmanifest` },
];

type Env = Record<string, string | undefined>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

const isHttpUrl = (raw: string): boolean => {
  try {
    const { protocol } = new URL(raw);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
};

/** The trimmed env value, or undefined when unset/empty; throws when set but invalid. */
const valid = (env: Env, key: string, isValid: (raw: string) => boolean, expected: string): string | undefined => {
  const raw = env[key]?.trim();
  if (!raw) return undefined;
  if (!isValid(raw)) throw new Error(`Invalid ${key} "${raw}": expected ${expected}.`);
  return raw;
};

const url = (env: Env, key: string) => valid(env, key, isHttpUrl, 'an absolute http(s) URL');
const email = (env: Env, key: string) => valid(env, key, (raw) => EMAIL.test(raw), 'an email address');
const color = (env: Env, key: string) => valid(env, key, (raw) => HEX_COLOR.test(raw), 'a hex color like #000000');

/** `BRAND_ACCENT_COLOR`: one hex for both modes or a `light,dark` pair; undefined when unset. */
const accent = (env: Env): BrandAccent | undefined => {
  const raw = env.BRAND_ACCENT_COLOR?.trim();
  if (!raw) return undefined;
  const parts = raw.split(',').map((part) => part.trim());
  if (parts.length > 2 || !parts.every((part) => HEX_COLOR.test(part))) {
    throw new Error(`Invalid BRAND_ACCENT_COLOR "${raw}": expected a hex color like #2563eb or a light,dark pair like #2563eb,#60a5fa.`);
  }
  const [light = '', dark = light] = parts;
  return { light, dark };
};

/** Design-system variables carrying the dashboard accent. */
const ACCENT_VARIABLES = ['--primary', '--ring', '--chart-1', '--sidebar-primary', '--sidebar-ring', '--brand-copper'];
const ACCENT_FOREGROUND_VARIABLES = ['--primary-foreground', '--sidebar-primary-foreground'];

/** `#rrggbb` rebuilt from the parsed channels of a 3- or 6-digit hex; null when not a hex color. */
const canonicalHex = (value: string): string | null => {
  if (!HEX_COLOR.test(value)) return null;
  const digits = value.length === 4 ? [...value.slice(1)].map((digit) => digit + digit) : value.slice(1).match(/../g);
  return `#${(digits ?? []).map((pair) => Number.parseInt(pair, 16).toString(16).padStart(2, '0')).join('')}`;
};

const accentDeclarations = (color: string): string => {
  const foreground = contrastingText(color);
  return [...ACCENT_VARIABLES.map((name) => `${name}:${color}`), ...ACCENT_FOREGROUND_VARIABLES.map((name) => `${name}:${foreground}`)].join(';');
};

/**
 * Stylesheet overriding the dashboard accent per mode, built from re-parsed hex values only
 * (empty when either is not a hex color). Outranks the design-system `:root` / `.dark` defaults.
 */
export const brandAccentCss = (accent: BrandAccent): string => {
  const light = canonicalHex(accent.light);
  const dark = canonicalHex(accent.dark);
  if (!light || !dark) return '';
  return `:root:not(.dark){${accentDeclarations(light)}}:root.dark{${accentDeclarations(dark)}}`;
};

/** Build the brand from env, given which parts the asset directory provides. Throws on an invalid brand variable. */
export const readBrand = (env: Env, assets: { icons: boolean; mark: boolean } = { icons: false, mark: false }): Brand => {
  const supportEmail = email(env, 'BRAND_SUPPORT_EMAIL');
  return {
    name: env.APP_NAME?.trim() || DEFAULT_BRAND.name,
    url: url(env, 'BRAND_URL') ?? DEFAULT_BRAND.url,
    supportEmail: supportEmail ?? DEFAULT_BRAND.supportEmail,
    abuseEmail: email(env, 'BRAND_ABUSE_EMAIL') ?? supportEmail ?? DEFAULT_BRAND.abuseEmail,
    sourceUrl: url(env, 'BRAND_SOURCE_URL') ?? DEFAULT_BRAND.sourceUrl,
    termsUrl: url(env, 'BRAND_TERMS_URL') ?? DEFAULT_BRAND.termsUrl,
    privacyUrl: url(env, 'BRAND_PRIVACY_URL') ?? DEFAULT_BRAND.privacyUrl,
    themeColor: color(env, 'BRAND_THEME_COLOR') ?? DEFAULT_BRAND.themeColor,
    accentColor: accent(env) ?? DEFAULT_BRAND.accentColor,
    iconBase: assets.icons ? BRAND_ASSETS_PATH : '',
    markUrl: assets.mark ? `${BRAND_ASSETS_PATH}/mark.svg` : null,
  };
};
