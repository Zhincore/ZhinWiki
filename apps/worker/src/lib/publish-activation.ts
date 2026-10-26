import type { PublishDeploymentJobData } from '@nibleaf/bullmq/jobs/publish';
import { prisma } from '@nibleaf/database';

/** Replay-safe READY receipt; one row per deployment, keyed by its ID. */
export async function recordPublishReady(
  job: Pick<PublishDeploymentJobData, 'deploymentId' | 'projectId' | 'auto'>,
  ready: { createdById: string | null; version: number; completedAt: Date | null },
): Promise<void> {
  const manual = job.auto === false && ready.createdById !== null;
  await prisma.platformEvent.createMany({
    data: {
      id: `publish-ready:${job.deploymentId}`,
      type: 'publish_ready',
      userId: ready.createdById,
      projectId: job.projectId,
      metadata: { auto: !manual, version: ready.version },
      ...(ready.completedAt ? { createdAt: ready.completedAt } : {}),
    },
    skipDuplicates: true,
  });
}
