import { markdownKey } from '@nibleaf/shared/markdown-key';
import { diffArrays } from 'diff';
import { fromMarkdown } from 'mdast-util-from-markdown';

export type BlockDiffRow = { kind: 'same' | 'added' | 'removed'; block: string } | { kind: 'changed'; before: string; after: string };

export type BlockDiffSegment = { kind: 'rows'; rows: BlockDiffRow[] } | { kind: 'collapsed'; rows: BlockDiffRow[] };

const COMPONENT_TAG = /<(\/?)([A-Z][\w.]*)\b[^>]*?(\/?)>/g;

const INLINE_CODE = /`[^`\n]*`/g;

/** Net count of component tags (`<Card>` … `</Card>`) a block's source leaves open, outside inline code. */
const openComponentTags = (markdown: string) => {
  let open = 0;
  for (const [, closing, , selfClosing] of markdown.replace(INLINE_CODE, '').matchAll(COMPONENT_TAG)) {
    if (closing) open -= 1;
    else if (!selfClosing) open += 1;
  }
  return open;
};

/** Top-level Markdown blocks of `source` as trimmed source slices. A component
 *  whose tags sit on their own lines stays one block with its children. */
export function splitBlocks(source: string): string[] {
  const blocks: string[] = [];
  let groupStart: number | null = null;
  let open = 0;
  for (const node of fromMarkdown(source).children) {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) continue;
    groupStart ??= start;
    if (node.type !== 'code') open = Math.max(0, open + openComponentTags(source.slice(start, end)));
    if (open === 0) {
      blocks.push(source.slice(groupStart, end).trim());
      groupStart = null;
    }
  }
  if (groupStart !== null) blocks.push(source.slice(groupStart).trim());
  return blocks.filter(Boolean);
}

/** Align the blocks of two Markdown documents by their Markdown key, so a
 *  re-wrapped block is unchanged and shows its `after` source. A removed run
 *  directly followed by an added run pairs up as changed blocks; the excess
 *  stays removed/added. */
export function diffBlocks(before: string, after: string): BlockDiffRow[] {
  const beforeBlocks = splitBlocks(before);
  const afterBlocks = splitBlocks(after);
  let beforeIndex = 0;
  let afterIndex = 0;
  const parts = diffArrays(beforeBlocks.map(markdownKey), afterBlocks.map(markdownKey)).map((part) => {
    const value = part.removed ? beforeBlocks.slice(beforeIndex, beforeIndex + part.count) : afterBlocks.slice(afterIndex, afterIndex + part.count);
    if (!part.added) beforeIndex += part.count;
    if (!part.removed) afterIndex += part.count;
    return { ...part, value };
  });
  const rows: BlockDiffRow[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (!part) continue;
    const next = parts[index + 1];
    if ((part.removed && next?.added) || (part.added && next?.removed)) {
      const removed = part.removed ? part.value : (next?.value ?? []);
      const added = part.added ? part.value : (next?.value ?? []);
      const paired = Math.min(removed.length, added.length);
      for (let offset = 0; offset < paired; offset += 1) {
        rows.push({ kind: 'changed', before: removed[offset] ?? '', after: added[offset] ?? '' });
      }
      for (const block of removed.slice(paired)) rows.push({ kind: 'removed', block });
      for (const block of added.slice(paired)) rows.push({ kind: 'added', block });
      index += 1;
      continue;
    }
    const kind = part.added ? 'added' : part.removed ? 'removed' : 'same';
    for (const block of part.value) rows.push({ kind, block });
  }
  return rows;
}

/** Group rows for display: runs of unchanged blocks keep `context` blocks next
 *  to a change visible and fold the rest when at least two would be hidden. */
export function collapseUnchanged(rows: BlockDiffRow[], context = 1): BlockDiffSegment[] {
  const segments: BlockDiffSegment[] = [];
  const show = (items: BlockDiffRow[]) => {
    if (items.length === 0) return;
    const last = segments.at(-1);
    if (last?.kind === 'rows') last.rows.push(...items);
    else segments.push({ kind: 'rows', rows: [...items] });
  };
  let index = 0;
  while (index < rows.length) {
    if (rows[index]?.kind !== 'same') {
      show([rows[index] as BlockDiffRow]);
      index += 1;
      continue;
    }
    let end = index;
    while (rows[end]?.kind === 'same') end += 1;
    const run = rows.slice(index, end);
    const lead = index > 0 ? context : 0;
    const trail = end < rows.length ? context : 0;
    if (run.length - lead - trail >= 2) {
      show(run.slice(0, lead));
      segments.push({ kind: 'collapsed', rows: run.slice(lead, run.length - trail) });
      show(run.slice(run.length - trail));
    } else {
      show(run);
    }
    index = end;
  }
  return segments;
}
