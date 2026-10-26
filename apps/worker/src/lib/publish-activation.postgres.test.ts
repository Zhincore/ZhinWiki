import { randomUUID } from 'node:crypto';
import { prisma } from '@nibleaf/database';
import { expect, it, vi } from 'vitest';

vi.mock('@nibleaf/bullmq', () => ({ QueueNames: { EMAIL: 'email' }, createJob: vi.fn(async () => undefined) }));
vi.mock('@nibleaf/email', () => ({
  renderDeploymentEmail: vi.fn(async () => ({ subject: 'Synthetic', html: '', text: '' })),
  resolveEmailLanguage: () => 'en',
}));

import { notifyDeployment } from './notify';
import { recordPublishReady } from './publish-activation';

// Explicit opt-in: CI supplies its disposable migrated PostgreSQL service.
it.skipIf(process.env.ACTIVATION_INTEGRATION !== '1')(
  'deduplicates concurrent READY retries in PostgreSQL',
  async () => {
    const run = randomUUID();
    const userId = `activation-qa-${run}`;
    const ready = { createdById: userId, version: 2, completedAt: new Date() };
    const job = { deploymentId: `deployment-${run}`, projectId: `project-${run}`, auto: false } as const;
    try {
      await Promise.all(Array.from({ length: 12 }, () => recordPublishReady(job, ready)));
      expect(await prisma.platformEvent.count({ where: { userId, type: 'publish_ready' } })).toBe(1);
      await recordPublishReady({ ...job, deploymentId: `later-${run}` }, ready);
      expect(await prisma.platformEvent.count({ where: { userId, type: 'publish_ready' } })).toBe(2);
    } finally {
      await prisma.platformEvent.deleteMany({ where: { userId } });
      await prisma.$disconnect();
    }
  },
  30_000,
);

it.skipIf(process.env.ACTIVATION_INTEGRATION !== '1')(
  'deduplicates concurrent in-app notifications in PostgreSQL with email enqueue mocked',
  async () => {
    const run = randomUUID();
    const userId = `notification-qa-${run}`;
    const project = vi.spyOn(prisma.project, 'findUnique').mockResolvedValue({ organizationId: run } as never);
    const org = vi.spyOn(prisma.organization, 'findUnique').mockResolvedValue({ metadata: null } as never);
    const members = vi.spyOn(prisma.member, 'findMany').mockResolvedValue([{ userId, user: { email: 'synthetic@example.invalid' } }] as never);
    const opts = { deploymentId: run, projectId: run, projectName: 'Synthetic', version: 1, outcome: 'ready' } as const;
    try {
      await Promise.all(Array.from({ length: 12 }, () => notifyDeployment(opts)));
      expect(await prisma.notification.count({ where: { userId } })).toBe(1);
      await notifyDeployment({ ...opts, outcome: 'failed' });
      await notifyDeployment({ ...opts, deploymentId: `other-${run}` });
      expect(await prisma.notification.count({ where: { userId } })).toBe(3);
    } finally {
      project.mockRestore();
      org.mockRestore();
      members.mockRestore();
      await prisma.notification.deleteMany({ where: { userId } });
      await prisma.$disconnect();
    }
  },
  30_000,
);
