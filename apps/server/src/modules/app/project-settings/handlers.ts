import { MemberRole } from '@nibleaf/shared/constants';
import { roleAtLeast } from '@nibleaf/shared/rbac';
import { searchIndexDiagnosticsQuery, updateProjectSearchConfigurationBody, updateWorkspaceSettingsBody } from '@nibleaf/validators';
import { Hono } from 'hono';
import { z } from 'zod';
import { aiDraftAvailable } from '@/actions/ai';
import { importFromGitProvider } from '@/actions/git-import';
import { rotateGitWebhookSecret } from '@/actions/git-webhook';
import { createNotificationsForOrgMembers } from '@/actions/notifications';
import {
  createProjectSearchReindex,
  getProjectSearchConfiguration,
  getProjectSearchIndexDiagnostics,
  updateProjectSearchConfiguration,
} from '@/actions/search';
import { getProjectUsageSummary } from '@/actions/usage';
import { getWorkspaceSettings, updateWorkspaceSettings } from '@/actions/workspace';
import { env } from '@/env';
import { answerSearchAvailable } from '@/lib/ai-search/runtime';
import { envExtras } from '@/lib/env-extras';
import { getContextMembership, getContextOrganizationIdOrThrow, getContextUserOrThrow, type HonoEnv } from '@/lib/hono/context';
import { validator } from '@/lib/hono/validate';
import projectSettingsRoutes from './routes';

/** Env-enforced limits shown read-only in the Usage tab; null when the feature is off. */
const instanceLimits = () => ({
  aiDraftsPerDay: aiDraftAvailable() ? envExtras.AI_DAILY_LIMIT : null,
  aiAnswersPerDay: answerSearchAvailable() ? env.SEARCH_ANSWER_DAILY_PER_PROJECT : null,
  exportsPerDay: env.EXPORT_MAX_DAILY_PER_PROJECT,
  exportsActive: env.EXPORT_MAX_ACTIVE_PER_PROJECT,
  exportPages: env.EXPORT_MAX_PAGES,
  exportBytes: String(env.EXPORT_MAX_SNAPSHOT_BYTES),
});

// organizationId here is the PROJECT's own org (resolved from :projectId by the
// guards), so these reuse the org-scoped settings actions but operate per-site.
const app = new Hono<HonoEnv>()
  .get('/', ...projectSettingsRoutes.get, async (ctx) => {
    const organizationId = getContextOrganizationIdOrThrow();
    const settings = await getWorkspaceSettings(organizationId);
    // The push-webhook secret is admin material (it authenticates deploy
    // triggers); the GET is member-level, so strip it below ADMIN. The UI
    // hides the webhook card for those members anyway.
    const parsedGit = z.record(z.string(), z.unknown()).safeParse(settings.git);
    if (!roleAtLeast(getContextMembership()?.role ?? '', MemberRole.ADMIN) && parsedGit.success) {
      const { webhookSecret: _webhookSecret, ...git } = parsedGit.data;
      settings.git = git;
    }
    return ctx.json({ data: settings }, 200);
  })
  .patch('/', ...projectSettingsRoutes.update, validator('json', updateWorkspaceSettingsBody), async (ctx) => {
    const organizationId = getContextOrganizationIdOrThrow();
    return ctx.json({ data: await updateWorkspaceSettings(organizationId, ctx.req.valid('json')) }, 200);
  })
  .post('/git/import', ...projectSettingsRoutes.gitImport, async (ctx) => {
    const organizationId = getContextOrganizationIdOrThrow();
    const user = getContextUserOrThrow();
    // Always present — the module is mounted under /projects/:projectId/settings.
    const projectId = ctx.req.param('projectId') ?? '';
    const summary = await importFromGitProvider(organizationId, projectId);
    // Tell the acting admin's fellow members (bell inbox). Best-effort.
    await createNotificationsForOrgMembers(
      projectId,
      {
        type: 'import_completed',
        title: 'Content import completed',
        body: `${summary.imported} pages imported and ${summary.updated} updated from the connected Git repository.`,
        href: `/app/projects/${projectId}`,
      },
      user.id,
    ).catch(() => undefined);
    return ctx.json({ data: summary }, 200);
  })
  // Generate/rotate the push-to-deploy webhook secret. Server-side generation
  // only — the settings PATCH schema cannot set it (see gitConfigSchema note).
  .post('/git/webhook-secret', ...projectSettingsRoutes.gitWebhookSecret, async (ctx) => {
    const organizationId = getContextOrganizationIdOrThrow();
    return ctx.json({ data: { webhookSecret: await rotateGitWebhookSecret(organizationId) } }, 200);
  })
  .get('/usage', ...projectSettingsRoutes.usage, async (ctx) => {
    const projectId = ctx.req.param('projectId') ?? '';
    return ctx.json({ data: { ...(await getProjectUsageSummary(ctx, projectId)), limits: instanceLimits() } }, 200);
  })
  .get('/search', ...projectSettingsRoutes.searchConfiguration, async (ctx) =>
    ctx.json({ data: await getProjectSearchConfiguration(ctx, ctx.req.param('projectId') ?? '') }, 200),
  )
  .patch('/search', ...projectSettingsRoutes.updateSearchConfiguration, validator('json', updateProjectSearchConfigurationBody), async (ctx) =>
    ctx.json({ data: await updateProjectSearchConfiguration(ctx, ctx.req.param('projectId') ?? '', ctx.req.valid('json')) }, 200),
  )
  .get('/search/diagnostics', ...projectSettingsRoutes.searchIndexDiagnostics, validator('query', searchIndexDiagnosticsQuery), async (ctx) =>
    ctx.json({ data: await getProjectSearchIndexDiagnostics(ctx, ctx.req.param('projectId') ?? '', ctx.req.valid('query')) }, 200),
  )
  .post('/search/reindex', ...projectSettingsRoutes.createSearchReindex, async (ctx) =>
    ctx.json({ data: await createProjectSearchReindex(ctx, ctx.req.param('projectId') ?? '') }, 202),
  );

export default app;
