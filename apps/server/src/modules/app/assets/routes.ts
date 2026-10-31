import { errorResponses } from '@/errors/utils';
import { createRouteConfig } from '@/lib/hono/route-config';
import { isAuthenticated, requireProjectMember, requireProjectViewer } from '@/middlewares/guard';

const ok = { 200: { description: 'ok' }, ...errorResponses };
// Contributors may upload images for their own change requests (limits enforced in the actions).
const uploader = [isAuthenticated, requireProjectViewer()] as const;

const assetsRoutes = {
  list: createRouteConfig({
    guard: [isAuthenticated, requireProjectMember()],
    tags: ['assets'],
    description: 'List uploaded assets.',
    responses: ok,
  }),
  presign: createRouteConfig({ guard: [...uploader], tags: ['assets'], description: 'Presign a direct upload URL.', responses: ok }),
  confirm: createRouteConfig({
    guard: [...uploader],
    tags: ['assets'],
    description: 'Record an uploaded asset.',
    responses: { 201: { description: 'created' }, ...errorResponses },
  }),
};

export default assetsRoutes;
