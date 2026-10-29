import { describe, expect, it } from 'vitest';
import { buildSiteRedirectHref } from './site-redirect-href';

describe('buildSiteRedirectHref', () => {
  it('preserves configured query and fragment under the app base path', () => {
    expect(buildSiteRedirectHref({ target: '/guide?campaign=launch#install', lang: 'ar', basePath: '/sites/project-1' })).toBe(
      '/sites/project-1/guide?campaign=launch&lang=ar#install',
    );
  });

  it('keeps an explicitly selected locale and uses the custom-domain root', () => {
    expect(buildSiteRedirectHref({ target: '/guide?lang=en#top', lang: 'ar', basePath: '' })).toBe('/guide?lang=en#top');
  });

  it('normalizes trailing slashes and handles the site root', () => {
    expect(buildSiteRedirectHref({ target: '/guide///', basePath: '/sites/project-1' })).toBe('/sites/project-1/guide');
    expect(buildSiteRedirectHref({ target: '/', basePath: '/sites/project-1' })).toBe('/sites/project-1');
    expect(buildSiteRedirectHref({ target: '/', basePath: '' })).toBe('/');
  });

  it('stays under a shared-tenancy wiki slug', () => {
    expect(buildSiteRedirectHref({ target: '/guide', lang: 'ar', basePath: '/handbook' })).toBe('/handbook/guide?lang=ar');
    expect(buildSiteRedirectHref({ target: '/', basePath: '/handbook' })).toBe('/handbook');
  });
});
