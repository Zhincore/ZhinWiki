import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  uploadFindMany: vi.fn(),
  uploadDeleteMany: vi.fn(),
  assetFindMany: vi.fn(),
  deleteObject: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock('@nibleaf/database', () => ({
  prisma: { assetUpload: { findMany: mocks.uploadFindMany, deleteMany: mocks.uploadDeleteMany }, asset: { findMany: mocks.assetFindMany } },
}));
vi.mock('@nibleaf/logger', () => ({ createLogger: () => ({ info: mocks.logInfo, warn: mocks.logWarn }) }));
vi.mock('@nibleaf/storage', () => ({ deleteObject: mocks.deleteObject }));

import { sweepUnconfirmedUploads, UNCONFIRMED_UPLOAD_MAX_AGE_MS, UNCONFIRMED_UPLOAD_SWEEP_BATCH } from './unconfirmed-upload-sweep';

const now = new Date('2026-11-20T03:41:00.000Z');
const upload = (name: string) => ({ id: name, key: `projects/p1/assets/${name}.png` });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.uploadFindMany.mockResolvedValue([]);
  mocks.uploadDeleteMany.mockResolvedValue({ count: 0 });
  mocks.assetFindMany.mockResolvedValue([]);
  mocks.deleteObject.mockResolvedValue(undefined);
});

describe('sweepUnconfirmedUploads', () => {
  it('selects only uploads older than the cutoff, oldest first and bounded', async () => {
    await sweepUnconfirmedUploads(now);

    expect(mocks.uploadFindMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: new Date(now.getTime() - UNCONFIRMED_UPLOAD_MAX_AGE_MS) } },
      orderBy: { createdAt: 'asc' },
      take: UNCONFIRMED_UPLOAD_SWEEP_BATCH,
      select: { id: true, key: true },
    });
    expect(mocks.assetFindMany).not.toHaveBeenCalled();
    expect(mocks.uploadDeleteMany).not.toHaveBeenCalled();
  });

  it('deletes the objects and rows of stale uploads and reports counts', async () => {
    mocks.uploadFindMany.mockResolvedValue([upload('a'), upload('b')]);

    await expect(sweepUnconfirmedUploads(now, 1000, 10)).resolves.toEqual({ stale: 2, deleted: 2, failed: 0 });

    expect(mocks.deleteObject.mock.calls.map(([key]) => key)).toEqual(['projects/p1/assets/a.png', 'projects/p1/assets/b.png']);
    expect(mocks.uploadDeleteMany).toHaveBeenCalledWith({ where: { id: { in: ['a', 'b'] } } });
    expect(mocks.logInfo).toHaveBeenCalledWith({ stale: 2, deleted: 2, failed: 0 }, 'swept unconfirmed uploads');
  });

  it('never deletes an object a confirmed asset uses, but drops its upload row', async () => {
    mocks.uploadFindMany.mockResolvedValue([upload('confirmed'), upload('orphan')]);
    mocks.assetFindMany.mockResolvedValue([{ key: 'projects/p1/assets/confirmed.png' }]);

    await expect(sweepUnconfirmedUploads(now)).resolves.toEqual({ stale: 2, deleted: 1, failed: 0 });

    expect(mocks.assetFindMany).toHaveBeenCalledWith({
      where: { key: { in: ['projects/p1/assets/confirmed.png', 'projects/p1/assets/orphan.png'] } },
      select: { key: true },
    });
    expect(mocks.deleteObject).toHaveBeenCalledExactlyOnceWith('projects/p1/assets/orphan.png');
    expect(mocks.uploadDeleteMany).toHaveBeenCalledWith({ where: { id: { in: ['confirmed', 'orphan'] } } });
  });

  it('keeps the row of an upload whose object could not be deleted', async () => {
    mocks.uploadFindMany.mockResolvedValue([upload('broken'), upload('ok')]);
    mocks.deleteObject.mockImplementation(async (key: string) => {
      if (key.includes('broken')) throw new Error('storage down');
    });

    await expect(sweepUnconfirmedUploads(now)).resolves.toEqual({ stale: 2, deleted: 1, failed: 1 });

    expect(mocks.uploadDeleteMany).toHaveBeenCalledWith({ where: { id: { in: ['ok'] } } });
    expect(mocks.logWarn).toHaveBeenCalledWith(expect.objectContaining({ uploadId: 'broken' }), expect.any(String));
  });
});
