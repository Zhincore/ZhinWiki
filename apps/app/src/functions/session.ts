import { auth } from '@nibleaf/auth/server';
import { createServerFn } from '@tanstack/react-start';
import { getRequestHeaders } from '@tanstack/react-start/server';
import { serverEnv } from '@/env.server';

export const getSessionFn = createServerFn({ method: 'GET' }).handler(async () => {
  try {
    return await auth.api.getSession({ headers: getRequestHeaders() });
  } catch {
    return null;
  }
});

/** Whether a session belongs to an operator's support access (Better Auth impersonation). */
export const isSupportSession = (session: unknown): boolean =>
  Boolean((session as { session?: { impersonatedBy?: string | null } } | null)?.session?.impersonatedBy);

/** The operator console origin (`ADMIN_URL`), returned only to a support session. */
export const getSupportAdminUrlFn = createServerFn({ method: 'GET' }).handler(async () => {
  try {
    const session = await auth.api.getSession({ headers: getRequestHeaders() });
    return isSupportSession(session) ? serverEnv.ADMIN_URL : null;
  } catch {
    return null;
  }
});
