import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { brandAccentCss, DEFAULT_BRAND, readBrand } from './brand';
import { brandAssetResponse, brandManifest } from './brand.server';

const BRAND_ENV = [
  'APP_NAME',
  'BRAND_URL',
  'BRAND_SUPPORT_EMAIL',
  'BRAND_ABUSE_EMAIL',
  'BRAND_SOURCE_URL',
  'BRAND_TERMS_URL',
  'BRAND_PRIVACY_URL',
  'BRAND_THEME_COLOR',
  'BRAND_ACCENT_COLOR',
  'BRAND_ASSETS_DIR',
] as const;

const get = (path: string, method = 'GET') => new Request(`http://localhost${path}`, { method });

describe('readBrand', () => {
  it('defaults to the Nibleaf brand', () => {
    expect(readBrand({})).toEqual(DEFAULT_BRAND);
    expect(readBrand({ APP_NAME: '  ', BRAND_URL: '', BRAND_SUPPORT_EMAIL: ' ' })).toEqual(DEFAULT_BRAND);
  });

  it('reads every user-facing value from env', () => {
    expect(
      readBrand(
        {
          APP_NAME: 'Acme Docs',
          BRAND_URL: 'https://acme.test',
          BRAND_SUPPORT_EMAIL: 'help@acme.test',
          BRAND_ABUSE_EMAIL: 'abuse@acme.test',
          BRAND_SOURCE_URL: 'https://git.acme.test/docs',
          BRAND_TERMS_URL: 'https://acme.test/legal/terms',
          BRAND_PRIVACY_URL: 'https://acme.test/legal/privacy',
          BRAND_THEME_COLOR: '#1a2B3c',
          BRAND_ACCENT_COLOR: '#2563eb,#60a5fa',
        },
        { icons: true, mark: true },
      ),
    ).toEqual({
      name: 'Acme Docs',
      url: 'https://acme.test',
      supportEmail: 'help@acme.test',
      abuseEmail: 'abuse@acme.test',
      sourceUrl: 'https://git.acme.test/docs',
      termsUrl: 'https://acme.test/legal/terms',
      privacyUrl: 'https://acme.test/legal/privacy',
      themeColor: '#1a2B3c',
      accentColor: { light: '#2563eb', dark: '#60a5fa' },
      iconBase: '/brand-assets',
      markUrl: '/brand-assets/mark.svg',
    });
  });

  it('falls back from the abuse contact to the support contact, then the default', () => {
    expect(readBrand({ BRAND_SUPPORT_EMAIL: 'help@acme.test' }).abuseEmail).toBe('help@acme.test');
    expect(readBrand({ BRAND_ABUSE_EMAIL: 'abuse@acme.test', BRAND_SUPPORT_EMAIL: 'help@acme.test' }).abuseEmail).toBe('abuse@acme.test');
    expect(readBrand({}).abuseEmail).toBe(DEFAULT_BRAND.abuseEmail);
  });

  it('links the built-in legal pages unless external ones are set', () => {
    expect(readBrand({})).toMatchObject({ termsUrl: '/terms', privacyUrl: '/privacy' });
    expect(readBrand({ BRAND_TERMS_URL: ' https://acme.test/tos ', BRAND_PRIVACY_URL: '' })).toMatchObject({
      termsUrl: 'https://acme.test/tos',
      privacyUrl: '/privacy',
    });
  });

  it('rejects brand URLs that are not absolute http(s)', () => {
    expect(() => readBrand({ BRAND_URL: 'acme.test' })).toThrow(/BRAND_URL/);
    expect(() => readBrand({ BRAND_URL: 'javascript:alert(1)' })).toThrow(/BRAND_URL/);
    expect(() => readBrand({ BRAND_SOURCE_URL: 'ftp://git.acme.test' })).toThrow(/BRAND_SOURCE_URL/);
    expect(() => readBrand({ BRAND_TERMS_URL: '/legal/terms' })).toThrow(/BRAND_TERMS_URL/);
    expect(() => readBrand({ BRAND_PRIVACY_URL: 'javascript:alert(1)' })).toThrow(/BRAND_PRIVACY_URL/);
    expect(readBrand({ BRAND_URL: 'http://acme.test' }).url).toBe('http://acme.test');
  });

  it('rejects theme colors that are not hex', () => {
    expect(() => readBrand({ BRAND_THEME_COLOR: 'red' })).toThrow(/BRAND_THEME_COLOR/);
    expect(() => readBrand({ BRAND_THEME_COLOR: '#000;}' })).toThrow(/BRAND_THEME_COLOR/);
    expect(readBrand({ BRAND_THEME_COLOR: '#fff' }).themeColor).toBe('#fff');
  });

  it('reads one accent for both modes or a light,dark pair', () => {
    expect(readBrand({ BRAND_ACCENT_COLOR: '#2563eb' }).accentColor).toEqual({ light: '#2563eb', dark: '#2563eb' });
    expect(readBrand({ BRAND_ACCENT_COLOR: '#2563eb,#60A5FA' }).accentColor).toEqual({ light: '#2563eb', dark: '#60A5FA' });
    expect(readBrand({ BRAND_ACCENT_COLOR: '  #2563eb ,  #fff ' }).accentColor).toEqual({ light: '#2563eb', dark: '#fff' });
    expect(readBrand({ BRAND_ACCENT_COLOR: '' }).accentColor).toBeNull();
    expect(readBrand({ BRAND_ACCENT_COLOR: '   ' }).accentColor).toBeNull();
  });

  it('rejects accents that are not one or two hex colors', () => {
    for (const value of ['blue', '#2563eb;}', '#2563eb,', ',#2563eb', '#2563eb,#60a5fa,#000000', '#2563eb #60a5fa']) {
      expect(() => readBrand({ BRAND_ACCENT_COLOR: value })).toThrow(/BRAND_ACCENT_COLOR/);
    }
  });

  it('rejects malformed emails', () => {
    expect(() => readBrand({ BRAND_SUPPORT_EMAIL: 'help' })).toThrow(/BRAND_SUPPORT_EMAIL/);
    expect(() => readBrand({ BRAND_ABUSE_EMAIL: 'abuse at acme.test' })).toThrow(/BRAND_ABUSE_EMAIL/);
  });
});

describe('brandAccentCss', () => {
  const VARIABLES = ['--primary', '--ring', '--chart-1', '--sidebar-primary', '--sidebar-ring', '--brand-copper'];

  it('overrides every accent variable per mode', () => {
    const css = brandAccentCss({ light: '#2563eb', dark: '#60a5fa' });
    const [, light = '', dark = ''] = css.match(/^:root:not\(\.dark\)\{([^}]*)\}:root\.dark\{([^}]*)\}$/) ?? [];
    for (const name of VARIABLES) {
      expect(light).toContain(`${name}:#2563eb`);
      expect(dark).toContain(`${name}:#60a5fa`);
    }
  });

  it('picks the more contrasting text color for each accent', () => {
    const css = brandAccentCss({ light: '#2563eb', dark: '#fde047' });
    expect(css).toContain(
      ':root:not(.dark){--primary:#2563eb;--ring:#2563eb;--chart-1:#2563eb;--sidebar-primary:#2563eb;--sidebar-ring:#2563eb;--brand-copper:#2563eb;--primary-foreground:#ffffff;--sidebar-primary-foreground:#ffffff}',
    );
    expect(css).toContain('--primary-foreground:#111318;--sidebar-primary-foreground:#111318}');
  });

  it('emits canonical hex only', () => {
    expect(brandAccentCss({ light: '#ABC', dark: '#60A5FA' })).toContain('--primary:#aabbcc');
    expect(brandAccentCss({ light: '#ABC', dark: '#60A5FA' })).toContain('--primary:#60a5fa');
    expect(brandAccentCss({ light: '#2563eb', dark: 'red;}body{color:red' })).toBe('');
  });
});

describe('brandManifest', () => {
  it('names the brand and resolves icons against the icon base', () => {
    const manifest = brandManifest({ ...DEFAULT_BRAND, name: 'Acme', iconBase: '/brand-assets' });
    expect(manifest.name).toBe('Acme');
    expect(manifest.short_name).toBe('Acme');
    expect(manifest.icons.map((icon) => icon.src)).toEqual([
      '/brand-assets/favicon.svg',
      '/brand-assets/apple-touch-icon.png',
      '/brand-assets/android-chrome-192x192.png',
      '/brand-assets/android-chrome-512x512.png',
    ]);
  });

  it('labels per-app manifests and keeps bundled icons by default', () => {
    const manifest = brandManifest({ ...DEFAULT_BRAND, name: 'Acme' }, { label: 'Admin', description: 'Console' });
    expect(manifest.name).toBe('Acme Admin');
    expect(manifest.description).toBe('Console');
    expect(manifest.icons[0]?.src).toBe('/favicon.svg');
  });
});

describe('brand from process env', () => {
  let dir: string;
  const previous = Object.fromEntries(BRAND_ENV.map((key) => [key, process.env[key]]));

  /** A fresh module, since the brand is cached per process. */
  const load = async () => {
    vi.resetModules();
    return await import('./brand.server');
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brand-assets-'));
    for (const key of BRAND_ENV) delete process.env[key];
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    for (const key of BRAND_ENV) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });

  it('switches icons and mark only for files the asset directory provides', async () => {
    writeFileSync(join(dir, 'favicon.svg'), '<svg/>');
    process.env.BRAND_ASSETS_DIR = dir;
    expect((await load()).instanceBrand()).toMatchObject({ iconBase: '/brand-assets', markUrl: null });
  });

  it('switches icons for a PNG-only set', async () => {
    writeFileSync(join(dir, 'favicon-32x32.png'), 'png');
    process.env.BRAND_ASSETS_DIR = dir;
    const { instanceBrand, brandAssetResponse: respond } = await load();
    expect(instanceBrand()).toMatchObject({ iconBase: '/brand-assets' });
    expect(respond(get('/brand-assets/favicon.svg'))?.status).toBe(302);
  });

  it('detects a custom mark without switching the icon set', async () => {
    writeFileSync(join(dir, 'mark.svg'), '<svg/>');
    process.env.BRAND_ASSETS_DIR = dir;
    expect((await load()).instanceBrand()).toMatchObject({ iconBase: '', markUrl: '/brand-assets/mark.svg' });
  });

  it('ignores directories mounted at asset paths', async () => {
    mkdirSync(join(dir, 'favicon.svg'));
    mkdirSync(join(dir, 'mark.svg'));
    process.env.BRAND_ASSETS_DIR = dir;
    const { instanceBrand, brandAssetResponse: respond } = await load();
    expect(instanceBrand()).toMatchObject({ iconBase: '', markUrl: null });
    expect(respond(get('/brand-assets/mark.svg'))).toBeNull();
    expect(respond(get('/brand-assets/favicon.svg'))?.status).toBe(302);
  });

  it('throws on an invalid brand env', async () => {
    process.env.BRAND_URL = 'not a url';
    const { instanceBrand } = await load();
    expect(() => instanceBrand()).toThrow(/BRAND_URL/);
  });

  it('generates the web manifest when the directory has none', async () => {
    process.env.APP_NAME = 'Acme';
    const { brandAssetResponse: respond } = await load();
    const response = respond(get('/brand-assets/site.webmanifest'), { label: 'Admin' });
    expect(response?.headers.get('content-type')).toBe('application/manifest+json');
    expect(await response?.json()).toMatchObject({
      name: 'Acme Admin',
      icons: expect.arrayContaining([expect.objectContaining({ src: '/favicon.svg' })]),
    });
  });

  it('serves a custom web manifest over the generated one', async () => {
    writeFileSync(join(dir, 'site.webmanifest'), '{"name":"Custom"}');
    process.env.APP_NAME = 'Acme';
    process.env.BRAND_ASSETS_DIR = dir;
    const { brandAssetResponse: respond } = await load();
    expect(await respond(get('/brand-assets/site.webmanifest'))?.json()).toEqual({ name: 'Custom' });
  });
});

describe('brandAssetResponse', () => {
  let dir: string;
  const previous = process.env.BRAND_ASSETS_DIR;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brand-assets-'));
    writeFileSync(join(dir, 'mark.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    writeFileSync(join(dir, 'secret.txt'), 'nope');
    process.env.BRAND_ASSETS_DIR = dir;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (previous === undefined) delete process.env.BRAND_ASSETS_DIR;
    else process.env.BRAND_ASSETS_DIR = previous;
  });

  it('serves a present brand asset with a locked-down SVG policy', async () => {
    const response = brandAssetResponse(get('/brand-assets/mark.svg'));
    expect(response?.headers.get('content-type')).toBe('image/svg+xml');
    expect(response?.headers.get('content-security-policy')).toContain('sandbox');
    expect(await response?.text()).toContain('<svg');
  });

  it('answers only GET and HEAD', async () => {
    const head = brandAssetResponse(get('/brand-assets/mark.svg', 'HEAD'));
    expect(head?.status).toBe(200);
    expect(head?.headers.get('content-type')).toBe('image/svg+xml');
    expect(await head?.text()).toBe('');
    for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
      expect(brandAssetResponse(get('/brand-assets/mark.svg', method))).toBeNull();
    }
  });

  it('serves only listed files from the asset directory', () => {
    expect(brandAssetResponse(get('/brand-assets/secret.txt'))).toBeNull();
    expect(brandAssetResponse(get('/brand-assets/..%2Fsecret.txt'))).toBeNull();
    expect(brandAssetResponse(get('/favicon.svg'))).toBeNull();
  });

  it('falls back to the bundled icon for files the directory lacks', () => {
    const response = brandAssetResponse(get('/brand-assets/favicon-32x32.png'));
    expect(response?.status).toBe(302);
    expect(response?.headers.get('location')).toBe('/favicon-32x32.png');
  });

  it('serves no mark without BRAND_ASSETS_DIR', () => {
    delete process.env.BRAND_ASSETS_DIR;
    expect(brandAssetResponse(get('/brand-assets/mark.svg'))).toBeNull();
    expect(brandAssetResponse(get('/brand-assets/favicon.svg'))?.status).toBe(302);
  });
});
