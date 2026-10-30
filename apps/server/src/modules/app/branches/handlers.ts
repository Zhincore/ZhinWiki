import { Hono } from 'hono';
import { deleteBranch, listBranches } from '@/actions/branches';
import { assertProjectInOrg } from '@/actions/projects';
import { getContextOrganizationIdOrThrow, type HonoEnv } from '@/lib/hono/context';
import branchesRoutes from './routes';

const projectScope = async (ctx: { req: { param: (k: string) => string } }) => {
  const organizationId = getContextOrganizationIdOrThrow();
  const projectId = ctx.req.param('projectId');
  await assertProjectInOrg(organizationId, projectId);
  return projectId;
};

const app = new Hono<HonoEnv>()
  .get('/', ...branchesRoutes.list, async (ctx) => {
    const projectId = await projectScope(ctx);
    return ctx.json({ data: await listBranches(projectId) }, 200);
  })
  .delete('/:id', ...branchesRoutes.remove, async (ctx) => {
    const projectId = await projectScope(ctx);
    return ctx.json({ data: await deleteBranch(projectId, ctx.req.param('id')) }, 200);
  });

export default app;
