import { MemberRole } from '@nibleaf/shared/constants';
import { errorResponses } from '@/errors/utils';
import { createRouteConfig } from '@/lib/hono/route-config';
import { isAuthenticated, requireProjectRole } from '@/middlewares/guard';

const ok = { 200: { description: 'ok' }, ...errorResponses };
const editor = [isAuthenticated, requireProjectRole(MemberRole.MEMBER)] as const;
const tags = ['change-requests'];

const changeRequestsRoutes = {
  list: createRouteConfig({ guard: [...editor], tags, description: "List a project's change requests.", responses: ok }),
  create: createRouteConfig({
    guard: [...editor],
    tags,
    description: 'Open a change request on a copy of the default branch.',
    responses: { 201: { description: 'created' }, ...errorResponses },
  }),
  get: createRouteConfig({ guard: [...editor], tags, description: 'Get a change request and the pages it changes.', responses: ok }),
  update: createRouteConfig({ guard: [...editor], tags, description: "Update a change request's title, description or status.", responses: ok }),
  merge: createRouteConfig({
    guard: [...editor],
    tags,
    description: 'Merge a change request into the default branch. Conflicting pages return 409 unless forced.',
    responses: ok,
  }),
  pageDiff: createRouteConfig({
    guard: [...editor],
    tags,
    description: "One page's Markdown on the default branch and in the change request.",
    responses: ok,
  }),
};

export default changeRequestsRoutes;
