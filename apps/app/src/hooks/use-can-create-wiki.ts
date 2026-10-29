import { canCreateWiki } from '@nibleaf/shared/rbac';
import { useRouteContext } from '@tanstack/react-router';
import { useTenancy } from '@/hooks/use-tenancy';
import { useSession } from '@/services/auth-client';

/** Whether the signed-in user may create wikis. Only under `/app`; an unknown
 *  role counts as not allowed in shared tenancy. */
export const useCanCreateWiki = (): boolean => {
  const tenancy = useTenancy();
  const { routeSession } = useRouteContext({ from: '/app' });
  const { data: session, isPending } = useSession();
  return canCreateWiki(tenancy, (session ?? (isPending ? routeSession : null))?.user.role);
};
