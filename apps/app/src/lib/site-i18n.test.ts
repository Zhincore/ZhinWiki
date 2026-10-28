import { siteT } from '@nibleaf/i18n/site';
import { describe, expect, it } from 'vitest';

describe('published-site reader localization', () => {
  it('resolves Arabic language variants to the Arabic catalog', () => {
    expect(siteT('ar-SA')('copyCode')).toBe(siteT('ar')('copyCode'));
    expect(siteT('ar-SA')('copyCode')).not.toBe(siteT('en')('copyCode'));
  });

  it('localizes shipped LTR languages and uses English for unshipped locales', () => {
    expect(siteT('en')('copyCode')).toBe('Copy code');
    expect(siteT('fr-CA')('showProperties')).toBe('Afficher les propriétés');
    expect(siteT('it')('showProperties')).toBe('Show properties');
  });
});
