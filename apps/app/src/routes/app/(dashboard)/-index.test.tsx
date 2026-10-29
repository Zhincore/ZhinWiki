// @vitest-environment jsdom

import { act, type ComponentType, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  projects: vi.fn(),
  analytics: vi.fn(),
  refetch: vi.fn(),
  search: {} as { newSite?: boolean },
  tenancy: 'independent' as 'shared' | 'independent',
  canCreate: true,
  dialog: vi.fn(),
}));
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options, useSearch: () => mocks.search }),
  Link: ({ to, params, children, className }: { to: string; params: { projectId: string }; children: ReactNode; className?: string }) => (
    <a className={className} href={to.replace('$projectId', params.projectId)}>
      {children}
    </a>
  ),
}));
vi.mock('@/hooks/api', () => ({
  useProjects: mocks.projects,
  useWorkspaceAnalytics: mocks.analytics,
  useCreateProject: () => ({ mutate: vi.fn() }),
}));
vi.mock('@/components/analytics/views-area-chart', () => ({ ViewsAreaChart: () => <div data-testid="views-chart" /> }));
vi.mock('@/components/app/new-project-dialog', () => ({ NewProjectDialog: mocks.dialog }));
vi.mock('@/hooks/use-tenancy', () => ({ useTenancy: () => mocks.tenancy, useCanCreateWiki: () => mocks.canCreate }));

import { Route } from './index';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const DashboardPage = Route.options.component as unknown as ComponentType;

describe('dashboard request recovery', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.search = {};
    mocks.tenancy = 'independent';
    mocks.canCreate = true;
    mocks.dialog.mockReturnValue(null);
    mocks.projects.mockReturnValue({
      isPending: false,
      data: [{ id: 'project-1', name: 'Docs', slug: 'docs', _count: { pages: 3, deployments: 1 } }],
      refetch: mocks.refetch,
    });
    mocks.analytics.mockReturnValue({
      isPending: false,
      data: { totalViews: 0, uniqueVisitors: 0, timeseries: [], byProject: [], availability: 'complete' },
      refetch: mocks.refetch,
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

  it('does not imply an empty account or zero analytics after failed initial requests', async () => {
    mocks.projects.mockReturnValue({ isPending: false, isError: true, refetch: mocks.refetch });
    mocks.analytics.mockReturnValue({ isPending: false, isError: true, refetch: mocks.refetch });
    await act(async () => root.render(<DashboardPage />));

    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(2);
    expect(container.textContent).not.toContain('dashboard.empty.title');
    expect(container.querySelectorAll('[data-slot="card-title"]')).toHaveLength(4);
    expect([...container.querySelectorAll('[data-slot="card-title"]')].map((card) => card.textContent)).toEqual(['—', '—', '—', '—']);
    expect(container.querySelector('[data-testid="views-chart"]')).toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>('[role="alert"] button')?.click());
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });

  it('uses a native link so a site is reachable by keyboard and browser link actions', async () => {
    await act(async () => root.render(<DashboardPage />));

    expect(container.querySelector('a[href="/app/projects/project-1"]')?.textContent).toContain('Docs');
  });

  it('keeps unavailable analytics unknown even when the endpoint returns a successful response', async () => {
    mocks.analytics.mockReturnValue({
      isPending: false,
      data: { totalViews: 0, uniqueVisitors: 0, timeseries: [], byProject: [], availability: 'unavailable' },
    });
    await act(async () => root.render(<DashboardPage />));

    const values = [...container.querySelectorAll('[data-slot="card-title"]')].map((card) => card.textContent);
    expect(values.slice(2)).toEqual(['—', '—']);
    expect(container.textContent).toContain('analytics.state.unavailable.title');
    expect(container.querySelector('[data-testid="views-chart"]')).toBeNull();
  });
});

describe('dashboard wiki creation gate', () => {
  let container: HTMLDivElement;
  let root: Root;
  const buttons = () => [...container.querySelectorAll('button')].map((button) => button.textContent?.trim());

  beforeEach(() => {
    mocks.search = { newSite: true };
    mocks.tenancy = 'shared';
    mocks.canCreate = false;
    mocks.dialog.mockReturnValue(null);
    mocks.projects.mockReturnValue({ isPending: false, data: [], refetch: mocks.refetch });
    mocks.analytics.mockReturnValue({ isPending: true, refetch: mocks.refetch });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it('shows a contributor with no wikis only the empty state, without analytics or create actions', async () => {
    await act(async () => root.render(<DashboardPage />));

    expect(container.textContent).toContain('dashboard.empty.contributor.title');
    expect(container.querySelectorAll('[data-slot="card-title"]')).toHaveLength(0);
    expect(container.querySelector('[data-testid="views-chart"]')).toBeNull();
    expect(mocks.analytics).toHaveBeenCalledWith('30d', { enabled: false });
    expect(buttons()).toEqual([]);
    expect(mocks.dialog).not.toHaveBeenCalled();
  });

  it('holds back workspace analytics for a contributor until their wikis load', async () => {
    mocks.projects.mockReturnValue({ isPending: true, data: undefined, refetch: mocks.refetch });
    await act(async () => root.render(<DashboardPage />));

    expect(mocks.analytics).toHaveBeenCalled();
    expect(mocks.analytics).not.toHaveBeenCalledWith('30d', { enabled: true });
  });

  it('keeps the dashboard for a contributor invited to a wiki, without create actions', async () => {
    mocks.projects.mockReturnValue({ isPending: false, data: [{ id: 'project-1', name: 'Docs', slug: 'docs', _count: { pages: 1 } }] });
    await act(async () => root.render(<DashboardPage />));

    expect(container.querySelector('a[href="/app/projects/project-1"]')).not.toBeNull();
    expect(mocks.analytics).toHaveBeenCalledWith('30d', { enabled: true });
    expect(buttons()).not.toContain('dashboard.newProject');
    expect(mocks.dialog).not.toHaveBeenCalled();
  });

  it('offers an admin the first wiki and honours ?newSite', async () => {
    mocks.canCreate = true;
    await act(async () => root.render(<DashboardPage />));

    expect(buttons()).toContain('dashboard.empty.firstWiki.cta');
    expect(mocks.dialog).toHaveBeenLastCalledWith(expect.objectContaining({ open: true }), undefined);
  });
});
