// @vitest-environment jsdom
import { BrandProvider } from '@nibleaf/design-system/brand';
import { setMessageBrand } from '@nibleaf/i18n/brand';
import { DEFAULT_BRAND } from '@nibleaf/shared/brand';
import type { ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...props }: { to: string; children?: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('@/hooks/use-tenancy', () => ({ useTenancy: () => 'independent' }));

import { WelcomePage } from './welcome-page';
import type { WikiDirectoryEntry } from './wiki-directory';

const brand = { ...DEFAULT_BRAND, name: 'Acme Docs', sourceUrl: 'https://git.example/acme-docs' };

const render = (signedIn: boolean, wikis: WikiDirectoryEntry[] | null = null) => {
  setMessageBrand(brand);
  const container = document.createElement('div');
  container.innerHTML = renderToString(
    <BrandProvider brand={brand}>
      <WelcomePage signedIn={signedIn} wikis={wikis} />
    </BrandProvider>,
  );
  return container;
};

const hrefs = (container: HTMLElement) => [...container.querySelectorAll('a')].map((link) => link.getAttribute('href'));

afterEach(() => setMessageBrand(DEFAULT_BRAND));

describe('WelcomePage', () => {
  it('server-renders the brand, next steps and fork footer', () => {
    const page = render(false);

    expect(page.querySelector('h1')?.textContent).toContain('Acme Docs');
    expect(page.textContent).toContain('HOMEPAGE=site:<projectId>');
    expect(hrefs(page)).toEqual(['/sign-in', '/sign-up', 'https://git.example/acme-docs', 'https://github.com/lord007tn/nibleaf']);
    expect(page.querySelector('footer')?.textContent).toBe(
      `© ${new Date().getFullYear()} Acme Docs·Open source under AGPL-3.0·Source·A fork of Nibleaf`,
    );
  });

  it('offers the dashboard to a signed-in visitor', () => {
    expect(hrefs(render(true))[0]).toBe('/app');
  });

  it('lists the wiki directory only when one is loaded', () => {
    expect(render(false).querySelector('section')).toBeNull();
    const wikis = [{ id: 'p1', name: 'Handbook', description: null, icon: null, logo: null, url: 'https://wiki.example/handbook' }];
    expect(hrefs(render(false, wikis))).toContain('https://wiki.example/handbook');
  });
});
