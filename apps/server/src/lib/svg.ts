import { MAX_SVG_BYTES } from '@nibleaf/validators';
import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('');
const purify = createDOMPurify(window as unknown as Parameters<typeof createDOMPurify>[0]);

/** The DOM members used here; the server compiles without the DOM lib. */
type SanitizedNode = { localName: string };
type SanitizedFragment = { firstElementChild: SanitizedNode | null };

// `<use>` is how icon sprites reference their own symbols; only same-document
// references (`#id`) are kept, never another file or URL.
purify.addHook('uponSanitizeAttribute', (node, data) => {
  const isUse = (node as unknown as SanitizedNode).localName === 'use';
  if (isUse && (data.attrName === 'href' || data.attrName === 'xlink:href') && !data.attrValue.startsWith('#')) {
    data.keepAttr = false;
  }
});

/**
 * Sanitize an untrusted SVG document with DOMPurify's SVG profile: scripts,
 * event handlers, `javascript:` URLs, foreign content, and `<animate>`/`<set>`
 * (which can rewrite any attribute, links included) are removed. Visual
 * animations (`animateTransform`, `animateMotion`, CSS) keep their timing
 * attributes. Returns null when the input is not an SVG or is too large to
 * parse safely. Serving still applies a script-free CSP.
 */
export const sanitizeSvg = (bytes: Uint8Array): Uint8Array | null => {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_SVG_BYTES) return null;
  const fragment = purify.sanitize(new TextDecoder().decode(bytes), {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ['use'],
    // Only meaningful on the remaining visual animations: `<animate>` and `<set>` are always stripped.
    ADD_ATTR: ['from', 'to', 'by'],
    RETURN_DOM_FRAGMENT: true,
  }) as unknown as SanitizedFragment;
  const svg = fragment.firstElementChild;
  if (svg?.localName !== 'svg') return null;
  return new TextEncoder().encode(new window.XMLSerializer().serializeToString(svg as never));
};
