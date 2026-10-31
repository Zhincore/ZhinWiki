import {
  changeRequestParams,
  changeRequestReviewerBody,
  changeRequestReviewerParams,
  createChangeRequestBody,
  listChangeRequestsQuery,
  mergeChangeRequestBody,
  submitChangeRequestReviewBody,
  updateChangeRequestBody,
} from '@nibleaf/validators';
import { Hono } from 'hono';
import { notifyChangeRequest } from '@/actions/change-request-notifications';
import { listReviewerCandidates, removeReviewer, requestReview, submitReview } from '@/actions/change-request-reviews';
import {
  createChangeRequest,
  getChangeRequest,
  getChangeRequestPageDiff,
  listChangeRequests,
  mergeChangeRequest,
  updateChangeRequest,
} from '@/actions/change-requests';
import { assertProjectInOrg } from '@/actions/projects';
import { getContextLocale, getContextOrganizationIdOrThrow, getContextUserOrThrow, type HonoEnv, isContextContributor } from '@/lib/hono/context';
import { validator } from '@/lib/hono/validate';
import changeRequestsRoutes from './routes';

const projectScope = async (ctx: { req: { param: (k: string) => string } }) => {
  const projectId = ctx.req.param('projectId');
  await assertProjectInOrg(getContextOrganizationIdOrThrow(), projectId);
  return projectId;
};

/** Notifications never fail the action that triggered them. */
const notify = (input: Omit<Parameters<typeof notifyChangeRequest>[0], 'actor' | 'locale'>) => {
  const user = getContextUserOrThrow();
  return notifyChangeRequest({ ...input, actor: { id: user.id, name: user.name }, locale: getContextLocale() }).catch(() => undefined);
};

const app = new Hono<HonoEnv>()
  .get('/', ...changeRequestsRoutes.list, validator('query', listChangeRequestsQuery), async (ctx) => {
    const projectId = await projectScope(ctx);
    return ctx.json({ data: await listChangeRequests(projectId, getContextOrganizationIdOrThrow(), ctx.req.valid('query').status) }, 200);
  })
  .post('/', ...changeRequestsRoutes.create, validator('json', createChangeRequestBody), async (ctx) => {
    const projectId = await projectScope(ctx);
    const data = await createChangeRequest(projectId, ctx.req.valid('json'), getContextUserOrThrow(), {
      locale: getContextLocale(),
      contributor: isContextContributor(),
    });
    return ctx.json({ data }, 201);
  })
  .get('/reviewer-candidates', ...changeRequestsRoutes.reviewerCandidates, async (ctx) => {
    await projectScope(ctx);
    return ctx.json({ data: await listReviewerCandidates(getContextOrganizationIdOrThrow()) }, 200);
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
      const contributorId = isContextContributor() ? getContextUserOrThrow().id : undefined;
      const data = await updateChangeRequest(projectId, ctx.req.valid('param').number, ctx.req.valid('json'), contributorId);
      return ctx.json({ data }, 200);
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
      const data = await mergeChangeRequest(projectId, number, getContextUserOrThrow().id, ctx.req.valid('json').force ?? []);
      await notify({ projectId, changeRequest: data, event: 'merged', recipients: [data.authorId] });
      return ctx.json({ data }, 200);
    },
  )
  .post(
    '/:number/reviewers',
    ...changeRequestsRoutes.requestReview,
    validator('param', changeRequestParams),
    validator('json', changeRequestReviewerBody),
    async (ctx) => {
      const projectId = await projectScope(ctx);
      const { userId } = ctx.req.valid('json');
      const changeRequest = await requestReview(projectId, ctx.req.valid('param').number, userId, getContextUserOrThrow().id);
      await notify({ projectId, changeRequest, event: 'reviewRequested', recipients: [userId] });
      return ctx.json({ data: { userId } }, 200);
    },
  )
  .delete('/:number/reviewers/:userId', ...changeRequestsRoutes.removeReviewer, validator('param', changeRequestReviewerParams), async (ctx) => {
    const projectId = await projectScope(ctx);
    const { number, userId } = ctx.req.valid('param');
    await removeReviewer(projectId, number, userId);
    return ctx.json({ data: { userId } }, 200);
  })
  .post(
    '/:number/reviews',
    ...changeRequestsRoutes.submitReview,
    validator('param', changeRequestParams),
    validator('json', submitChangeRequestReviewBody),
    async (ctx) => {
      const projectId = await projectScope(ctx);
      const body = ctx.req.valid('json');
      const { changeRequest, previous } = await submitReview(projectId, ctx.req.valid('param').number, getContextUserOrThrow().id, body);
      if (body.state !== 'COMMENTED' && body.state !== previous) {
        const event = body.state === 'APPROVED' ? 'approved' : 'changesRequested';
        await notify({ projectId, changeRequest, event, recipients: [changeRequest.authorId] });
      }
      return ctx.json({ data: { state: body.state } }, 201);
    },
  )
  .get('/:number/pages/:pageId/diff', ...changeRequestsRoutes.pageDiff, validator('param', changeRequestParams), async (ctx) => {
    const projectId = await projectScope(ctx);
    return ctx.json({ data: await getChangeRequestPageDiff(projectId, ctx.req.valid('param').number, ctx.req.param('pageId')) }, 200);
  });

export default app;
