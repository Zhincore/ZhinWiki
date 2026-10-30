import { createBranchBody } from '@nibleaf/validators';
import { Hono } from 'hono';
import { createBranch, deleteBranch, getDefaultBranch, listBranches } from '@/actions/branches';
import { changeRequestNumberForBranch, defaultChangeRequestTitle, mergeChangeRequest } from '@/actions/change-requests';
import { assertProjectInOrg } from '@/actions/projects';
import { getContextLocale, getContextOrganizationIdOrThrow, getContextUserOrThrow, type HonoEnv } from '@/lib/hono/context';
import { validator } from '@/lib/hono/validate';
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
  .post('/', ...branchesRoutes.create, validator('json', createBranchBody), async (ctx) => {
    const projectId = await projectScope(ctx);
    const user = getContextUserOrThrow();
    const branch = await createBranch(projectId, {
      name: ctx.req.valid('json').name,
      title: defaultChangeRequestTitle(user.name, getContextLocale()),
      authorId: user.id,
    });
    return ctx.json({ data: branch }, 201);
  })
  .post('/:id/merge', ...branchesRoutes.merge, async (ctx) => {
    const projectId = await projectScope(ctx);
    const number = await changeRequestNumberForBranch(projectId, ctx.req.param('id'));
    await mergeChangeRequest(projectId, number, getContextUserOrThrow().id, []);
    return ctx.json({ data: await getDefaultBranch(projectId) }, 200);
  })
  .delete('/:id', ...branchesRoutes.remove, async (ctx) => {
    const projectId = await projectScope(ctx);
    return ctx.json({ data: await deleteBranch(projectId, ctx.req.param('id')) }, 200);
  });

export default app;
