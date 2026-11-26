import { createJob, getJob, QueueNames, removeJob } from '@nibleaf/bullmq';
import { ERASE_PROJECT_STORAGE_START_DELAY_MS, eraseProjectStorageJobId } from '@nibleaf/bullmq/jobs/erasure';
import { keys as clickHouseKeys, clickHouseWritesEnabled, deleteProjectAnalytics, deleteProjectUsage } from '@nibleaf/clickhouse';
import { beginUsageDeletion, prisma } from '@nibleaf/database';
import { createLogger } from '@nibleaf/logger';

const log = createLogger({ module: 'tenant-erasure' });

/** BullMQ ignores a new job whose id it still retains, so a retried deletion must
 * clear an exhausted failed job to queue erasure again. A waiting, delayed, or
 * active job is left alone: it already waits for the relational delete. */
const enqueueProjectStorageErasure = async (projectId: string) => {
  const jobId = eraseProjectStorageJobId(projectId);
  const existing = await getJob(QueueNames.ERASURE, jobId);
  if (await existing?.isFailed()) await removeJob(QueueNames.ERASURE, jobId);
  await createJob(QueueNames.ERASURE, { name: 'erase-project-storage', data: { projectId } }, { jobId, delay: ERASE_PROJECT_STORAGE_START_DELAY_MS });
};

/** Outlasts a Qdrant outage (~40 minutes of exponential backoff). A failed job is
 * dropped so a retried deletion can queue the same job id again. */
const SEARCH_DELETE_RETRY = { attempts: 10, backoff: { type: 'exponential', delay: 5000 }, removeOnFail: true } as const;

/** A provider-managed custom hostname of a deleted project. */
export interface ProviderDomain {
  provider: string;
  providerHostnameId: string;
  providerData: unknown;
}

/** Removes provider-side resources of deleted domains. Rejections are logged, never fatal. */
type ProviderDomainCleanup = (domains: ProviderDomain[]) => Promise<void>;

let cleanupProviderDomains: ProviderDomainCleanup | null = null;

/** Registers the provider hostname cleanup run after a project is erased. */
export const setProviderDomainCleanup = (cleanup: ProviderDomainCleanup): void => {
  cleanupProviderDomains = cleanup;
};

/** Domain rows cascade with the project, so provider hostnames are read first and removed after the delete commits. */
const projectProviderDomains = async (projectId: string): Promise<ProviderDomain[]> => {
  const domains = await prisma.domain.findMany({
    where: { projectId, providerHostnameId: { not: null } },
    select: { provider: true, providerHostnameId: true, providerData: true },
  });
  return domains.flatMap(({ providerHostnameId, ...rest }) => (providerHostnameId ? [{ ...rest, providerHostnameId }] : []));
};

const removeProviderDomains = async (projectId: string, domains: ProviderDomain[]) => {
  if (!cleanupProviderDomains || domains.length === 0) return;
  try {
    await cleanupProviderDomains(domains);
  } catch (error) {
    log.error({ error, projectId }, 'provider domain cleanup failed after project erasure');
  }
};

export class TenantUsageDeletionPendingError extends Error {
  constructor(readonly pendingCount: number) {
    super('Usage ingestion is still draining.');
    this.name = 'TenantUsageDeletionPendingError';
  }
}

export class TenantErasureProjectNotFoundError extends Error {
  constructor() {
    super('Tenant project not found.');
    this.name = 'TenantErasureProjectNotFoundError';
  }
}

/** Single fail-closed tenant erasure workflow used by product and Better Auth
 * deletion paths. The relational fence prevents post-tombstone usage writes. */
export const eraseProjectOrganization = async (organizationId: string, expectedProjectId?: string) => {
  const project = await prisma.project.findUnique({ where: { organizationId }, select: { id: true } });
  if (!project) {
    const marker = await prisma.usageStorageMarker.findUnique({ where: { organizationId }, select: { organizationId: true } });
    if (marker || expectedProjectId) throw new TenantErasureProjectNotFoundError();
    await prisma.organization.delete({ where: { id: organizationId } });
    return { organizationId, projectId: null };
  }
  if (expectedProjectId && project.id !== expectedProjectId) throw new TenantErasureProjectNotFoundError();

  const deletion = await beginUsageDeletion(organizationId, project.id);
  if (!deletion.exists) throw new TenantErasureProjectNotFoundError();
  if (deletion.pendingCount > 0) throw new TenantUsageDeletionPendingError(deletion.pendingCount);

  if (clickHouseWritesEnabled(clickHouseKeys().ANALYTICS_MODE) || deletion.hadStorageMarker) {
    await Promise.all([deleteProjectAnalytics(organizationId, project.id), deleteProjectUsage(organizationId, project.id)]);
  }
  const providerDomains = await projectProviderDomains(project.id);
  await enqueueProjectStorageErasure(project.id);
  await createJob(
    QueueNames.SEARCH,
    { name: 'delete-project', data: { projectId: project.id } },
    {
      jobId: `search-delete-${project.id}`,
      ...SEARCH_DELETE_RETRY,
    },
  );
  await prisma.usageProviderCheckpoint.updateMany({
    where: { organizationId },
    data: { status: 'deletion_pending', hasError: false },
  });
  await prisma.organization.delete({ where: { id: organizationId } });
  await removeProviderDomains(project.id, providerDomains);
  return { organizationId, projectId: project.id };
};
