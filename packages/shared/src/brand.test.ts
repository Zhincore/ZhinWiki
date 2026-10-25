import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_BRAND, readBrand } from './brand';
import { brandAssetResponse } from './brand.server';

describe('readBrand', () => {
  it('defaults to the Nibleaf brand', () => {
    expect(readBrand({})).toEqual(DEFAULT_BRAND);
    expect(readBrand({ APP_NAME: '  ' })).toEqual(DEFAULT_BRAND);
  });

  it('reads every user-facing value from env', () => {
    expect(
      readBrand(
        {
          APP_NAME: 'Acme Docs',
          BRAND_URL: 'https://acme.test',
          BRAND_SUPPORT_EMAIL: 'help@acme.test',
          BRAND_SOURCE_URL: 'https://git.acme.test/docs',
        },
        { icons: true, mark: true },
      ),
    ).toEqual({
      name: 'Acme Docs',
      url: 'https://acme.test',
      supportEmail: 'help@acme.test',
      sourceUrl: 'https://git.acme.test/docs',
      iconBase: '/brand-assets',
      markUrl: '/brand-assets/mark.svg',
    });
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
    const response = brandAssetResponse('/brand-assets/mark.svg');
    expect(response?.headers.get('content-type')).toBe('image/svg+xml');
    expect(response?.headers.get('content-security-policy')).toContain('sandbox');
    expect(await response?.text()).toContain('<svg');
  });

  it('serves only listed files from the asset directory', () => {
    expect(brandAssetResponse('/brand-assets/secret.txt')).toBeNull();
    expect(brandAssetResponse('/brand-assets/../secret.txt')).toBeNull();
    expect(brandAssetResponse('/favicon.svg')).toBeNull();
  });

  it('falls back to the bundled icon for files the directory lacks', () => {
    const response = brandAssetResponse('/brand-assets/favicon-32x32.png');
    expect(response?.status).toBe(302);
    expect(response?.headers.get('location')).toBe('/favicon-32x32.png');
  });

  it('serves nothing without BRAND_ASSETS_DIR', () => {
    delete process.env.BRAND_ASSETS_DIR;
    expect(brandAssetResponse('/brand-assets/mark.svg')).toBeNull();
  });
});
