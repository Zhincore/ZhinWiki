import { prisma } from '@nibleaf/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { canCreateProject } from './can-create-project';

const env = vi.hoisted(() => ({ TENANCY: 'independent' as 'shared' | 'independent' }));

vi.mock('@/env', () => ({ env }));
vi.mock('@nibleaf/database', () => ({ prisma: { user: { findUnique: vi.fn() } } }));
vi.mock('@/lib/hono/context', () => ({ getContextUserOrThrow: () => ({ id: 'user-1' }) }));

describe('wiki creation guard', () => {
  beforeEach(() => vi.mocked(prisma.user.findUnique).mockReset());

  it('admits any signed-in user in independent tenancy without reading the user', async () => {
    env.TENANCY = 'independent';
    const next = vi.fn(async () => undefined);
    await canCreateProject({} as never, next);
    expect(next).toHaveBeenCalledOnce();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it.each([{ role: 'editor' }, null])('rejects the account record %j in shared tenancy', async (record) => {
    env.TENANCY = 'shared';
    vi.mocked(prisma.user.findUnique).mockResolvedValue(record as never);
    const next = vi.fn(async () => undefined);
    await expect(canCreateProject({} as never, next)).rejects.toMatchObject({ code: 'auth:insufficient_role', status: 403 });
    expect(next).not.toHaveBeenCalled();
  });

  it('admits a platform admin in shared tenancy', async () => {
    env.TENANCY = 'shared';
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: 'admin' } as never);
    const next = vi.fn(async () => undefined);
    await canCreateProject({} as never, next);
    expect(next).toHaveBeenCalledOnce();
  });
});
