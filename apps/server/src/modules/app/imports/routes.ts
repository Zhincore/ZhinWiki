import { MemberRole } from '@nibleaf/shared/constants';
import { errorResponses } from '@/errors/utils';
import { createRouteConfig } from '@/lib/hono/route-config';
import { isAuthenticated, requireProjectRole } from '@/middlewares/guard';

const ok = { 200: { description: 'ok' }, ...errorResponses };
const accepted = { 202: { description: 'Import run started' }, ...errorResponses };

// One-way content imports from other documentation systems (Mintlify, GitBook, Ghost, …).
// Admin-gated like the Git import — importing rewrites pages and site settings.
// Each import runs in the background; at most one is active per project.
const importsRoutes = {
  latestRun: createRouteConfig({
    guard: [isAuthenticated, requireProjectRole(MemberRole.ADMIN)],
    tags: ['projects'],
    description: "The project's most recent content import run: status, summary, and warnings.",
    responses: ok,
  }),
  mintlify: createRouteConfig({
    guard: [isAuthenticated, requireProjectRole(MemberRole.ADMIN)],
    tags: ['projects'],
    description: 'Start an import of pages and site settings from a public Mintlify GitHub repository (docs.json or mint.json).',
    responses: accepted,
  }),
  gitbook: createRouteConfig({
    guard: [isAuthenticated, requireProjectRole(MemberRole.ADMIN)],
    tags: ['projects'],
    description: 'Start an import of pages, assets, and redirects from a public GitBook Git Sync GitHub repository (.gitbook.yaml / SUMMARY.md).',
    responses: accepted,
  }),
  ghost: createRouteConfig({
    guard: [isAuthenticated, requireProjectRole(MemberRole.ADMIN)],
    tags: ['projects'],
    description: 'Start an import of published posts and pages from a Ghost JSON export.',
    responses: accepted,
  }),
};

export default importsRoutes;
