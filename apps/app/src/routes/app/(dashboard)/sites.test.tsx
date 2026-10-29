// @vitest-environment jsdom

import type { Locale, MessageKey, MessageVariables } from '@nibleaf/i18n';
import { act, type ComponentType } from 'react';
import { createRoot, hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const i18n = vi.hoisted(() => ({ locale: 'en' as string }));
const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  useProjects: vi.fn(),
  refetch: vi.fn(),
  search: {} as { newSite?: boolean },
  tenancy: 'independent' as 'shared' | 'independent',
  canCreate: true,
  dialog: vi.fn(),
}));

// Real catalogs, controlled locale: the page count must come out translated and
// in the locale's own digits (Arabic-Indic for ar), not as a raw number.
vi.mock('@nibleaf/i18n/react', async () => {
  const { translateFn } = await vi.importActual<typeof import('@nibleaf/i18n')>('@nibleaf/i18n');
  const useLocale = () => ({
    locale: i18n.locale as Locale,
    setLocale: vi.fn(),
    t: (key: MessageKey, variables?: MessageVariables) => translateFn(key, variables, i18n.locale as Locale),
  });
  return { useLocale, useT: () => useLocale().t };
});
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options, useSearch: () => mocks.search }),
  useNavigate: () => mocks.navigate,
}));
vi.mock('@/hooks/api', () => ({ useProjects: mocks.useProjects }));
vi.mock('@/components/app/new-project-dialog', () => ({ NewProjectDialog: mocks.dialog }));
vi.mock('@/hooks/use-tenancy', () => ({ useTenancy: () => mocks.tenancy, useCanCreateWiki: () => mocks.canCreate }));

import { Route } from './sites';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const SitesPage = Route.options.component as unknown as ComponentType;

describe('SitesPage', () => {
  let container: HTMLDivElement;
  let root: Root;

  const render = async () => {
    await act(async () => root.render(<SitesPage />));
  };

  beforeEach(() => {
    i18n.locale = 'en';
    mocks.search = {};
    mocks.tenancy = 'independent';
    mocks.canCreate = true;
    mocks.dialog.mockReturnValue(null);
    mocks.useProjects.mockReturnValue({
      isPending: false,
      isError: false,
      isFetching: false,
      refetch: mocks.refetch,
      data: [{ id: 'project-1', name: 'Docs', slug: 'docs', _count: { pages: 58, deployments: 3 } }],
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it('shows the site page count through the translated count message', async () => {
    await render();

    expect(container.textContent).toContain('58 pages');
  });

  it('hydrates the loading boundary before rendering an already-cached project query', async () => {
    const readyQuery = mocks.useProjects();
    await act(async () => root.unmount());
    mocks.useProjects.mockReturnValue({ isPending: true, isError: false, isFetching: true, data: undefined, refetch: mocks.refetch });
    container.innerHTML = renderToString(<SitesPage />);
    mocks.useProjects.mockReturnValue(readyQuery);
    const recoverableErrors = vi.fn();
    await act(async () => {
      root = hydrateRoot(container, <SitesPage />, { onRecoverableError: recoverableErrors });
    });
    expect(recoverableErrors).not.toHaveBeenCalled();
    expect(container.textContent).toContain('58 pages');
  });

  it('gives the site filter an explicit accessible name', async () => {
    await render();

    const search = container.querySelector<HTMLInputElement>('input[type="search"]');
    expect(search?.getAttribute('aria-label')).toBeTruthy();
  });

  it('formats the page count in Western digits for the Arabic interface', async () => {
    i18n.locale = 'ar';
    await render();

    expect(container.textContent).toContain('58 صفحة');
    expect(container.textContent).not.toMatch(/[٠-٩]/);
  });

  it('shows a recoverable error instead of a first-site prompt when loading fails', async () => {
    mocks.useProjects.mockReturnValue({ isPending: false, isError: true, data: undefined, refetch: mocks.refetch });
    await render();

    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(container.textContent).not.toContain('Create your first');
    await act(async () => alert?.querySelector<HTMLButtonElement>('button')?.click());
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });

  it('distinguishes an unmatched search and lets the user restore existing sites', async () => {
    await render();
    const search = container.querySelector<HTMLInputElement>('input[type="search"]');
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    await act(async () => {
      setValue?.call(search, 'nothing-matches');
      search?.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(container.textContent).toContain('No sites match your search.');
    const clear = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Clear search');
    expect(clear).toBeDefined();
    await act(async () => clear?.click());
    expect(container.textContent).toContain('58 pages');
    expect(search?.value).toBe('');
  });

  it('hides every create action from a shared-instance contributor and ignores ?newSite', async () => {
    mocks.search = { newSite: true };
    mocks.tenancy = 'shared';
    mocks.canCreate = false;
    mocks.useProjects.mockReturnValue({ isPending: false, isError: false, data: [], refetch: mocks.refetch });
    await render();

    expect(container.querySelectorAll('button')).toHaveLength(0);
    expect(mocks.dialog).not.toHaveBeenCalled();
  });
});
