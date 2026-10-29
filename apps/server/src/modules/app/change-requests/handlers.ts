import {
  changeRequestParams,
  createChangeRequestBody,
  listChangeRequestsQuery,
  mergeChangeRequestBody,
  updateChangeRequestBody,
} from '@nibleaf/validators';
import { Hono } from 'hono';
import {
  createChangeRequest,
  getChangeRequest,
  getChangeRequestPageDiff,
  listChangeRequests,
  mergeChangeRequest,
  updateChangeRequest,
} from '@/actions/change-requests';
import { assertProjectInOrg } from '@/actions/projects';
import { getContextLocale, getContextOrganizationIdOrThrow, getContextUserOrThrow, type HonoEnv } from '@/lib/hono/context';
import { validator } from '@/lib/hono/validate';
import changeRequestsRoutes from './routes';

const projectScope = async (ctx: { req: { param: (k: string) => string } }) => {
  const projectId = ctx.req.param('projectId');
  await assertProjectInOrg(getContextOrganizationIdOrThrow(), projectId);
  return projectId;
};

const app = new Hono<HonoEnv>()
  .get('/', ...changeRequestsRoutes.list, validator('query', listChangeRequestsQuery), async (ctx) => {
    const projectId = await projectScope(ctx);
    return ctx.json({ data: await listChangeRequests(projectId, ctx.req.valid('query').status) }, 200);
  })
  .post('/', ...changeRequestsRoutes.create, validator('json', createChangeRequestBody), async (ctx) => {
    const projectId = await projectScope(ctx);
    const data = await createChangeRequest(projectId, ctx.req.valid('json'), getContextUserOrThrow(), getContextLocale());
    return ctx.json({ data }, 201);
  })
  .get('/:number', ...changeRequestsRoutes.get, validator('param', changeRequestParams), async (ctx) => {
    const projectId = await projectScope(ctx);
    return ctx.json({ data: await getChangeRequest(projectId, ctx.req.valid('param').number) }, 200);
  })
  .patch(
    '/:number',
    ...changeRequestsRoutes.update,
    validator('param', changeRequestParams),
    validator('json', updateChangeRequestBody),
    async (ctx) => {
      const projectId = await projectScope(ctx);
      return ctx.json({ data: await updateChangeRequest(projectId, ctx.req.valid('param').number, ctx.req.valid('json')) }, 200);
    },
  )
  .post(
    '/:number/merge',
    ...changeRequestsRoutes.merge,
    validator('param', changeRequestParams),
    validator('json', mergeChangeRequestBody),
    async (ctx) => {
      const projectId = await projectScope(ctx);
      const { number } = ctx.req.valid('param');
      const data = await mergeChangeRequest(projectId, number, getContextUserOrThrow().id, ctx.req.valid('json').force === true);
      return ctx.json({ data }, 200);
    },
  )
  .get('/:number/pages/:pageId/diff', ...changeRequestsRoutes.pageDiff, validator('param', changeRequestParams), async (ctx) => {
    const projectId = await projectScope(ctx);
    return ctx.json({ data: await getChangeRequestPageDiff(projectId, ctx.req.valid('param').number, ctx.req.param('pageId')) }, 200);
  });

export default app;
