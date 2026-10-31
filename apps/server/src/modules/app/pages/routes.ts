import { errorResponses } from '@/errors/utils';
import { createRouteConfig } from '@/lib/hono/route-config';
import { isAuthenticated, requireProjectViewer } from '@/middlewares/guard';

const ok = { 200: { description: 'ok' }, ...errorResponses };
// Contributors read main and change requests and write only in their own (enforced in the handlers).
const viewer = [isAuthenticated, requireProjectViewer()] as const;

const pagesRoutes = {
  list: createRouteConfig({ guard: [...viewer], tags: ['pages'], description: "List a project's page tree.", responses: ok }),
  create: createRouteConfig({
    guard: [...viewer],
    tags: ['pages'],
    description: 'Create a page or group in a change request (pages on main are read-only).',
    responses: { 201: { description: 'created' }, ...errorResponses },
  }),
  get: createRouteConfig({ guard: [...viewer], tags: ['pages'], description: 'Retrieve a page (with content).', responses: ok }),
  update: createRouteConfig({ guard: [...viewer], tags: ['pages'], description: 'Update a page in a change request.', responses: ok }),
  remove: createRouteConfig({
    guard: [...viewer],
    tags: ['pages'],
    description: 'Delete a page (and its children) in a change request.',
    responses: ok,
  }),
  reorder: createRouteConfig({ guard: [...viewer], tags: ['pages'], description: 'Reorder / re-parent pages in a change request.', responses: ok }),
};

export default pagesRoutes;
