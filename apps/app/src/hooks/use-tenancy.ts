import { canCreateWiki, type Tenancy } from '@nibleaf/shared/rbac';
import { rootRouteId, useLoaderData, useRouteContext } from '@tanstack/react-router';
import { useSession } from '@/services/auth-client';

/** The instance tenancy the root route loaded from runtime env. */
export const useTenancy = (): Tenancy => useLoaderData({ from: rootRouteId }).tenancy;

/** Whether the signed-in user may create wikis. Only under `/app`; an unknown
 *  role counts as not allowed in shared tenancy. */
export const useCanCreateWiki = (): boolean => {
  const tenancy = useTenancy();
  const { routeSession } = useRouteContext({ from: '/app' });
  const { data: session, isPending } = useSession();
  return canCreateWiki(tenancy, (session ?? (isPending ? routeSession : null))?.user.role);
};
