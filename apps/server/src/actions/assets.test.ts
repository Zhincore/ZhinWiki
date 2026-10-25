import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({
  objects: new Map<string, Uint8Array>(),
  putObject: vi.fn(async (key: string, body: Uint8Array) => {
    storage.objects.set(key, body);
  }),
  deleteObject: vi.fn(async (key: string) => {
    storage.objects.delete(key);
  }),
}));

vi.mock('@nibleaf/storage', () => ({
  presignPutUrl: vi.fn(),
  putObject: storage.putObject,
  deleteObject: storage.deleteObject,
  headObject: vi.fn(async (key: string) => ({ ContentLength: storage.objects.get(key)?.byteLength })),
  getObjectStream: vi.fn(async (key: string) => Readable.from([Buffer.from(storage.objects.get(key) ?? new Uint8Array())])),
}));
vi.mock('@nibleaf/database', () => ({
  prisma: { asset: { create: vi.fn(async ({ data }: { data: unknown }) => data), upsert: vi.fn(async ({ create }: { create: unknown }) => create) } },
}));
vi.mock('./projects', () => ({ assertProjectInOrg: vi.fn(async () => ({ id: 'p1' })) }));

import { confirmAsset, storeAsset } from './assets';

const key = 'projects/p1/assets/abc-logo.svg';
const text = (bytes: Uint8Array | undefined) => new TextDecoder().decode(bytes);

beforeEach(() => {
  storage.objects.clear();
  vi.clearAllMocks();
});

describe('SVG assets', () => {
  it('sanitizes an uploaded SVG on confirm and records its stored size', async () => {
    storage.objects.set(key, new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><circle r="1"/></svg>'));

    const asset = await confirmAsset('org', 'p1', 'u1', { key, contentType: 'image/svg+xml', size: 999 });

    const stored = text(storage.objects.get(key));
    expect(stored).not.toContain('onload');
    expect(stored).toContain('<circle r="1"/>');
    expect(storage.putObject).toHaveBeenCalledWith(key, expect.any(Uint8Array), 'image/svg+xml');
    expect(asset).toMatchObject({ key, contentType: 'image/svg+xml', size: storage.objects.get(key)?.byteLength });
  });

  it('deletes an upload that is not a valid SVG', async () => {
    storage.objects.set(key, new TextEncoder().encode('<html><script>alert(1)</script></html>'));

    await expect(confirmAsset('org', 'p1', 'u1', { key, contentType: 'image/svg+xml', size: 40 })).rejects.toThrow(/not a valid SVG/);
    expect(storage.objects.has(key)).toBe(false);
  });

  it('sanitizes SVGs stored by importers', async () => {
    await storeAsset({
      projectId: 'p1',
      filename: 'diagram.svg',
      contentType: 'image/svg+xml',
      bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect/></svg>'),
      importId: 'gitbook-1',
    });

    const [, stored] = storage.putObject.mock.calls[0] ?? [];
    expect(text(stored)).toBe('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');
  });

  it('leaves raster uploads untouched', async () => {
    await confirmAsset('org', 'p1', 'u1', { key: 'projects/p1/assets/abc-shot.png', contentType: 'image/png', size: 10 });
    expect(storage.putObject).not.toHaveBeenCalled();
  });
});
