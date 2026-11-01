import { confirmAssetBody, presignAssetBody, uploadAssetHeaders, uploadAssetQuery } from '@nibleaf/validators';
import { Hono } from 'hono';
import { confirmAsset, listAssets, presignAsset, uploadContributorAsset } from '@/actions/assets';
import { assertProjectInOrg } from '@/actions/projects';
import { forbidden } from '@/errors';
import { getContextOrganizationIdOrThrow, getContextUserOrThrow, type HonoEnv, isContextContributor } from '@/lib/hono/context';
import { validator } from '@/lib/hono/validate';
import assetsRoutes from './routes';

const scope = async (ctx: { req: { param: (k: string) => string } }) => {
  const organizationId = getContextOrganizationIdOrThrow();
  const projectId = ctx.req.param('projectId');
  await assertProjectInOrg(organizationId, projectId);
  return { organizationId, projectId };
};

const app = new Hono<HonoEnv>()
  .get('/', ...assetsRoutes.list, async (ctx) => {
    const { projectId } = await scope(ctx);
    return ctx.json({ data: await listAssets(projectId) }, 200);
  })
  .post('/presign', ...assetsRoutes.presign, validator('json', presignAssetBody), async (ctx) => {
    const { organizationId, projectId } = await scope(ctx);
    return ctx.json({ data: await presignAsset(organizationId, projectId, ctx.req.valid('json')) }, 200);
  })
  .post('/confirm', ...assetsRoutes.confirm, validator('json', confirmAssetBody), async (ctx) => {
    const { organizationId, projectId } = await scope(ctx);
    const user = getContextUserOrThrow();
    return ctx.json({ data: await confirmAsset(organizationId, projectId, user.id, ctx.req.valid('json')) }, 201);
  })
  .post('/upload', ...assetsRoutes.upload, validator('query', uploadAssetQuery), validator('header', uploadAssetHeaders), async (ctx) => {
    const { organizationId, projectId } = await scope(ctx);
    if (!isContextContributor()) {
      throw forbidden('Members upload through presign and confirm.');
    }
    const asset = await uploadContributorAsset(organizationId, projectId, getContextUserOrThrow().id, {
      filename: ctx.req.valid('query').filename,
      contentType: ctx.req.valid('header')['content-type'],
      request: ctx.req.raw,
    });
    return ctx.json({ data: asset }, 201);
  });

export default app;
