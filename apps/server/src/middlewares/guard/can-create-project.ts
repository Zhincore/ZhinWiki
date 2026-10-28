import { prisma } from '@nibleaf/database';
import { canCreateWiki } from '@nibleaf/shared/rbac';
import type { MiddlewareHandler } from 'hono';
import { env } from '@/env';
import { forbidden } from '@/errors';
import { getContextUserOrThrow, type HonoEnv } from '@/lib/hono/context';

/**
 * Gate wiki creation by `canCreateWiki`: any signed-in user in multi tenancy
 * (no DB read), only platform admins in single (role read fresh from the DB).
 * Signed-in users without a wiki are contributors: they hold no Member row,
 * since any Member row reads drafts and private sites. Pair this AFTER
 * `isAuthenticated`.
 */
export const canCreateProject: MiddlewareHandler<HonoEnv> = async (_ctx, next) => {
  if (!canCreateWiki(env.TENANCY)) {
    const { id } = getContextUserOrThrow();
    const user = await prisma.user.findUnique({ where: { id }, select: { role: true } });
    if (!canCreateWiki(env.TENANCY, user?.role)) {
      throw forbidden('Only platform admins can create wikis on this instance.');
    }
  }
  await next();
};
