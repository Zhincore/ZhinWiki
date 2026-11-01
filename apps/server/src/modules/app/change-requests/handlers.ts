import { logger } from '@nibleaf/logger';
import { changeRequestPolicy } from '@nibleaf/shared/rbac';
import {
  changeRequestHistoryQuery,
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
  listMergedChangeRequests,
  mergeChangeRequest,
  revertChangeRequest,
  updateChangeRequest,
} from '@/actions/change-requests';
import { createDeployment } from '@/actions/deployments';
import { assertProjectInOrg } from '@/actions/projects';
import { getContextLocale, getContextOrganizationIdOrThrow, getContextUserOrThrow, type HonoEnv, isContextContributor } from '@/lib/hono/context';
import { validator } from '@/lib/hono/validate';
import changeRequestsRoutes from './routes';

type ScopeContext = { req: { param: (k: string) => string } };

const scopedProject = (ctx: ScopeContext) => assertProjectInOrg(getContextOrganizationIdOrThrow(), ctx.req.param('projectId'));

const projectScope = async (ctx: ScopeContext) => (await scopedProject(ctx)).id;

/** Publish after a merge on wikis that publish on merge, like the Publish
 *  button. A failure never undoes the merge: `'failed'` is reported and later
 *  build failures show as failed deployments. Null when the wiki does not. */
const publishMerged = async (
  project: { id: string; organizationId: string; config: unknown },
  changeRequest: { number: number; title: string },
): Promise<'queued' | 'failed' | null> => {
  if (!changeRequestPolicy(project.config).publishOnMerge) return null;
  const message = `Merge #${changeRequest.number}: ${changeRequest.title}`.slice(0, 200);
  try {
    await createDeployment(project.organizationId, project.id, getContextUserOrThrow().id, { message }, getContextLocale(), true);
    return 'queued';
  } catch (error) {
    logger.warn({ error, projectId: project.id, number: changeRequest.number }, 'publish on merge failed; the change request stays merged');
    return 'failed';
  }
};

/** Notifications never fail the action that triggered them. */
const notify = (input: Omit<Parameters<typeof notifyChangeRequest>[0], 'actor' | 'locale'>) => {
  const user = getContextUserOrThrow();
  return notifyChangeRequest({ ...input, actor: user, locale: getContextLocale() }).catch(() => undefined);
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
  .get('/history', ...changeRequestsRoutes.history, validator('query', changeRequestHistoryQuery), async (ctx) => {
    const projectId = await projectScope(ctx);
    return ctx.json({ data: await listMergedChangeRequests(projectId, ctx.req.valid('query').cursor) }, 200);
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
      const project = await scopedProject(ctx);
      const projectId = project.id;
      const data = await mergeChangeRequest(projectId, ctx.req.valid('param').number, getContextUserOrThrow().id, ctx.req.valid('json').force ?? []);
      const publish = await publishMerged(project, data);
      await notify({ projectId, changeRequest: data, event: 'merged', recipients: [data.authorId] });
      return ctx.json({ data: { ...data, publish } }, 200);
    },
  )
  .post('/:number/revert', ...changeRequestsRoutes.revert, validator('param', changeRequestParams), async (ctx) => {
    const projectId = await projectScope(ctx);
    const data = await revertChangeRequest(projectId, ctx.req.valid('param').number, getContextUserOrThrow(), getContextLocale());
    return ctx.json({ data }, 201);
  })
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
