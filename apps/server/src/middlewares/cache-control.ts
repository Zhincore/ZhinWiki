import type { MiddlewareHandler } from 'hono';
import type { HonoEnv } from '@/lib/hono/context';

/** Default every API response to `private, no-store` unless its handler chose a
 *  policy. A response that sets a cookie is never cacheable. */
export const cacheControl = (): MiddlewareHandler<HonoEnv> => async (ctx, next) => {
  await next();
  if (!ctx.res.headers.has('Cache-Control') || ctx.res.headers.has('Set-Cookie')) {
    ctx.header('Cache-Control', 'private, no-store');
  }
};
