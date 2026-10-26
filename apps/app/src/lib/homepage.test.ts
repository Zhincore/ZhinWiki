import type { LocationRewriteFunction } from '@tanstack/react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatHomepage, type Homepage, homepageRewrite, isDashboardPath, isHomeSiteDocument, isMarketingPath, parseHomepage } from './homepage';

const apply = (rewrite: LocationRewriteFunction | undefined, path: string): string => {
  const url = new URL(path, 'https://docs.example');
  const next = rewrite?.({ url }) ?? url;
  return new URL(next).pathname;
};

describe('parseHomepage', () => {
  it('reads the three modes and defaults to marketing', () => {
    expect(parseHomepage(undefined)).toEqual({ mode: 'marketing' });
    expect(parseHomepage(' ')).toEqual({ mode: 'marketing' });
    expect(parseHomepage('app')).toEqual({ mode: 'app' });
    expect(parseHomepage('site:cmvjwvut6000207p0h2sfrxuv')).toEqual({ mode: 'site', projectId: 'cmvjwvut6000207p0h2sfrxuv' });
  });

  it('refuses anything else', () => {
    expect(() => parseHomepage('wiki')).toThrow(/Invalid HOMEPAGE/);
    expect(() => parseHomepage('site:../x')).toThrow(/Invalid HOMEPAGE/);
  });
});

describe('isDashboardPath', () => {
  it('keeps dashboard, auth and runtime paths out of the home wiki', () => {
    for (const path of ['/app', '/app/projects/x', '/sign-in', '/accept-invite/abc', '/api/app/me', '/sites/p1', '/_serverFn/x']) {
      expect(isDashboardPath(path)).toBe(true);
    }
  });

  it('leaves wiki pages to the site, even ones that start like a dashboard path', () => {
    for (const path of ['/', '/guides', '/application-notes', '/sign-installation', '/pricing']) {
      expect(isDashboardPath(path)).toBe(false);
    }
  });
});

describe('isMarketingPath', () => {
  it('matches the upstream marketing pages only', () => {
    expect(isMarketingPath('/')).toBe(true);
    expect(isMarketingPath('/blog/some-post')).toBe(true);
    expect(isMarketingPath('/compare/gitbook')).toBe(true);
    expect(isMarketingPath('/blogroll')).toBe(false);
    expect(isMarketingPath('/app')).toBe(false);
  });
});

describe('formatHomepage', () => {
  it('round-trips through parseHomepage', () => {
    for (const value of ['marketing', 'app', 'site:p1']) {
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
  it('leaves the marketing homepage alone', () => {
    expect(homepageRewrite({ mode: 'marketing' }, false)).toBeUndefined();
  });

  it('sends app mode root to the dashboard and marketing pages to an unmatched path, reversibly', () => {
    const rewrite = homepageRewrite({ mode: 'app' }, false);
    expect(apply(rewrite?.input, '/')).toBe('/app');
    expect(apply(rewrite?.input, '/app/projects')).toBe('/app/projects');
    expect(apply(rewrite?.input, '/sign-in')).toBe('/sign-in');
    const pricing = apply(rewrite?.input, '/pricing');
    expect(pricing).not.toBe('/pricing');
    expect(apply(rewrite?.output, pricing)).toBe('/pricing');
    expect(apply(rewrite?.output, '/app')).toBe('/app');
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
