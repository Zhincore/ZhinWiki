import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { mathFromMarkdown } from 'mdast-util-math';
import { gfm } from 'micromark-extension-gfm';
import { math } from 'micromark-extension-math';

const SOFT_BREAK = /[ \t]*\r?\n[ \t]*/g;

const strip = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(strip);
  if (!value || typeof value !== 'object') return value;
  const node = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(node)
      .filter((key) => key !== 'position')
      .map((key) => [key, node.type === 'text' && key === 'value' ? String(node[key]).replace(SOFT_BREAK, ' ') : strip(node[key])]),
  );
};

/**
 * Equality key of a Markdown document: its GFM + math syntax tree without
 * source positions, with soft line breaks in text collapsed to a space.
 * Re-wrapped paragraphs and trailing blank lines compare equal; code, HTML
 * and component tags, hard breaks and block structure still differ.
 */
export const markdownKey = (source: string) =>
  JSON.stringify(strip(fromMarkdown(source, { extensions: [gfm(), math()], mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()] })));
