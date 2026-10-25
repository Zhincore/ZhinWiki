import { MAX_SVG_BYTES } from '@nibleaf/validators';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { sanitizeSvg } from './svg';

const encode = (text: string) => new TextEncoder().encode(text);
const clean = (text: string) => new TextDecoder().decode(sanitizeSvg(encode(text)) ?? new Uint8Array());

describe('sanitizeSvg', () => {
  const hostile = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10" onload="alert(1)">
<script>alert(2)</script><style>rect{fill:red}</style>
<defs><symbol id="dot"><circle r="1"/></symbol></defs>
<rect width="10" height="10" onclick="alert(3)"/>
<a xlink:href="javascript:alert(4)"><text>A &amp; B</text></a>
<use href="#dot"/><use xlink:href="https://evil.example/sprite.svg#a"/>
<foreignObject><iframe src="https://evil.example"></iframe></foreignObject>
<animate attributeName="href" to="javascript:alert(5)"/></svg>`;

  it('removes scripts, handlers, script URLs, foreign content, and external references', () => {
    const output = clean(hostile);
    expect(output).not.toMatch(/<script|onload|onclick|javascript:|foreignObject|iframe|<animate|evil\.example/i);
    expect(output).toContain('<rect width="10" height="10"/>');
    expect(output).toContain('<use href="#dot"/>');
    expect(output).toContain('<style>rect{fill:red}</style>');
    expect(output).toContain('A &amp; B');
  });

  it('keeps visual animations but drops attribute-rewriting ones', () => {
    const output = clean(`<svg xmlns="http://www.w3.org/2000/svg"><a href="#x"><rect>
<set attributeName="href" to="javascript:alert(1)"/>
<animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="2s"/></rect></a></svg>`);
    expect(output).not.toMatch(/<set|javascript:/);
    expect(output).toContain('<animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="2s"/>');
  });

  it('produces a well-formed SVG document', () => {
    type ParsedXml = { querySelector(selector: string): unknown; documentElement: { localName: string } };
    const { window } = new JSDOM('') as unknown as { window: { DOMParser: new () => { parseFromString(text: string, type: string): ParsedXml } } };
    const document = new window.DOMParser().parseFromString(clean(hostile), 'image/svg+xml');
    expect(document.querySelector('parsererror')).toBeNull();
    expect(document.documentElement.localName).toBe('svg');
  });

  it('refuses input that is not an SVG or is too large to parse', () => {
    expect(sanitizeSvg(encode('<html><body>hi</body></html>'))).toBeNull();
    expect(sanitizeSvg(encode('not markup'))).toBeNull();
    expect(sanitizeSvg(new Uint8Array(MAX_SVG_BYTES + 1))).toBeNull();
  });
});
