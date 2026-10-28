import { beforeEach, describe, expect, it, vi } from 'vitest';

type Session = { user: { role?: string | null } } | null;
const state = vi.hoisted(() => ({
  tenancy: 'single' as 'single' | 'multi',
  routeSession: null as Session,
  session: undefined as Session | undefined,
  isPending: false,
}));

vi.mock('@tanstack/react-router', () => ({
  rootRouteId: '__root__',
  useLoaderData: () => ({ tenancy: state.tenancy }),
  useRouteContext: () => ({ routeSession: state.routeSession }),
}));
vi.mock('@/services/auth-client', () => ({ useSession: () => ({ data: state.session, isPending: state.isPending }) }));

import { useCanCreateWiki } from './use-tenancy';

describe('useCanCreateWiki', () => {
  beforeEach(() => {
    state.tenancy = 'single';
    state.routeSession = { user: { role: 'admin' } };
    state.session = undefined;
    state.isPending = false;
  });

  it('allows everyone in multi tenancy', () => {
    state.tenancy = 'multi';
    state.routeSession = null;
    expect(useCanCreateWiki()).toBe(true);
  });

  it('allows a platform admin in single tenancy', () => {
    state.session = { user: { role: 'admin' } };
    expect(useCanCreateWiki()).toBe(true);
  });

  it.each(['user', 'editor', null])('denies platform role %s in single tenancy', (role) => {
    state.session = { user: { role } };
    expect(useCanCreateWiki()).toBe(false);
  });

  it('uses the route session while the client session loads', () => {
    state.isPending = true;
    expect(useCanCreateWiki()).toBe(true);
    state.routeSession = { user: {} };
    expect(useCanCreateWiki()).toBe(false);
  });

  it('denies once the client session is gone, whatever the route session said', () => {
    state.session = null;
    expect(useCanCreateWiki()).toBe(false);
  });
});
