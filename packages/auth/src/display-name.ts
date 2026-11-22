import { USER_NAME_MAX_LENGTH } from '@nibleaf/shared/constants';
import { APIError, createAuthMiddleware } from 'better-auth/api';

const NAME_PATHS = new Set(['/update-user', '/sign-in/email-otp']);

/** Trims a submitted display name and rejects empty or over-long values. */
export const enforceDisplayName = createAuthMiddleware(async (context) => {
  if (!NAME_PATHS.has(context.path)) return;
  const body = context.body as { name?: unknown } | undefined;
  if (body?.name === undefined) return;
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name.length === 0 || name.length > USER_NAME_MAX_LENGTH) {
    throw new APIError('BAD_REQUEST', { code: 'INVALID_NAME', message: `Name must be 1 to ${USER_NAME_MAX_LENGTH} characters.` });
  }
  return { context: { body: { ...body, name } } };
});
