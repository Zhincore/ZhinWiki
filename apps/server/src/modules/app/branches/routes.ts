import { MemberRole } from '@nibleaf/shared/constants';
import { errorResponses } from '@/errors/utils';
import { createRouteConfig } from '@/lib/hono/route-config';
import { isAuthenticated, requireProjectMember, requireProjectRole } from '@/middlewares/guard';

const ok = { 200: { description: 'ok' }, ...errorResponses };
const editor = [isAuthenticated, requireProjectRole(MemberRole.MEMBER)] as const;

const branchesRoutes = {
  list: createRouteConfig({
    guard: [isAuthenticated, requireProjectMember()],
    tags: ['branches'],
    description: "List a project's branches.",
    responses: ok,
  }),
  remove: createRouteConfig({ guard: [...editor], tags: ['branches'], description: 'Delete a non-default branch.', responses: ok }),
};

export default branchesRoutes;
