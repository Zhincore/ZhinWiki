import { prisma } from '@nibleaf/database';
import { createLogger } from '@nibleaf/logger';
import { deleteObject } from '@nibleaf/storage';

const log = createLogger({ processor: 'unconfirmed-upload-sweep' });

/** A presigned upload not confirmed within this time is abandoned. */
export const UNCONFIRMED_UPLOAD_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const UNCONFIRMED_UPLOAD_SWEEP_BATCH = 500;

export interface UnconfirmedUploadSweepResult {
  /** Rows older than the cutoff in this batch. */
  stale: number;
  /** Objects deleted and rows removed. */
  deleted: number;
  /** Object deletes that failed; their rows stay for the next sweep. */
  failed: number;
}

/**
 * Delete the storage objects of member uploads that were presigned but never
 * confirmed, and their rows. One bounded batch per run: the oldest rows first.
 * A key a confirmed asset already uses is only unregistered, never deleted.
 */
export const sweepUnconfirmedUploads = async (
  now = new Date(),
  maxAgeMs = UNCONFIRMED_UPLOAD_MAX_AGE_MS,
  batchSize = UNCONFIRMED_UPLOAD_SWEEP_BATCH,
): Promise<UnconfirmedUploadSweepResult> => {
  const cutoff = new Date(now.getTime() - maxAgeMs);
  const uploads = await prisma.assetUpload.findMany({
    where: { createdAt: { lt: cutoff } },
    orderBy: { createdAt: 'asc' },
    take: batchSize,
    select: { id: true, key: true },
  });
  const result: UnconfirmedUploadSweepResult = { stale: uploads.length, deleted: 0, failed: 0 };
  if (uploads.length === 0) return result;

  const confirmed = new Set(
    (await prisma.asset.findMany({ where: { key: { in: uploads.map((upload) => upload.key) } }, select: { key: true } })).map((asset) => asset.key),
  );
  const swept: string[] = [];
  for (const upload of uploads) {
    if (confirmed.has(upload.key)) {
      swept.push(upload.id);
      continue;
    }
    try {
      await deleteObject(upload.key);
      swept.push(upload.id);
      result.deleted += 1;
    } catch (error) {
      result.failed += 1;
      log.warn({ error, uploadId: upload.id }, 'could not delete an unconfirmed upload');
    }
  }
  if (swept.length > 0) await prisma.assetUpload.deleteMany({ where: { id: { in: swept } } });
  log.info(result, 'swept unconfirmed uploads');
  return result;
};
