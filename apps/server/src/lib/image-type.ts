/** Most icons a real .ico holds; caps the directory size we accept. */
const MAX_ICON_ENTRIES = 256;

/** An ICONDIR (reserved 0, type 1, 1..256 entries) whose first entry's image lies after the directory and within the bytes. */
const isIcon = (bytes: Uint8Array): boolean => {
  if (bytes.byteLength < 22) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(4, true);
  if (view.getUint16(0, true) !== 0 || view.getUint16(2, true) !== 1 || count < 1 || count > MAX_ICON_ENTRIES) return false;
  const directoryEnd = 6 + 16 * count;
  const size = view.getUint32(14, true);
  const offset = view.getUint32(18, true);
  return directoryEnd <= bytes.byteLength && size > 0 && offset >= directoryEnd && offset + size <= bytes.byteLength;
};

/** Raster image type from magic bytes, or '' when the bytes are not a known image. */
export const sniffImageType = (bytes: Uint8Array): string => {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (bytes[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a') return 'image/gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(4, 8) === 'ftyp' && ['avif', 'avis'].includes(ascii(8, 12))) return 'image/avif';
  if (isIcon(bytes)) return 'image/x-icon';
  return '';
};
