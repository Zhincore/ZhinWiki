// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDeletePage } from './mutations';
import { queryKeys } from './query-keys';

const mocks = vi.hoisted(() => ({ remove: vi.fn() }));

vi.mock('@/services/api', () => ({
  api: { app: { projects: { ':projectId': { pages: { ':id': { $delete: mocks.remove } } } } } },
}));

describe('page mutations on a change request branch', () => {
  const projectId = 'project-a';
  let container: HTMLDivElement;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement('div');
    document.body.append(container);
    mocks.remove.mockImplementation(
      async () => new Response(JSON.stringify({ data: { id: 'page' } }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
  });

  afterEach(() => {
    container.remove();
    vi.clearAllMocks();
  });

  const run = async (branchId: string | null) => {
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    let mutate: () => Promise<unknown> = () => Promise.reject(new Error('mutation hook was not ready'));
    function Probe() {
      const remove = useDeletePage(projectId, branchId);
      mutate = () => remove.mutateAsync('page');
      return null;
    }
    const root = createRoot(container);
    await act(async () => root.render(createElement(QueryClientProvider, { client: queryClient }, createElement(Probe))));
    await act(async () => {
      await mutate();
    });
    act(() => root.unmount());
    return invalidate;
  };

  it('refreshes change requests after an edit on their branch', async () => {
    expect(await run('branch')).toHaveBeenCalledWith({ queryKey: queryKeys.changeRequests.all(projectId) });
  });

  it('leaves change requests alone for pages on main', async () => {
    expect(await run(null)).not.toHaveBeenCalledWith({ queryKey: queryKeys.changeRequests.all(projectId) });
  });
});
