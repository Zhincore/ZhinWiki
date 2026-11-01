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
const db = vi.hoisted(() => ({
  asset: {
    create: vi.fn(async ({ data }: { data: unknown }) => data),
    upsert: vi.fn(async ({ create }: { create: unknown }) => create),
    findMany: vi.fn(),
    delete: vi.fn(),
  },
  project: { findUniqueOrThrow: vi.fn() },
  changeRequest: { count: vi.fn() },
  page: { findMany: vi.fn() },
}));

vi.mock('@nibleaf/database', () => ({ prisma: db }));
vi.mock('./projects', () => ({ assertProjectInOrg: vi.fn(async () => ({ id: 'p1' })), resolveWikiRole: vi.fn(async () => null) }));

import { cleanupContributorAssets, confirmAsset, storeAsset } from './assets';
import { resolveWikiRole } from './projects';

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

describe('storeAsset keys', () => {
  it('takes the extension from the stored type, not the file name', async () => {
    const asset = await storeAsset({ projectId: 'p1', filename: 'Shot.HTML', contentType: 'image/png', bytes: new Uint8Array([1]) });
    expect(asset.key).toMatch(/^projects\/p1\/assets\/[^/]+-shot\.png$/);
  });
});

describe('cleanupContributorAssets', () => {
  /** Pages on the default branch or an open change request; `live: false` stands for an archived or merged one's branch. */
  const givenWiki = ({ pages = [] as { content: string; live?: boolean }[], config = null as unknown, open = 0 } = {}) => {
    db.project.findUniqueOrThrow.mockResolvedValue({ organizationId: 'org', config });
    db.changeRequest.count.mockResolvedValue(open);
    db.asset.findMany.mockResolvedValue(
      ['kept', 'used-in-config', 'orphan', 'archived-only'].map((name) => ({ id: name, key: `projects/p1/assets/${name}.png` })),
    );
    db.page.findMany.mockImplementation(async ({ where }: { where: { OR: { content?: { contains: string } }[] } }) =>
      pages
        .filter((page) => page.live !== false && where.OR.some((term) => term.content && page.content.includes(term.content.contains)))
        .map((page) => ({ content: page.content, icon: null })),
    );
  };
  const deletedKeys = () => storage.deleteObject.mock.calls.map(([key]) => key);

  beforeEach(() => {
    vi.mocked(resolveWikiRole).mockResolvedValue(null);
  });

  it('deletes uploads that nothing references once a change request is archived', async () => {
    givenWiki({
      pages: [
        { content: '![x](/api/public/assets/projects/p1/assets/kept.png)' },
        { content: '![y](/api/public/assets/projects/p1/assets/archived-only.png)', live: false },
      ],
      config: { branding: { logoLight: '/api/public/assets/projects/p1/assets/used-in-config.png' } },
    });
    await cleanupContributorAssets('p1', 'guest');
    expect(deletedKeys()).toEqual(['projects/p1/assets/orphan.png', 'projects/p1/assets/archived-only.png']);
    expect(db.asset.delete.mock.calls.map(([args]) => args.where.id)).toEqual(['orphan', 'archived-only']);
    expect(db.asset.findMany).toHaveBeenCalledWith({ where: { projectId: 'p1', createdById: 'guest' }, select: { id: true, key: true } });
    expect(db.page.findMany.mock.calls[0]?.[0].where.branch).toEqual({
      OR: [{ isDefault: true }, { changeRequest: { status: { in: ['DRAFT', 'IN_REVIEW'] } } }],
    });
  });

  it('keeps uploads that merged pages use on the default branch', async () => {
    givenWiki({
      pages: ['kept', 'used-in-config', 'orphan', 'archived-only'].map((name) => ({
        content: `![](/api/public/assets/projects/p1/assets/${name}.png)`,
      })),
    });
    await cleanupContributorAssets('p1', 'guest');
    expect(storage.deleteObject).not.toHaveBeenCalled();
    expect(db.asset.delete).not.toHaveBeenCalled();
  });

  it('leaves the uploads of members alone', async () => {
    vi.mocked(resolveWikiRole).mockResolvedValue('member');
    givenWiki();
    await cleanupContributorAssets('p1', 'member-1');
    expect(db.asset.findMany).not.toHaveBeenCalled();
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it('spares recent uploads while the contributor has another open change request', async () => {
    givenWiki({ open: 1 });
    await cleanupContributorAssets('p1', 'guest');
    expect(db.asset.findMany.mock.calls[0]?.[0].where).toMatchObject({ createdById: 'guest', createdAt: { lt: expect.any(Date) } });
  });

  it('logs instead of throwing when storage fails', async () => {
    givenWiki();
    storage.deleteObject.mockRejectedValueOnce(new Error('storage down'));
    await expect(cleanupContributorAssets('p1', 'guest')).resolves.toBeUndefined();
    expect(db.asset.delete.mock.calls.map(([args]) => args.where.id)).toEqual(['used-in-config', 'orphan', 'archived-only']);
  });
});
