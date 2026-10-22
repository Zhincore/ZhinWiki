import { ghostImportBody, mintlifyImportBody } from '@nibleaf/validators';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getLatestImportRun, startImportRun } from '@/actions/import-runs';
import { importers } from '@/actions/importers';
import { badRequest } from '@/errors';
import { getContextOrganizationIdOrThrow, getContextUserOrThrow, type HonoEnv } from '@/lib/hono/context';
import { validator } from '@/lib/hono/validate';
import importsRoutes from './routes';

/** Ghost exports ship the whole site in one JSON document — allow up to 15 MB. */
const GHOST_MAX_BODY_BYTES = 15 * 1024 * 1024;

// organizationId is the PROJECT's own org (resolved from :projectId by the guards),
// mirroring the project-settings module. Mounted under /projects/:projectId/settings/import.
// Imports run in the background: POST answers 202 with the run, GET /runs/latest reports it.
const app = new Hono<HonoEnv>()
  .get('/runs/latest', ...importsRoutes.latestRun, async (ctx) => {
    const projectId = ctx.req.param('projectId') ?? '';
    return ctx.json({ data: await getLatestImportRun(projectId) }, 200);
  })
  .post('/mintlify', ...importsRoutes.mintlify, validator('json', mintlifyImportBody), async (ctx) => {
    const organizationId = getContextOrganizationIdOrThrow();
    const user = getContextUserOrThrow();
    // Always present — the module is mounted under /projects/:projectId/settings/import.
    const projectId = ctx.req.param('projectId') ?? '';
    const input = ctx.req.valid('json');
    const run = await startImportRun({
      projectId,
      userId: user.id,
      source: 'mintlify',
      task: () => importers.mintlify.run({ organizationId, projectId, input }),
    });
    return ctx.json({ data: run }, 202);
  })
  .post(
    '/ghost',
    ...importsRoutes.ghost,
    bodyLimit({
      maxSize: GHOST_MAX_BODY_BYTES,
      onError: () => {
        throw badRequest('The Ghost export is larger than 15 MB. Split the export and try again.');
      },
    }),
    validator('json', ghostImportBody),
    async (ctx) => {
      const organizationId = getContextOrganizationIdOrThrow();
      const user = getContextUserOrThrow();
      const projectId = ctx.req.param('projectId') ?? '';
      const input = ctx.req.valid('json');
      const run = await startImportRun({
        projectId,
        userId: user.id,
        source: 'ghost',
        task: () => importers.ghost.run({ organizationId, projectId, input }),
      });
      return ctx.json({ data: run }, 202);
    },
  );

export default app;
