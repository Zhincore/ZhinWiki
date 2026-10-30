import { describe, expect, it } from 'vitest';
import { collapseUnchanged, diffBlocks, splitBlocks } from './block-diff';

describe('splitBlocks', () => {
  it('splits top-level blocks and keeps a list or fenced code whole', () => {
    expect(splitBlocks('# Title\n\nIntro text\nsecond line\n\n- a\n- b\n\n```js\nconst a = 1;\n\nconst b = 2;\n```\n')).toEqual([
      '# Title',
      'Intro text\nsecond line',
      '- a\n- b',
      '```js\nconst a = 1;\n\nconst b = 2;\n```',
    ]);
  });

  it('keeps a component with blank-line separated children in one block', () => {
    expect(splitBlocks('<Card title="A">\n\nInside\n\n</Card>\n\nAfter\n\n<Icon name="x" />\n')).toEqual([
      '<Card title="A">\n\nInside\n\n</Card>',
      'After',
      '<Icon name="x" />',
    ]);
  });

  it('closes a component whose closing tag follows a paragraph line', () => {
    expect(splitBlocks('<Card>\n\nInside text\n</Card>\n\nAfter\n\nMore')).toEqual(['<Card>\n\nInside text\n</Card>', 'After', 'More']);
  });

  it('ignores component tags inside inline code and fenced code', () => {
    expect(splitBlocks('Use `<Card>` here\n\n```\n<Steps>\n```\n\nAfter')).toEqual(['Use `<Card>` here', '```\n<Steps>\n```', 'After']);
  });

  it('ends an unclosed component at the end of the document', () => {
    expect(splitBlocks('Before\n\n<Steps>\n\nStep one\n')).toEqual(['Before', '<Steps>\n\nStep one']);
  });

  it('returns no blocks for empty content', () => {
    expect(splitBlocks('')).toEqual([]);
    expect(splitBlocks('\n\n  \n')).toEqual([]);
  });
});

describe('diffBlocks', () => {
  it('marks every block added for a new page and removed for a deleted one', () => {
    expect(diffBlocks('', 'A\n\nB')).toEqual([
      { kind: 'added', block: 'A' },
      { kind: 'added', block: 'B' },
    ]);
    expect(diffBlocks('A\n\nB', '')).toEqual([
      { kind: 'removed', block: 'A' },
      { kind: 'removed', block: 'B' },
    ]);
  });

  it('pairs an edited block as changed between unchanged neighbours', () => {
    expect(diffBlocks('A\n\nB\n\nC', 'A\n\nB edited\n\nC')).toEqual([
      { kind: 'same', block: 'A' },
      { kind: 'changed', before: 'B', after: 'B edited' },
      { kind: 'same', block: 'C' },
    ]);
  });

  it('keeps the excess of an uneven replacement as added or removed', () => {
    expect(diffBlocks('A\n\nB\n\nZ', 'A\n\nX\n\nY\n\nZ')).toEqual([
      { kind: 'same', block: 'A' },
      { kind: 'changed', before: 'B', after: 'X' },
      { kind: 'added', block: 'Y' },
      { kind: 'same', block: 'Z' },
    ]);
  });

  it('ignores whitespace-only differences between blocks', () => {
    expect(diffBlocks('A\n\nB\n', 'A\n\n\n\nB   \n\n').every((row) => row.kind === 'same')).toBe(true);
  });
});

describe('collapseUnchanged', () => {
  const same = (block: string) => ({ kind: 'same' as const, block });

  it('folds an unchanged document into one collapsed segment', () => {
    expect(collapseUnchanged([same('A'), same('B'), same('C')])).toEqual([{ kind: 'collapsed', rows: [same('A'), same('B'), same('C')] }]);
  });

  it('keeps one block of context on each side of a change', () => {
    const added = { kind: 'added' as const, block: 'X' };
    expect(collapseUnchanged([same('A'), same('B'), same('C'), added, same('D'), same('E'), same('F')])).toEqual([
      { kind: 'collapsed', rows: [same('A'), same('B')] },
      { kind: 'rows', rows: [same('C'), added, same('D')] },
      { kind: 'collapsed', rows: [same('E'), same('F')] },
    ]);
  });

  it('never folds a single block', () => {
    const added = { kind: 'added' as const, block: 'X' };
    expect(collapseUnchanged([same('A'), same('B'), added])).toEqual([{ kind: 'rows', rows: [same('A'), same('B'), added] }]);
  });
});
