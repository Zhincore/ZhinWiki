import { protectMarkdownCode } from '@nibleaf/shared/markdown-code';
export interface ImportReference {
  value: string;
  start: number;
  end: number;
  image: boolean;
}

const escaped = (source: string, index: number): boolean => {
  let start = index;
  while (source[start - 1] === '\\') start--;
  return (index - start) % 2 === 1;
};

export const markdownReferences = (source: string): ImportReference[] => {
  const labels = new Map<number, number>();
  const destinations = new Map<number, number>();
  const brackets: number[] = [];
  const parentheses: number[] = [];
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (character === '\\') {
      index++;
      continue;
    }
    if (character === '[') brackets.push(index);
    else if (character === ']' && brackets.length) labels.set(index, brackets.pop() ?? 0);
    else if (character === '(') parentheses.push(index);
    else if (character === ')' && parentheses.length) destinations.set(parentheses.pop() ?? 0, index);
  }
  const references: ImportReference[] = [];
  // Labels are read in closing order, as Markdown does, and each destination only
  // once, so nested or crossed pairs stay linear and references can't overlap.
  let scanned = 0;
  for (const [labelEnd, label] of labels) {
    const end = destinations.get(labelEnd + 1);
    if (end === undefined || labelEnd < scanned) continue;
    scanned = end;
    const image = source[label - 1] === '!' && !escaped(source, label - 1);
    let start = labelEnd + 2;
    let referenceEnd = end;
    if (source[start] === '<') {
      referenceEnd = start + 1;
      while (referenceEnd < end && source[referenceEnd] !== '>') referenceEnd++;
      if (referenceEnd === end) continue;
      start++;
    } else {
      for (let offset = start; offset < end; offset++) {
        if (/\s/.test(source[offset] ?? '')) {
          referenceEnd = offset;
          break;
        }
      }
    }
    const suffix = source.slice(referenceEnd + (source[referenceEnd] === '>' ? 1 : 0), end).trim();
    if (referenceEnd > start && (!suffix || ((suffix[0] === '"' || suffix[0] === "'") && suffix.at(-1) === suffix[0]))) {
      // An image description is alt text, so nothing read inside it is a reference.
      while (image && (references.at(-1)?.start ?? -1) > label) references.pop();
      references.push({ value: source.slice(start, referenceEnd), start, end: referenceEnd, image });
    }
  }
  return references;
};

export const replaceImportReferences = (
  source: string,
  references: readonly ImportReference[],
  rewrite: (reference: ImportReference) => string,
): string => {
  const output: string[] = [];
  let cursor = 0;
  for (const reference of references) {
    output.push(source.slice(cursor, reference.start), rewrite(reference));
    cursor = reference.end;
  }
  output.push(source.slice(cursor));
  return output.join('');
};

export const htmlImageReferences = (source: string): ImportReference[] => {
  const references: ImportReference[] = [];
  for (const tag of source.matchAll(/<(?:img|Image)\b[^<>]*>/gi)) {
    const attribute = /\bsrc\s*=\s*(["'])([^"']*)["']/i.exec(tag[0]);
    if (!attribute) continue;
    const value = attribute[2] ?? '';
    const quote = attribute[0].indexOf(attribute[1] ?? '"');
    const start = tag.index + attribute.index + quote + 1;
    references.push({ value, start, end: start + value.length, image: true });
  }
  return references;
};

export const remoteImageSources = (content: string): string[] => {
  const prose = protectMarkdownCode(content).content;
  return [
    ...new Set(
      [...markdownReferences(prose).filter((reference) => reference.image), ...htmlImageReferences(prose)]
        .map((reference) => reference.value)
        .filter((value) => /^https?:\/\//i.test(value)),
    ),
  ];
};
