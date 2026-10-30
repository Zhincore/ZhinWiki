import { describe, expect, it } from 'vitest';
import { markdownKey } from './markdown-key';

const same = (a: string, b: string) => markdownKey(a) === markdownKey(b);

describe('markdownKey', () => {
  it('ignores soft wraps, continuation indent and trailing blank lines', () => {
    expect(same('One sentence\nwrapped here.\n', 'One sentence wrapped here.')).toBe(true);
    expect(same('<Note>\n\nA **Note** for\n`<Info>` asides.\n\n</Note>\n\n', '<Note>\n\nA **Note** for `<Info>` asides.\n\n</Note>')).toBe(true);
    expect(same('- item text\n  continues\n- next', '- item text continues\n- next')).toBe(true);
  });

  it('keeps hard breaks, code and component tags', () => {
    expect(same('a  \nb', 'a\nb')).toBe(false);
    expect(same('```js\nconst a = 1;\n```', '```js\nconst a =  1;\n```')).toBe(false);
    expect(same('Use `a  b`', 'Use `a b`')).toBe(false);
    expect(same('<Note>\n\nText\n\n</Note>', '<Warning>\n\nText\n\n</Warning>')).toBe(false);
    expect(same('<Note>\nText\nwrapped\n</Note>', '<Note>\nText wrapped\n</Note>')).toBe(false);
    expect(same('$$\na % c\nb\n$$', '$$ a % c b $$')).toBe(false);
  });

  it('keeps block structure', () => {
    expect(same('- a\n- b', 'a\nb')).toBe(false);
    expect(same('Title\n# Heading', 'Title # Heading')).toBe(false);
    expect(same('| a | b |\n| - | - |\n| 1 | 2 |', '| a | b | | - | - | | 1 | 2 |')).toBe(false);
    expect(same('| a | b |\n| - | - |\n| 1 | 2 |', '| a | b |\n| - | - |\n| 1 | 3 |')).toBe(false);
    expect(same('\\*lit\\*', '*lit*')).toBe(false);
    expect(same('[x](/a)', '[x](/b)')).toBe(false);
  });
});
