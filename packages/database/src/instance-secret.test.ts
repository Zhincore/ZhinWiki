import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rows: new Map<string, string>(),
  createMany: vi.fn(),
  findUniqueOrThrow: vi.fn(),
}));

vi.mock('./client', () => ({
  getDb: () => ({ instanceSecret: { createMany: mocks.createMany, findUniqueOrThrow: mocks.findUniqueOrThrow } }),
}));
vi.mock('./keys', () => ({ keys: () => ({ NODE_ENV: 'test', POSTGRES_URL: 'postgresql://test' }) }));
vi.mock('./generated/client', () => ({ Prisma: {} }));

import { getInstanceSecret, resolveAnalyticsHashSalt } from './index';

describe('instance secrets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rows.clear();
    mocks.createMany.mockImplementation(async ({ data }: { data: { key: string; value: string }[] }) => {
      for (const row of data) if (!mocks.rows.has(row.key)) mocks.rows.set(row.key, row.value);
      return { count: data.length };
    });
    mocks.findUniqueOrThrow.mockImplementation(async ({ where }: { where: { key: string } }) => {
      const value = mocks.rows.get(where.key);
      if (!value) throw new Error('missing');
      return { value };
    });
  });

  it('keeps the first persisted secret when another replica created it', async () => {
    mocks.rows.set('replica-key', 'existing-secret');
    await expect(getInstanceSecret('replica-key')).resolves.toBe('existing-secret');
    expect(mocks.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
  });

  it('generates a random secret once and caches it per process', async () => {
    const first = await getInstanceSecret('fresh-key');
    const second = await getInstanceSecret('fresh-key');
    expect(first).toMatch(/^[\w-]{43}$/u);
    expect(second).toBe(first);
    expect(mocks.createMany).toHaveBeenCalledTimes(1);
  });

  it('retries after a failed lookup instead of caching the failure', async () => {
    mocks.createMany.mockRejectedValueOnce(new Error('postgres down'));
    await expect(getInstanceSecret('retry-key')).rejects.toThrow('postgres down');
    await expect(getInstanceSecret('retry-key')).resolves.toMatch(/^[\w-]{43}$/u);
  });

  it('prefers the configured analytics salt over the persisted one', async () => {
    await expect(resolveAnalyticsHashSalt('operator-salt')).resolves.toBe('operator-salt');
    expect(mocks.createMany).not.toHaveBeenCalled();
    const generated = await resolveAnalyticsHashSalt(undefined);
    expect(mocks.rows.get('analytics_hash_salt')).toBe(generated);
  });
});
