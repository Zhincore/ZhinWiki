// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

const custom = vi.hoisted(() => ({ domain: false }));
vi.mock('@/lib/site-paths', () => ({ isCustomDomainSite: () => custom.domain }));

import { siteNavigationHref } from './site-link-navigation';

const appHost = { href: 'http://app.test/sites/p1/guide', origin: 'http://app.test', pathname: '/sites/p1/guide', search: '' };
const domain = { href: 'https://docs.acme.test/guide', origin: 'https://docs.acme.test', pathname: '/guide', search: '' };

/** The router href for a click on a child of an anchor; `init` sets anchor attributes and click modifiers. */
const routed = (href: string, init: { attrs?: Record<string, string>; event?: MouseEventInit } = {}) => {
  const location = custom.domain ? domain : appHost;
  const anchor = document.createElement('a');
  anchor.href = new URL(href, location.href).href;
  for (const [name, value] of Object.entries(init.attrs ?? {})) anchor.setAttribute(name, value);
  const label = document.createElement('span');
  anchor.append(label);
  const event = new MouseEvent('click', { bubbles: true, button: 0, ...init.event });
  Object.defineProperty(event, 'target', { value: label });
  return siteNavigationHref(event, 'p1', location);
};

afterEach(() => {
  custom.domain = false;
});

describe('siteNavigationHref', () => {
  it('routes links to other pages of the same site on the app host', () => {
    expect(routed('/sites/p1/setup?lang=ar#install')).toBe('/sites/p1/setup?lang=ar#install');
    expect(routed('/sites/p1/%D8%A7%D9%84%D8%A8%D8%AF%D8%A7%D9%8A%D8%A9')).toBe('/sites/p1/%D8%A7%D9%84%D8%A8%D8%AF%D8%A7%D9%8A%D8%A9');
    expect(routed('/sites/p1/guide')).toBe('/sites/p1/guide');
  });

  it('routes site pages on a custom domain but not app-owned paths', () => {
    custom.domain = true;
    expect(routed('/setup')).toBe('/setup');
    expect(routed('/api/public/assets/projects/p1/x')).toBeNull();
    expect(routed('/_serverFn/x')).toBeNull();
  });

  it('leaves other sites, other origins, and files to the browser', () => {
    expect(routed('/sites/p2/guide')).toBeNull();
    expect(routed('/app/projects')).toBeNull();
    expect(routed('https://example.com/sites/p1/guide')).toBeNull();
    expect(routed('/sites/p1/guide.md')).toBeNull();
  });

  it('leaves in-page anchors, new tabs, downloads, and modified clicks to the browser', () => {
    expect(routed('/sites/p1/guide#section')).toBeNull();
    expect(routed('/sites/p1/setup', { attrs: { target: '_blank' } })).toBeNull();
    expect(routed('/sites/p1/setup', { attrs: { download: '' } })).toBeNull();
    expect(routed('/sites/p1/setup', { event: { ctrlKey: true } })).toBeNull();
    expect(routed('/sites/p1/setup', { event: { button: 1 } })).toBeNull();
  });

  it('ignores clicks another handler already handled', () => {
    const anchor = document.createElement('a');
    anchor.href = 'http://app.test/sites/p1/setup';
    const event = new MouseEvent('click', { cancelable: true, button: 0 });
    event.preventDefault();
    Object.defineProperty(event, 'target', { value: anchor });
    expect(siteNavigationHref(event, 'p1', appHost)).toBeNull();
  });
});
