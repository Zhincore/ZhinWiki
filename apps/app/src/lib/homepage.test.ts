import type { LocationRewriteFunction } from '@tanstack/react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatHomepage, type Homepage, homepageRewrite, isDashboardPath, isHomeSiteDocument, parseHomepage } from './homepage';

const apply = (rewrite: LocationRewriteFunction | undefined, path: string): string => {
  const url = new URL(path, 'https://docs.example');
  const next = rewrite?.({ url }) ?? url;
  return new URL(next).pathname;
};

describe('parseHomepage', () => {
  it('reads the three modes and defaults to welcome', () => {
    expect(parseHomepage(undefined)).toEqual({ mode: 'welcome' });
    expect(parseHomepage(' ')).toEqual({ mode: 'welcome' });
    expect(parseHomepage('app')).toEqual({ mode: 'app' });
    expect(parseHomepage('site:cmvjwvut6000207p0h2sfrxuv')).toEqual({ mode: 'site', projectId: 'cmvjwvut6000207p0h2sfrxuv' });
  });

  it('refuses anything else', () => {
    expect(() => parseHomepage('wiki')).toThrow(/Invalid HOMEPAGE/);
    expect(() => parseHomepage('marketing')).toThrow(/Invalid HOMEPAGE/);
    expect(() => parseHomepage('welcome')).toThrow(/Invalid HOMEPAGE/);
    expect(() => parseHomepage('site:../x')).toThrow(/Invalid HOMEPAGE/);
  });
});

describe('isDashboardPath', () => {
  it('keeps dashboard, auth and runtime paths out of the home wiki', () => {
    for (const path of [
      '/app',
      '/app/projects/x',
      '/sign-in',
      '/accept-invite/abc',
      '/api/app/me',
      '/sites/p1',
      '/_serverFn/x',
      '/brand-assets/mark.svg',
    ]) {
      expect(isDashboardPath(path)).toBe(true);
    }
  });

  it('leaves wiki pages to the site, even ones that start like a dashboard path', () => {
    for (const path of ['/', '/guides', '/application-notes', '/sign-installation', '/pricing']) {
      expect(isDashboardPath(path)).toBe(false);
    }
  });
});

describe('formatHomepage', () => {
  it('round-trips through parseHomepage', () => {
    for (const value of ['', 'app', 'site:p1']) {
      expect(formatHomepage(parseHomepage(value))).toBe(value);
    }
  });
});

describe('isHomeSiteDocument', () => {
  afterEach(() => vi.unstubAllGlobals());
  const site: Homepage = { mode: 'site', projectId: 'home' };

  it('is a home-site page only for non-dashboard, non-preview paths in site mode', () => {
    const at = (pathname: string, homepage: Homepage = site) => {
      vi.stubGlobal('window', { location: { pathname } });
      return isHomeSiteDocument(homepage);
    };
    expect(at('/guides')).toBe(true);
    expect(at('/')).toBe(true);
    expect(at('/app/projects/x')).toBe(false);
    expect(at('/sites/home/guides')).toBe(false);
    expect(at('/guides', { mode: 'app' })).toBe(false);
  });

  it('is never a home-site page on the server', () => {
    expect(isHomeSiteDocument(site)).toBe(false);
  });
});

describe('homepageRewrite', () => {
  it('leaves the welcome homepage alone', () => {
    expect(homepageRewrite({ mode: 'welcome' }, false)).toBeUndefined();
  });

  it('sends the app mode root to the dashboard only', () => {
    const rewrite = homepageRewrite({ mode: 'app' }, false);
    expect(apply(rewrite?.input, '/')).toBe('/app');
    expect(apply(rewrite?.input, '/app/projects')).toBe('/app/projects');
    expect(apply(rewrite?.input, '/sign-in')).toBe('/sign-in');
    expect(apply(rewrite?.input, '/pricing')).toBe('/pricing');
    expect(rewrite?.output).toBeUndefined();
  });

  it('maps site mode onto the home site around the dashboard', () => {
    const rewrite = homepageRewrite({ mode: 'site', projectId: 'home' }, true);
    expect(apply(rewrite?.input, '/')).toBe('/sites/home');
    expect(apply(rewrite?.input, '/pricing')).toBe('/sites/home/pricing');
    expect(apply(rewrite?.input, '/app')).toBe('/app');
    expect(apply(rewrite?.input, '/sites/other/x')).toBe('/sites/other/x');
    expect(apply(rewrite?.output, '/sites/home/guides')).toBe('/guides');
  });

  it('keeps /sites hrefs on a dashboard or preview document', () => {
    const rewrite = homepageRewrite({ mode: 'site', projectId: 'home' }, false);
    expect(apply(rewrite?.input, '/guides')).toBe('/sites/home/guides');
    expect(rewrite?.output).toBeUndefined();
  });
});
