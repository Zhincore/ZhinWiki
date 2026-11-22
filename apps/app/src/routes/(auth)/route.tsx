import { createFileRoute, Outlet, redirect, useLocation, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { AuthProviders } from '@/components/auth-providers';
import { getSessionFn } from '@/functions/session';
import { QueryProvider } from '@/integrations/tanstack-query/root-provider';
import { safeReturnPath } from '@/lib/return-path';
import { useSession } from '@/services/auth-client';

/** Where a signed-in user goes: the page that sent them to sign in, else the app. */
const afterAuthHref = (search: Record<string, unknown>) => safeReturnPath(search.redirect) ?? '/app';

export const Route = createFileRoute('/(auth)')({
  beforeLoad: async ({ location }) => {
    if (await getSessionFn()) throw redirect({ href: afterAuthHref(location.search) });
  },
  // Keep every auth utility page (sign-in/up, forgot/reset password, verify
  // email) out of search indexes — some carry live tokens in the URL. Children
  // inherit this; per-page heads only add a title.
  head: () => ({
    meta: [{ name: 'robots', content: 'noindex, nofollow' }],
  }),
  component: AuthRoute,
});

/** Reverse guard: an authenticated user can never see sign-in/up — sent on. */
function AuthRoute() {
  return (
    <QueryProvider>
      <AuthProviders>
        <AuthGuard />
      </AuthProviders>
    </QueryProvider>
  );
}

function AuthGuard() {
  const { data: session } = useSession();
  const { search } = useLocation();
  const navigate = useNavigate();
  const target = session ? afterAuthHref(search) : null;
  useEffect(() => {
    if (target) void navigate({ href: target, replace: true });
  }, [navigate, target]);

  // Do not replace the outlet while better-auth revalidates on window focus.
  // Unmounting here erased the email/OTP step when users switched to their inbox.
  if (target) return null;
  return <Outlet />;
}
