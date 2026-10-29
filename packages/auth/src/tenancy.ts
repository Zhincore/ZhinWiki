import type { Tenancy } from '@nibleaf/shared/rbac';

/** Organization-plugin options per tenancy: shared instances close the
 *  self-service org-create endpoint. */
export const organizationTenancyOptions = (tenancy: Tenancy) => ({ allowUserToCreateOrganization: tenancy === 'independent' });

type NewUser = { id: string; name?: string | null; email: string };

type SignupHandlers = {
  provision: (user: NewUser, locale?: string) => Promise<void>;
  logSignup: (userId: string) => Promise<unknown>;
  onLogFailure: (error: unknown, userId: string) => void;
};

/** Sign-up hook: independent provisions a workspace; shared only records the sign-up
 *  and reports a failed record without blocking the sign-up. */
export const onUserCreated =
  (tenancy: Tenancy, handlers: SignupHandlers) =>
  async (user: NewUser, locale?: string): Promise<void> => {
    if (tenancy === 'independent') {
      await handlers.provision(user, locale);
      return;
    }
    try {
      await handlers.logSignup(user.id);
    } catch (error) {
      handlers.onLogFailure(error, user.id);
    }
  };
