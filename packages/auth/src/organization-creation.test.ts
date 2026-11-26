import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ prisma: {}, assignDefaultUsagePlan: vi.fn() }));

vi.mock('@nibleaf/database', () => ({ prisma: mocks.prisma, Prisma: {}, assignDefaultUsagePlan: mocks.assignDefaultUsagePlan }));
vi.mock('@nibleaf/bullmq', () => ({ createJob: vi.fn(), sendRequiredEmail: vi.fn(), QueueNames: {} }));
vi.mock('@nibleaf/email', () => ({
  createEmailTranslator: vi.fn(),
  renderMemberJoinedEmail: vi.fn(),
  renderNewSignInEmail: vi.fn(),
  renderVerificationCodeEmail: vi.fn(),
  resolveEmailLanguage: vi.fn(),
}));
vi.mock('./keys.server', () => ({
  keys: () => ({
    BETTER_AUTH_SECRET: 'synthetic-organization-creation-test-secret',
    BETTER_AUTH_URL: 'http://localhost:4311',
    TRUSTED_ORIGINS: ['http://localhost:4311'],
  }),
}));

import { auth } from './server';

describe('configured organization creation hook', () => {
  it('assigns the default usage plan to organizations created through the plugin', async () => {
    const plugin = auth.options.plugins.find((plugin) => plugin.id === 'organization');
    if (!plugin || !('options' in plugin)) throw new Error('Organization plugin is required');
    const hooks = (plugin.options as { organizationHooks?: Record<string, (input: unknown) => Promise<void>> }).organizationHooks;
    if (!hooks?.afterCreateOrganization) throw new Error('afterCreateOrganization hook is required');
    const now = new Date();
    await hooks.afterCreateOrganization({
      organization: { id: 'org-a', name: 'Wiki', slug: 'wiki', createdAt: now },
      member: { id: 'member-a', organizationId: 'org-a', userId: 'owner', role: 'owner', createdAt: now },
      user: { id: 'owner', email: 'owner@example.test', name: 'Owner', emailVerified: true, createdAt: now, updatedAt: now },
    });
    expect(mocks.assignDefaultUsagePlan).toHaveBeenCalledWith(mocks.prisma, 'org-a');
  });
});
