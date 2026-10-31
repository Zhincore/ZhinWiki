import { createPageBody, listPagesQuery, reorderPagesBody, updatePageBody } from '@nibleaf/validators';
import { Hono } from 'hono';
import { assertBranchReadable, assertPagesEditable } from '@/actions/branches';
import { createPage, deletePage, getPage, listPages, reorderPages, updatePage } from '@/actions/pages';
import { assertProjectInOrg } from '@/actions/projects';
import { getContextOrganizationIdOrThrow, getContextUserOrThrow, type HonoEnv, isContextContributor } from '@/lib/hono/context';
import { validator } from '@/lib/hono/validate';
import pagesRoutes from './routes';

const projectScope = async (ctx: { req: { param: (k: string) => string } }) => {
  const organizationId = getContextOrganizationIdOrThrow();
  const projectId = ctx.req.param('projectId');
  await assertProjectInOrg(organizationId, projectId);
  return projectId;
};

/** Contributors write only in their own change requests. */
const writer = () => (isContextContributor() ? getContextUserOrThrow().id : undefined);

const app = new Hono<HonoEnv>()
  .get('/', ...pagesRoutes.list, validator('query', listPagesQuery), async (ctx) => {
    const projectId = await projectScope(ctx);
    const { languageId, branchId } = ctx.req.valid('query');
    if (branchId && isContextContributor()) await assertBranchReadable(projectId, branchId);
    return ctx.json({ data: await listPages(projectId, languageId, branchId) }, 200);
  })
  .post('/', ...pagesRoutes.create, validator('json', createPageBody), async (ctx) => {
    const projectId = await projectScope(ctx);
    const body = ctx.req.valid('json');
    await assertPagesEditable(projectId, body.parentId ? { pageIds: [body.parentId] } : { branchId: body.branchId }, writer());
    const page = await createPage(projectId, body, getContextUserOrThrow().id);
    return ctx.json({ data: page }, 201);
  })
  .post('/reorder', ...pagesRoutes.reorder, validator('json', reorderPagesBody), async (ctx) => {
    const projectId = await projectScope(ctx);
    const body = ctx.req.valid('json');
    await assertPagesEditable(projectId, { pageIds: body.items.map((item) => item.id) }, writer());
    return ctx.json({ data: await reorderPages(projectId, body) }, 200);
  })
  .get('/:id', ...pagesRoutes.get, async (ctx) => {
    const projectId = await projectScope(ctx);
    const page = await getPage(projectId, ctx.req.param('id'));
    if (isContextContributor()) await assertBranchReadable(projectId, page.branchId);
    return ctx.json({ data: page }, 200);
  })
  .patch('/:id', ...pagesRoutes.update, validator('json', updatePageBody), async (ctx) => {
    const projectId = await projectScope(ctx);
    await assertPagesEditable(projectId, { pageIds: [ctx.req.param('id')] }, writer());
    const page = await updatePage(projectId, ctx.req.param('id'), ctx.req.valid('json'), getContextUserOrThrow().id);
    return ctx.json({ data: page }, 200);
  })
  .delete('/:id', ...pagesRoutes.remove, async (ctx) => {
    const projectId = await projectScope(ctx);
    await assertPagesEditable(projectId, { pageIds: [ctx.req.param('id')] }, writer());
    return ctx.json({ data: await deletePage(projectId, ctx.req.param('id')) }, 200);
  });

export default app;
