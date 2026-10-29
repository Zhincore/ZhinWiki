// @vitest-environment jsdom
import { BrandProvider } from '@nibleaf/design-system/brand';
import { DEFAULT_BRAND } from '@nibleaf/shared/brand';
import type { ComponentType, ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options, useSearch: () => ({}) }),
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock('@/hooks/api/public', () => ({
  useGetPublicMeta: () => ({ isPending: false, data: { signupDisabled: false, providers: { google: false } } }),
}));
vi.mock('@/hooks/use-tenancy', () => ({ useTenancy: () => 'independent' }));
vi.mock('@/layouts/auth', () => ({ AuthLayout: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('@/services/auth-client', () => ({ authClient: {}, signIn: {} }));
vi.mock('@/lib/invitations', () => ({ readPendingInvitation: () => null }));

import { Route as SignInRoute } from './sign-in';
import { Route as SignUpRoute } from './sign-up';

const pages = {
  'sign-in': SignInRoute.options.component as unknown as ComponentType,
  'sign-up': SignUpRoute.options.component as unknown as ComponentType,
};

const legalLinks = (Page: ComponentType, brand = DEFAULT_BRAND) => {
  const container = document.createElement('div');
  container.innerHTML = renderToString(
    <BrandProvider brand={brand}>
      <Page />
    </BrandProvider>,
  );
  return Object.fromEntries(
    [...container.querySelectorAll('a')].map((link) => [link.textContent, [link.getAttribute('href'), link.getAttribute('target')]]),
  );
};

describe.each(Object.entries(pages))('%s legal notice', (_, Page) => {
  it('links the built-in pages by default, without a consent checkbox', () => {
    expect(legalLinks(Page)).toEqual({ 'auth.legal.terms': ['/terms', '_blank'], 'auth.legal.privacy': ['/privacy', '_blank'] });
    expect(renderToString(<Page />)).not.toContain('type="checkbox"');
  });

  it('links the operator pages when configured', () => {
    const brand = { ...DEFAULT_BRAND, termsUrl: 'https://acme.test/tos', privacyUrl: 'https://acme.test/privacy' };
    expect(legalLinks(Page, brand)).toEqual({
      'auth.legal.terms': ['https://acme.test/tos', '_blank'],
      'auth.legal.privacy': ['https://acme.test/privacy', '_blank'],
    });
  });
});
