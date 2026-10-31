import { type Asset, type Prisma, prisma } from '@nibleaf/database';
import { newId } from '@nibleaf/shared/ids';
import { slugify } from '@nibleaf/shared/utils';
import { deleteObject, getObjectStream, headObject, presignPutUrl, putObject } from '@nibleaf/storage';
import { type ConfirmAssetBody, MAX_SVG_BYTES, type PresignAssetBody, SVG_CONTENT_TYPE } from '@nibleaf/validators';
import { AppError, badRequest, conflict, forbidden } from '@/errors';
import { sanitizeSvg } from '@/lib/svg';
import { assertProjectInOrg } from './projects';

/** Outside contributors upload images only while they have an open change
 *  request, each at most 5 MB and 50 MB in total per wiki. */
const CONTRIBUTOR_MAX_ASSET_BYTES = 5 * 1024 * 1024;
const CONTRIBUTOR_ASSET_QUOTA_BYTES = 50 * 1024 * 1024;

const assetPrefix = (projectId: string): string => `projects/${projectId}/assets/`;

const assetKey = (projectId: string, filename: string): string => {
  const dot = filename.lastIndexOf('.');
  const ext = dot > -1 ? filename.slice(dot + 1).toLowerCase() : '';
  const base = slugify(dot > -1 ? filename.slice(0, dot) : filename) || 'file';
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
  const key = importId ? importedAssetKey(projectId, importId, filename) : assetKey(projectId, filename);
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

const uploadedBytes = async (client: Prisma.TransactionClient, projectId: string, userId: string): Promise<number> =>
  (await client.asset.aggregate({ where: { projectId, createdById: userId }, _sum: { size: true } }))._sum.size ?? 0;

const quotaExceeded = () =>
  new AppError({
    code: 'assets:quota_exceeded',
    message: 'Contributors can upload at most 50 MB of images per wiki.',
    details: { limit: CONTRIBUTOR_ASSET_QUOTA_BYTES },
  });

/** A contributor needs an open change request on the wiki and a file within the per-file cap. */
const assertContributorUpload = async (projectId: string, userId: string, size: number): Promise<void> => {
  const open = await prisma.changeRequest.count({ where: { projectId, authorId: userId, status: { in: ['DRAFT', 'IN_REVIEW'] } } });
  if (open === 0) {
    throw forbidden('Open a change request before uploading images.');
  }
  if (size > CONTRIBUTOR_MAX_ASSET_BYTES) {
    throw new AppError({
      code: 'assets:file_too_large',
      message: 'Contributors can upload images of at most 5 MB.',
      details: { limit: CONTRIBUTOR_MAX_ASSET_BYTES },
    });
  }
};

/** Presign an upload; `contributorId` applies the outside contributor limits. */
export const presignAsset = async (organizationId: string, projectId: string, body: PresignAssetBody, contributorId?: string) => {
  await assertProjectInOrg(organizationId, projectId);
  if (contributorId) {
    await assertContributorUpload(projectId, contributorId, body.size);
    if ((await uploadedBytes(prisma, projectId, contributorId)) + body.size > CONTRIBUTOR_ASSET_QUOTA_BYTES) {
      throw quotaExceeded();
    }
  }
  const key = assetKey(projectId, body.filename);
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

/**
 * Record a contributor's upload by the stored object's size. The quota is
 * checked under a per-uploader lock so parallel confirms cannot exceed it.
 * Recorded keys are refused untouched; any other refused upload is deleted.
 */
const confirmContributorAsset = async (projectId: string, userId: string, body: ConfirmAssetBody) => {
  if (await prisma.asset.findUnique({ where: { key: body.key }, select: { id: true } })) {
    throw conflict('The upload is already recorded.', { key: body.key });
  }
  const head = await headObject(body.key).catch(() => null);
  if (!head) {
    throw badRequest('The upload was not found.', { key: body.key });
  }
  try {
    await assertContributorUpload(projectId, userId, head.ContentLength ?? 0);
    const size = body.contentType === SVG_CONTENT_TYPE ? await sanitizeUploadedSvg(body.key) : (head.ContentLength ?? 0);
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`asset-quota:${projectId}:${userId}`}))`;
      if ((await uploadedBytes(tx, projectId, userId)) + size > CONTRIBUTOR_ASSET_QUOTA_BYTES) {
        throw quotaExceeded();
      }
      return tx.asset.create({
        data: { projectId, key: body.key, url: publicUrlForKey(body.key), contentType: body.contentType, size, createdById: userId },
      });
    });
  } catch (error) {
    await deleteObject(body.key).catch(() => undefined);
    throw error;
  }
};

/** Record an upload; `contributor` applies the outside contributor limits. */
export const confirmAsset = async (organizationId: string, projectId: string, userId: string, body: ConfirmAssetBody, contributor = false) => {
  await assertProjectInOrg(organizationId, projectId);
  assertOwnedKey(projectId, body.key);
  if (contributor) {
    return confirmContributorAsset(projectId, userId, body);
  }
  const size = body.contentType === SVG_CONTENT_TYPE ? await sanitizeUploadedSvg(body.key) : body.size;
  return prisma.asset.create({
    data: { projectId, key: body.key, url: publicUrlForKey(body.key), contentType: body.contentType, size, createdById: userId },
  });
};

export const listAssets = async (projectId: string): Promise<Asset[]> =>
  await prisma.asset.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' }, take: 200 });
