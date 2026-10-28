import type { Tenancy } from '@nibleaf/shared/rbac';

/** Organization-plugin options per tenancy: single instances close the
 *  self-service org-create endpoint. */
export const organizationTenancyOptions = (tenancy: Tenancy) => ({ allowUserToCreateOrganization: tenancy === 'multi' });

type NewUser = { id: string; name?: string | null; email: string };

/** Sign-up hook: multi provisions a workspace; single only records the sign-up
 *  and never blocks it. */
export const onUserCreated =
  (tenancy: Tenancy, handlers: { provision: (user: NewUser, locale?: string) => Promise<void>; logSignup: (userId: string) => Promise<unknown> }) =>
  async (user: NewUser, locale?: string): Promise<void> => {
    if (tenancy === 'multi') {
      await handlers.provision(user, locale);
      return;
    }
    try {
      await handlers.logSignup(user.id);
    } catch {
      // never block sign-up
    }
  };
