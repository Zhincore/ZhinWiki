import { MemberRole } from '@nibleaf/shared/constants';
import { errorResponses } from '@/errors/utils';
import { createRouteConfig } from '@/lib/hono/route-config';
import { isAuthenticated, requireProjectRole, requireProjectViewer } from '@/middlewares/guard';

const ok = { 200: { description: 'ok' }, ...errorResponses };
const editor = [isAuthenticated, requireProjectRole(MemberRole.MEMBER)] as const;
/** Members, and contributors on wikis that accept outside change requests. */
const viewer = [isAuthenticated, requireProjectViewer()] as const;
const tags = ['change-requests'];

const changeRequestsRoutes = {
  list: createRouteConfig({ guard: [...viewer], tags, description: "List a project's change requests.", responses: ok }),
  create: createRouteConfig({
    guard: [...viewer],
    tags,
    description: 'Open a change request on a copy of the default branch.',
    responses: { 201: { description: 'created' }, ...errorResponses },
  }),
  get: createRouteConfig({ guard: [...viewer], tags, description: 'Get a change request, its reviews and the pages it changes.', responses: ok }),
  update: createRouteConfig({
    guard: [...viewer],
    tags,
    description: "Update a change request's title, description or status. Contributors update only their own.",
    responses: ok,
  }),
  merge: createRouteConfig({
    guard: [...editor],
    tags,
    description:
      'Merge a change request into the default branch. Refused (409) without the required approvals or while a reviewer requests changes; conflicting pages return 409 unless forced.',
    responses: ok,
  }),
  pageDiff: createRouteConfig({
    guard: [...viewer],
    tags,
    description: "One page's Markdown on the default branch and in the change request.",
    responses: ok,
  }),
  reviewerCandidates: createRouteConfig({
    guard: [...editor],
    tags,
    description: 'Users who can be asked to review (name and avatar).',
    responses: ok,
  }),
  requestReview: createRouteConfig({ guard: [...editor], tags, description: 'Add a reviewer or ask them to review again.', responses: ok }),
  removeReviewer: createRouteConfig({ guard: [...editor], tags, description: 'Remove a reviewer; their verdict stops counting.', responses: ok }),
  submitReview: createRouteConfig({
    guard: [...editor],
    tags,
    description: 'Approve, request changes or comment.',
    responses: { 201: { description: 'created' }, ...errorResponses },
  }),
};

export default changeRequestsRoutes;
