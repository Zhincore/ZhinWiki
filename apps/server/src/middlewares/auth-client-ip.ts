import { AUTH_CLIENT_IP_HEADER } from '@nibleaf/auth/server';
import type { Context } from 'hono';
import type { HonoEnv } from '@/lib/hono/context';
import { resolveClientKey } from './rate-limit';

/**
 * The request for Better Auth, carrying the client address resolved like the
 * API's own rate limits. Any client-sent copy of the header is replaced, and
 * dropped when no address is known.
 */
export const withAuthClientIp = (ctx: Context<HonoEnv>): Request => {
  const headers = new Headers(ctx.req.raw.headers);
  const ip = resolveClientKey(ctx);
  if (ip === 'unknown') {
    headers.delete(AUTH_CLIENT_IP_HEADER);
  } else {
    headers.set(AUTH_CLIENT_IP_HEADER, ip);
  }
  return new Request(ctx.req.raw, { headers });
};
