import { type Asset, type Prisma, prisma } from '@nibleaf/database';
import { logger } from '@nibleaf/logger';
import { newId } from '@nibleaf/shared/ids';
import { slugify } from '@nibleaf/shared/utils';
import { deleteObject, getObjectStream, headObject, presignPutUrl, putObject } from '@nibleaf/storage';
import { assetExtensionForContentType, type ConfirmAssetBody, MAX_SVG_BYTES, type PresignAssetBody, SVG_CONTENT_TYPE } from '@nibleaf/validators';
import { AppError, badRequest, forbidden } from '@/errors';
import { OPEN_CHANGE_REQUEST_STATUSES } from '@/lib/change-request-status';
import { sniffImageType } from '@/lib/image-type';
import { sanitizeSvg } from '@/lib/svg';
import { assertProjectInOrg, resolveWikiRole } from './projects';

/** Outside contributors upload images only while they have an open change
 *  request, each at most 5 MB and 50 MB in total per wiki. */
const CONTRIBUTOR_MAX_ASSET_BYTES = 5 * 1024 * 1024;
const CONTRIBUTOR_ASSET_QUOTA_BYTES = 50 * 1024 * 1024;

const assetPrefix = (projectId: string): string => `projects/${projectId}/assets/`;

/** A fresh key named after the upload; the extension follows the stored type, never the client's name. */
const assetKey = (projectId: string, filename: string, contentType: string): string => {
  const dot = filename.lastIndexOf('.');
  const base = slugify(dot > -1 ? filename.slice(0, dot) : filename) || 'file';
  const ext = assetExtensionForContentType(contentType);
  return `${assetPrefix(projectId)}${newId()}-${base}${ext ? `.${ext}` : ''}`;
};

const importedAssetKey = (projectId: string, importId: string, filename: string): string => {
  const dot = filename.lastIndexOf('.');
  const ext = dot > -1 ? filename.slice(dot + 1).toLowerCase() : '';
  const base = slugify(dot > -1 ? filename.slice(0, dot) : filename) || 'file';
  return `${assetPrefix(projectId)}imports/${slugify(importId)}-${base}${ext ? `.${ext}` : ''}`;
};

/** Guard against IDOR: a client-supplied key must live under this project's asset prefix. */
const assertOwnedKey = (projectId: string, key: string): void => {
  if (!key.startsWith(assetPrefix(projectId))) {
    throw badRequest('Invalid asset key', { key });
  }
};

// Assets are served by the API proxy (GET /api/public/assets/<key>) — a stable,
// browser-reachable, same-origin URL that needs no anonymous-bucket access or
// presigned-URL expiry. The server streams the object from storage internally.
const publicUrlForKey = (key: string): string => `/api/public/assets/${key}`;

/** Store bytes that were produced server-side (for example, a remote image
 * fetched by an importer) through the same Asset model and stable public URL
 * used by browser uploads. */
export const storeAsset = async ({
  projectId,
  filename,
  contentType,
  bytes,
  createdById = null,
  importId,
}: {
  projectId: string;
  filename: string;
  contentType: string;
  bytes: Uint8Array;
  createdById?: string | null;
  /** Stable source identifier used by importers to make repeated imports idempotent. */
  importId?: string;
}) => {
  const key = importId ? importedAssetKey(projectId, importId, filename) : assetKey(projectId, filename, contentType);
  const stored = contentType === SVG_CONTENT_TYPE ? sanitizeSvg(bytes) : bytes;
  if (!stored) throw badRequest('The file is not a valid SVG image.');
  await putObject(key, stored, contentType);
  return prisma.asset.upsert({
    where: { key },
    create: { projectId, key, url: publicUrlForKey(key), contentType, size: stored.byteLength, createdById },
    update: { contentType, size: stored.byteLength },
  });
};

export const findImportedAsset = async (projectId: string, importId: string, filename: string): Promise<Asset | null> =>
  await prisma.asset.findUnique({ where: { key: importedAssetKey(projectId, importId, filename) } });

export const presignAsset = async (organizationId: string, projectId: string, body: PresignAssetBody) => {
  await assertProjectInOrg(organizationId, projectId);
  const key = assetKey(projectId, body.filename, body.contentType);
  const uploadUrl = await presignPutUrl({ key, contentType: body.contentType });
  return { key, uploadUrl };
};

/**
 * Browsers upload straight to storage, so an SVG is first seen here: read it
 * back, sanitize it, and overwrite the object. Returns the stored size.
 */
const sanitizeUploadedSvg = async (key: string): Promise<number> => {
  const head = await headObject(key).catch(() => null);
  if (!head || (head.ContentLength ?? 0) > MAX_SVG_BYTES) {
    await deleteObject(key).catch(() => undefined);
    throw badRequest('SVG images can be at most 5 MB.', { key });
  }
  const chunks: Buffer[] = [];
  for await (const chunk of await getObjectStream(key)) chunks.push(Buffer.from(chunk as Uint8Array));
  const clean = sanitizeSvg(Buffer.concat(chunks));
  if (!clean) {
    await deleteObject(key).catch(() => undefined);
    throw badRequest('The file is not a valid SVG image.', { key });
  }
  await putObject(key, clean, SVG_CONTENT_TYPE);
  return clean.byteLength;
};

export const confirmAsset = async (organizationId: string, projectId: string, userId: string, body: ConfirmAssetBody) => {
  await assertProjectInOrg(organizationId, projectId);
  assertOwnedKey(projectId, body.key);
  const size = body.contentType === SVG_CONTENT_TYPE ? await sanitizeUploadedSvg(body.key) : body.size;
  return prisma.asset.create({
    data: { projectId, key: body.key, url: publicUrlForKey(body.key), contentType: body.contentType, size, createdById: userId },
  });
};

const fileTooLarge = () =>
  new AppError({
    code: 'assets:file_too_large',
    message: 'Contributors can upload images of at most 5 MB.',
    details: { limit: CONTRIBUTOR_MAX_ASSET_BYTES },
  });

/** Read a request body, refusing it as soon as it passes `limit` bytes whatever its Content-Length says.
 *  Hono's `bodyLimit` trusts a present Content-Length and does not count the bytes. */
const readBodyWithin = async (request: Request, limit: number): Promise<Buffer> => {
  if (!request.headers.has('transfer-encoding') && Number(request.headers.get('content-length')) > limit) {
    throw fileTooLarge();
  }
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (let read = await reader.read(); !read.done; read = await reader.read()) {
      total += read.value.byteLength;
      if (total > limit) throw fileTooLarge();
      chunks.push(read.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks, total);
};

const assertWithinQuota = async (client: Prisma.TransactionClient, projectId: string, userId: string, size: number): Promise<void> => {
  const used = (await client.asset.aggregate({ where: { projectId, createdById: userId }, _sum: { size: true } }))._sum.size ?? 0;
  if (used + size > CONTRIBUTOR_ASSET_QUOTA_BYTES) {
    throw new AppError({
      code: 'assets:quota_exceeded',
      message: 'Contributors can upload at most 50 MB of images per wiki.',
      details: { limit: CONTRIBUTOR_ASSET_QUOTA_BYTES },
    });
  }
};

/**
 * Store an outside contributor's image sent through the API. The body is
 * capped while streaming, raster types are checked by magic bytes and SVG is
 * sanitized; the quota is rechecked under a per-uploader lock and the object
 * is deleted when recording it fails.
 */
export const uploadContributorAsset = async (
  organizationId: string,
  projectId: string,
  userId: string,
  { filename, contentType, request }: { filename: string; contentType: string; request: Request },
) => {
  await assertProjectInOrg(organizationId, projectId);
  const open = await prisma.changeRequest.count({ where: { projectId, authorId: userId, status: { in: [...OPEN_CHANGE_REQUEST_STATUSES] } } });
  if (open === 0) {
    throw forbidden('Open a change request before uploading images.');
  }
  const bytes = await readBodyWithin(request, CONTRIBUTOR_MAX_ASSET_BYTES);
  const stored = contentType === SVG_CONTENT_TYPE ? sanitizeSvg(bytes) : bytes;
  const storedType = contentType === SVG_CONTENT_TYPE ? SVG_CONTENT_TYPE : sniffImageType(bytes);
  if (!(stored && storedType)) {
    throw badRequest('The file is not a supported image.');
  }
  await assertWithinQuota(prisma, projectId, userId, stored.byteLength);
  const key = assetKey(projectId, filename, storedType);
  await putObject(key, stored, storedType);
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`asset-quota:${projectId}:${userId}`}))`;
      await assertWithinQuota(tx, projectId, userId, stored.byteLength);
      return tx.asset.create({
        data: { projectId, key, url: publicUrlForKey(key), contentType: storedType, size: stored.byteLength, createdById: userId },
      });
    });
  } catch (error) {
    await deleteObject(key).catch(() => undefined);
    throw error;
  }
};

export const listAssets = async (projectId: string): Promise<Asset[]> =>
  await prisma.asset.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' }, take: 200 });

/** Uploads younger than this may still be on their way into an open change request's page. */
const IN_FLIGHT_UPLOAD_MS = 60 * 60 * 1000;

/**
 * Once an outside contributor's change request closes, delete their uploads to
 * the wiki that no page on the default branch or in an open change request, nor
 * the wiki config, references. Members' uploads stay. Never throws: failures
 * are logged.
 */
export const cleanupContributorAssets = async (projectId: string, userId: string): Promise<void> => {
  try {
    const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { organizationId: true, config: true } });
    if (await resolveWikiRole(userId, project.organizationId)) return;
    const stillOpen = await prisma.changeRequest.count({ where: { projectId, authorId: userId, status: { in: [...OPEN_CHANGE_REQUEST_STATUSES] } } });
    const assets = await prisma.asset.findMany({
      where: { projectId, createdById: userId, ...(stillOpen > 0 ? { createdAt: { lt: new Date(Date.now() - IN_FLIGHT_UPLOAD_MS) } } : {}) },
      select: { id: true, key: true },
    });
    if (assets.length === 0) return;
    const pages = await prisma.page.findMany({
      where: {
        projectId,
        branch: { OR: [{ isDefault: true }, { changeRequest: { status: { in: [...OPEN_CHANGE_REQUEST_STATUSES] } } }] },
        OR: assets.flatMap(({ key }) => [{ content: { contains: key } }, { icon: { contains: key } }]),
      },
      select: { content: true, icon: true },
    });
    const texts = [JSON.stringify(project.config ?? null), ...pages.flatMap((page) => [page.content, page.icon ?? ''])];
    for (const asset of assets.filter(({ key }) => !texts.some((text) => text.includes(key)))) {
      try {
        await deleteObject(asset.key);
        await prisma.asset.delete({ where: { id: asset.id } });
      } catch (error) {
        logger.warn({ error, projectId, key: asset.key }, 'contributor asset cleanup failed');
      }
    }
  } catch (error) {
    logger.warn({ error, projectId, userId }, 'contributor asset cleanup failed');
  }
};
