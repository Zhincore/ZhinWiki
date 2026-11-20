import type { EraseProjectStorageJobData, ErasureJobData, ErasureJobName } from '@nibleaf/bullmq/jobs/erasure';
import type { Job } from 'bullmq';
import { handleProjectStorageErasure } from '../lib/project-storage-erasure';
import { sweepUnconfirmedUploads } from '../lib/unconfirmed-upload-sweep';

export const handleErasureJobs = async (job: Job<ErasureJobData, unknown, ErasureJobName>) => {
  if (job.name === 'sweep-unconfirmed-uploads') return sweepUnconfirmedUploads();
  return handleProjectStorageErasure(job as Job<EraseProjectStorageJobData>);
};
