/** A same-origin path (`/app/...`, query allowed) to come back to after
 *  signing in; anything else (other origins, protocol-relative URLs, control
 *  characters) is dropped. */
export const safeReturnPath = (value: unknown): string | undefined => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return undefined;
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return undefined;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters would break the URL
  if (/[\u0000-\u001f\u007f]/.test(value)) return undefined;
  return value;
};
