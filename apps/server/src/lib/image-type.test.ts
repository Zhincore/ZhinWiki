import { describe, expect, it } from 'vitest';
import { sniffImageType } from './image-type';

/** An .ico with one 16x16 entry whose image data follows the directory. */
const icon = (overrides: { count?: number; size?: number; offset?: number } = {}) => {
  const image = new Uint8Array(40).fill(7);
  const bytes = new Uint8Array(22 + image.byteLength);
  const view = new DataView(bytes.buffer);
  view.setUint16(2, 1, true);
  view.setUint16(4, overrides.count ?? 1, true);
  bytes[6] = 16;
  bytes[7] = 16;
  view.setUint32(14, overrides.size ?? image.byteLength, true);
  view.setUint32(18, overrides.offset ?? 22, true);
  bytes.set(image, 22);
  return bytes;
};

describe('sniffImageType icons', () => {
  it('accepts a well-formed icon', () => {
    expect(sniffImageType(icon())).toBe('image/x-icon');
  });

  it('accepts an icon inside a pooled buffer', () => {
    const pooled = Buffer.concat([Buffer.alloc(5), icon()]).subarray(5);
    expect(sniffImageType(pooled)).toBe('image/x-icon');
  });

  it('rejects a blob that only shares the four-byte prefix', () => {
    expect(sniffImageType(Uint8Array.from([0, 0, 1, 0, ...new TextEncoder().encode('<html><script>alert(1)</script></html>')]))).toBe('');
  });

  it('rejects an entry pointing past the end or into the directory', () => {
    expect(sniffImageType(icon({ size: 41 }))).toBe('');
    expect(sniffImageType(icon({ offset: 10 }))).toBe('');
    expect(sniffImageType(icon({ count: 0 }))).toBe('');
    expect(sniffImageType(icon({ count: 3 }))).toBe('');
  });
});
