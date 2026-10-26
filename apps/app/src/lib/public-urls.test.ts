import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeBaseDomain, PUBLIC_URL_META, readPublicUrls } from './public-urls';

const loadPublicUrls = async () => (await import('./public-urls')).publicUrls();

const documentWith = (meta: Record<string, string>) =>
  ({
    querySelector: (selector: string) => {
      const name = /^meta\[name="([^"]+)"\]$/.exec(selector)?.[1];
      return name && name in meta ? { content: meta[name] } : null;
    },
  }) as Pick<Document, 'querySelector'>;

describe('publicUrls on the server', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllEnvs());

  it('reads APP_URL, ADMIN_URL and SITE_BASE_DOMAIN at runtime', async () => {
    vi.stubEnv('APP_URL', 'https://docs.example.org');
    vi.stubEnv('ADMIN_URL', 'https://ops.example.org');
    vi.stubEnv('SITE_BASE_DOMAIN', '*.sites.example.org.');
    expect(await loadPublicUrls()).toEqual({
      appUrl: 'https://docs.example.org',
      adminUrl: 'https://ops.example.org',
      siteBaseDomain: 'sites.example.org',
    });
  });

  it('defaults to the local development origins', async () => {
    vi.stubEnv('APP_URL', '');
    vi.stubEnv('ADMIN_URL', '');
    vi.stubEnv('SITE_BASE_DOMAIN', '');
    expect(await loadPublicUrls()).toEqual({ appUrl: 'http://localhost:4310', adminUrl: 'http://localhost:4315', siteBaseDomain: undefined });
  });

  it.each([
    ['APP_URL', 'javascript:alert(1)'],
    ['APP_URL', 'docs.example.org'],
    ['ADMIN_URL', 'ftp://ops.example.org'],
  ])('rejects %s=%s at boot', async (name, value) => {
    vi.stubEnv(name, value);
    await expect(loadPublicUrls()).rejects.toThrow();
  });
});

describe('readPublicUrls', () => {
  it('reads the meta tags the root document rendered', () => {
    const doc = documentWith({
      [PUBLIC_URL_META.appUrl]: 'https://docs.example.org',
      [PUBLIC_URL_META.adminUrl]: 'https://ops.example.org',
      [PUBLIC_URL_META.siteBaseDomain]: 'sites.example.org',
    });
    expect(readPublicUrls(doc)).toEqual({
      appUrl: 'https://docs.example.org',
      adminUrl: 'https://ops.example.org',
      siteBaseDomain: 'sites.example.org',
    });
  });

  it('leaves the base domain unset when no meta tag carries one', () => {
    const doc = documentWith({ [PUBLIC_URL_META.appUrl]: 'https://docs.example.org', [PUBLIC_URL_META.adminUrl]: 'https://ops.example.org' });
    expect(readPublicUrls(doc).siteBaseDomain).toBeUndefined();
  });

  it('fails loudly instead of guessing when the document has no URLs', () => {
    expect(() => readPublicUrls(documentWith({}))).toThrow('missing its public URL meta tags');
  });
});

describe('normalizeBaseDomain', () => {
  it.each([
    ['*.docs.example.org', 'docs.example.org'],
    ['docs.example.org.', 'docs.example.org'],
    ['  docs.example.org ', 'docs.example.org'],
    ['', undefined],
    [undefined, undefined],
  ])('%s -> %s', (raw, expected) => {
    expect(normalizeBaseDomain(raw)).toBe(expected);
  });
});
