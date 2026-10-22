import { beforeEach, describe, expect, it, vi } from 'vitest';

const redis = vi.hoisted(() => ({
  store: new Map<string, string>(),
  down: false,
  set: vi.fn(async (key: string, value: string) => {
    if (redis.down) throw new Error('offline');
    if (redis.store.has(key)) return null;
    redis.store.set(key, value);
    return 'OK';
  }),
  eval: vi.fn(async (_script: string, _keys: number, key: string, token: string) => {
    if (redis.store.get(key) !== token) return 0;
    redis.store.delete(key);
    return 1;
  }),
}));

vi.mock('./redis', () => ({ getRedis: () => redis }));

import { withProjectImportLock } from './import-lock';

beforeEach(() => {
  redis.store.clear();
  redis.down = false;
  vi.clearAllMocks();
});

describe('withProjectImportLock', () => {
  it('refuses a second import of the same project while the first runs', async () => {
    let finish: () => void = () => undefined;
    const first = withProjectImportLock('p1', () => new Promise<string>((resolve) => (finish = () => resolve('done'))));
    await vi.waitFor(() => expect(redis.store.size).toBe(1));

    await expect(withProjectImportLock('p1', async () => 'second')).rejects.toThrow(/already running/);
    await expect(withProjectImportLock('p2', async () => 'other project')).resolves.toBe('other project');

    finish();
    await expect(first).resolves.toBe('done');
    await expect(withProjectImportLock('p1', async () => 'after')).resolves.toBe('after');
  });

  it('releases the lock when the import fails', async () => {
    await expect(
      withProjectImportLock('p1', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(redis.store.size).toBe(0);
  });

  it('runs the import without a lock when redis is unreachable', async () => {
    redis.down = true;
    await expect(withProjectImportLock('p1', async () => 'ran')).resolves.toBe('ran');
  });
});
