// @vitest-environment jsdom
import { BrandProvider } from '@nibleaf/design-system/brand';
import { setMessageBrand } from '@nibleaf/i18n/brand';
import { DEFAULT_BRAND } from '@nibleaf/shared/brand';
import type { ComponentType, ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...props }: { to: string; children?: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

import { PrivacyPage } from './privacy-page';
import { TermsPage } from './terms-page';

const brand = {
  ...DEFAULT_BRAND,
  name: 'Acme Docs',
  supportEmail: 'help@acme.test',
  abuseEmail: 'abuse@acme.test',
  sourceUrl: 'https://git.acme.test/docs',
};

const render = (Page: ComponentType, pageBrand = brand) => {
  setMessageBrand(pageBrand);
  const container = document.createElement('div');
  container.innerHTML = renderToString(
    <BrandProvider brand={pageBrand}>
      <Page />
    </BrandProvider>,
  );
  return container;
};

const hrefs = (container: HTMLElement) => [...container.querySelectorAll('a')].map((link) => link.getAttribute('href'));

afterEach(() => setMessageBrand(DEFAULT_BRAND));

describe('TermsPage', () => {
  it('names the operator, both contacts and the AGPL source', () => {
    const page = render(TermsPage);

    expect(page.querySelector('h1')?.textContent).toBe('Terms of Service');
    expect(page.querySelector('header')?.textContent).toBe('Acme Docs');
    expect(page.textContent).toContain('Acme Docs is run by the operator of this instance');
    expect(hrefs(page)).toEqual(
      expect.arrayContaining(['mailto:help@acme.test', 'mailto:abuse@acme.test', 'https://git.acme.test/docs', '/terms', '/privacy']),
    );
    expect(page.querySelector('footer')?.textContent).toContain('Open source under AGPL-3.0');
  });
});

describe('PrivacyPage', () => {
  it('names the operator and support contact', () => {
    const page = render(PrivacyPage);

    expect(page.querySelector('h1')?.textContent).toBe('Privacy Policy');
    expect(page.textContent).toContain('Acme Docs is run by the operator of this instance');
    expect(hrefs(page)).toContain('mailto:help@acme.test');
    expect(page.querySelector('article')?.getAttribute('lang')).toBe('en');
  });

  it('cross-links the operator legal pages when configured', () => {
    const page = render(PrivacyPage, { ...brand, termsUrl: 'https://acme.test/tos', privacyUrl: 'https://acme.test/privacy' });

    expect(hrefs(page)).toEqual(expect.arrayContaining(['https://acme.test/tos', 'https://acme.test/privacy']));
  });
});
