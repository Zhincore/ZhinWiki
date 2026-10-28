import { type Brand, DEFAULT_BRAND } from '@nibleaf/shared/brand';
import type { ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ brand: undefined as unknown as Brand, siteMatch: false }));

vi.mock('@tanstack/react-router', () => ({
  createRootRoute: (options: { component: ComponentType }) => ({
    options,
    useLoaderData: () => ({ brand: state.brand, homepage: { mode: 'welcome' }, urls: { appUrl: 'https://docs.example.test' } }),
  }),
  HeadContent: () => <link rel="stylesheet" href="/app.css" />,
  Outlet: () => null,
  Scripts: () => null,
  ScriptOnce: () => null,
  useRouter: () => ({ options: {} }),
  useRouterState: ({ select }: { select: (routerState: unknown) => unknown }) =>
    select({
      matches: state.siteMatch
        ? [
            {
              routeId: '/sites/$projectId',
              params: { projectId: 'project-1' },
              loaderData: { site: { languages: [{ code: 'en', isDefault: true }], activeLanguage: 'en', project: { config: null } } },
            },
          ]
        : [],
      location: { search: {} },
    }),
}));
vi.mock('@/functions/brand', () => ({ getBrandFn: vi.fn() }));
vi.mock('@/functions/tenancy', () => ({ getTenancyFn: vi.fn() }));
vi.mock('@/lib/site-origin', () => ({ currentHomepage: vi.fn() }));
vi.mock('@/lib/public-urls', () => ({
  PUBLIC_URL_META: { appUrl: 'nibleaf-app-url', siteBaseDomain: 'nibleaf-site-base-domain' },
  publicUrls: vi.fn(),
}));
vi.mock('@/styles.css?url', () => ({ default: '/app.css' }));

const { Route } = await import('./__root');

const renderRoot = () => {
  const Root = (Route as unknown as { options: { component: ComponentType } }).options.component;
  return renderToStaticMarkup(<Root />);
};

const ACCENT = { light: '#2563eb', dark: '#60a5fa' };

describe('root document brand accent', () => {
  beforeEach(() => {
    state.brand = DEFAULT_BRAND;
    state.siteMatch = false;
  });

  it('keeps the built-in accent when BRAND_ACCENT_COLOR is unset', () => {
    expect(renderRoot()).not.toContain('<style');
  });

  it('overrides the dashboard accent after the stylesheet', () => {
    state.brand = { ...DEFAULT_BRAND, accentColor: ACCENT };
    const html = renderRoot();
    expect(html).toMatch(/<link rel="stylesheet" href="\/app.css"\/><style>:root:not\(\.dark\)\{--primary:#2563eb;/);
    expect(html).toContain(':root.dark{--primary:#60a5fa;');
  });

  it('leaves published sites on their own theme', () => {
    state.brand = { ...DEFAULT_BRAND, accentColor: ACCENT };
    state.siteMatch = true;
    expect(renderRoot()).not.toContain('<style');
  });
});
