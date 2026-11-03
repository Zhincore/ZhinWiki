import { describe, expect, it } from 'vitest';
import { textSearchConfig, textSearchConfigs } from './text-search';

describe('textSearchConfig', () => {
  it('maps regional codes to their language configuration', () => {
    expect(textSearchConfig('pt-BR')).toBe('portuguese');
    expect(textSearchConfig('AR')).toBe('arabic');
    expect(textSearchConfig('en_US')).toBe('english');
  });

  it('falls back to simple for languages without a stemmer', () => {
    for (const code of ['zh-CN', 'bn', 'ur', 'ja', '']) expect(textSearchConfig(code)).toBe('simple');
  });

  it('lists every returned configuration once', () => {
    expect(new Set(textSearchConfigs).size).toBe(textSearchConfigs.length);
    expect(textSearchConfigs).toContain('simple');
  });
});
