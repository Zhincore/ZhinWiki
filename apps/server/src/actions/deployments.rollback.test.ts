import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createJob: vi.fn(),
  projectFindFirst: vi.fn(),
  deploymentFindFirst: vi.fn(),
  deploymentAggregate: vi.fn(),
  deploymentCreate: vi.fn(),
}));

vi.mock('@nibleaf/bullmq', () => ({ createJob: mocks.createJob, QueueNames: { PUBLISH: 'publish', SEARCH: 'search' } }));
vi.mock('@nibleaf/database', () => ({
  Prisma: { PrismaClientKnownRequestError: class extends Error {} },
  prisma: {
    project: { findFirst: mocks.projectFindFirst },
    deployment: { findFirst: mocks.deploymentFindFirst, aggregate: mocks.deploymentAggregate, create: mocks.deploymentCreate },
  },
}));

import { rollbackDeployment } from './deployments';

const snapshot = {
  version: 1,
  project: {
    id: 'project-1',
    name: 'Docs',
    slug: 'docs',
    config: {},
    languages: [{ code: 'en', label: 'English', direction: 'LTR', isDefault: true }],
  },
  pages: [
    { id: 'page-1', kind: 'PAGE', title: 'Home', slug: 'home', path: 'home', content: '# Home', languageCode: 'en', position: 0, hidden: false },
    { id: 'group-1', kind: 'GROUP', title: 'Guides', slug: 'guides', path: 'guides', content: '', languageCode: 'en', position: 1, hidden: false },
  ],
  openapi: null,
  publishedAt: '2026-01-01T00:00:00.000Z',
};

describe('rollbackDeployment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.projectFindFirst.mockResolvedValue({ id: 'project-1', organizationId: 'org-1', takedownAt: null });
    mocks.deploymentFindFirst.mockResolvedValue({ id: 'deployment-2', projectId: 'project-1', version: 2, status: 'READY', snapshot });
    mocks.deploymentAggregate.mockResolvedValue({ _max: { version: 4 } });
    mocks.deploymentCreate.mockImplementation(async ({ data }) => ({ id: 'deployment-5', ...data }));
    mocks.createJob.mockResolvedValue(undefined);
  });

  it('republishes the snapshot as a READY deployment and enqueues its full-text reindex', async () => {
    const deployment = await rollbackDeployment('org-1', 'project-1', 'deployment-2', 'user-1');

    expect(deployment).toMatchObject({ id: 'deployment-5', version: 5, status: 'READY', pagesCount: 1, commitMessage: 'Rollback to v2' });
    expect(mocks.createJob).toHaveBeenCalledExactlyOnceWith(
      'search',
      { name: 'index-text', data: { projectId: 'project-1', deploymentId: 'deployment-5' } },
      { jobId: 'text-search-deployment-5' },
    );
  });

  it('keeps the rollback when the reindex cannot be enqueued', async () => {
    mocks.createJob.mockRejectedValue(new Error('queue unavailable'));

    await expect(rollbackDeployment('org-1', 'project-1', 'deployment-2', 'user-1')).resolves.toMatchObject({ id: 'deployment-5' });
  });

  it('refuses a deployment without a published snapshot before creating anything', async () => {
    mocks.deploymentFindFirst.mockResolvedValue({ id: 'deployment-3', projectId: 'project-1', version: 3, status: 'FAILED', snapshot: null });

    await expect(rollbackDeployment('org-1', 'project-1', 'deployment-3', 'user-1')).rejects.toMatchObject({ code: 'http:bad_request' });
    expect(mocks.deploymentCreate).not.toHaveBeenCalled();
    expect(mocks.createJob).not.toHaveBeenCalled();
  });
});
