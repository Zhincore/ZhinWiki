import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ connect: vi.fn(), disconnect: vi.fn(), clients: vi.fn() }));
vi.mock('ioredis', () => ({
  Redis: class {
    status = 'wait';
    constructor(options: unknown) {
      mocks.clients(options);
    }
    on = vi.fn();
    disconnect = mocks.disconnect;
    async connect() {
      await mocks.connect();
      this.status = 'ready';
    }
  },
}));

describe('shared Redis connection', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('fails fast after a failed command instead of reconnecting per request', async () => {
    const { markRedisUnhealthy, sharedRedis } = await import('./redis');
    markRedisUnhealthy();
    await expect(sharedRedis()).rejects.toThrow(/paused/);
    expect(mocks.clients).not.toHaveBeenCalled();
  });

  it('shares one bounded connection attempt between concurrent first callers', async () => {
    let ready: () => void = () => {
      throw new Error('Connection fixture was not initialized');
    };
    mocks.connect.mockReturnValue(
      new Promise<void>((resolve) => {
        ready = resolve;
      }),
    );
    const { sharedRedis } = await import('./redis');
    const first = sharedRedis();
    const second = sharedRedis();
    expect(mocks.connect).toHaveBeenCalledOnce();
    ready();
    await expect(Promise.all([first, second])).resolves.toSatisfy(([a, b]: unknown[]) => a === b);
    await expect(sharedRedis()).resolves.toBe(await first);
    expect(mocks.clients).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ enableOfflineQueue: false, connectTimeout: 2000, commandTimeout: 2000 }),
    );
  });

  it('pauses after a failed connection, then opens a fresh one', async () => {
    vi.useFakeTimers();
    try {
      mocks.connect.mockRejectedValueOnce(new Error('connection unavailable')).mockResolvedValueOnce(undefined);
      const { sharedRedis } = await import('./redis');
      await expect(sharedRedis()).rejects.toThrow('connection unavailable');
      await expect(sharedRedis()).rejects.toThrow(/paused/);
      vi.advanceTimersByTime(5000);
      await expect(sharedRedis()).resolves.toBeDefined();
      expect(mocks.clients).toHaveBeenCalledTimes(2);
      expect(mocks.disconnect).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
