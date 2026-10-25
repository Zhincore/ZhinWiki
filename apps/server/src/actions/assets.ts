import { type Asset, prisma } from '@nibleaf/database';
import { newId } from '@nibleaf/shared/ids';
import { slugify } from '@nibleaf/shared/utils';
import { deleteObject, getObjectStream, headObject, presignPutUrl, putObject } from '@nibleaf/storage';
import { type ConfirmAssetBody, MAX_SVG_BYTES, type PresignAssetBody, SVG_CONTENT_TYPE } from '@nibleaf/validators';
import { badRequest } from '@/errors';
import { sanitizeSvg } from '@/lib/svg';
import { assertProjectInOrg } from './projects';

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

export const presignAsset = async (organizationId: string, projectId: string, body: PresignAssetBody) => {
  await assertProjectInOrg(organizationId, projectId);
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

export const confirmAsset = async (organizationId: string, projectId: string, userId: string, body: ConfirmAssetBody) => {
  await assertProjectInOrg(organizationId, projectId);
  assertOwnedKey(projectId, body.key);
  const size = body.contentType === SVG_CONTENT_TYPE ? await sanitizeUploadedSvg(body.key) : body.size;
  return prisma.asset.create({
    data: { projectId, key: body.key, url: publicUrlForKey(body.key), contentType: body.contentType, size, createdById: userId },
  });
};

export const listAssets = async (projectId: string): Promise<Asset[]> =>
  await prisma.asset.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' }, take: 200 });
