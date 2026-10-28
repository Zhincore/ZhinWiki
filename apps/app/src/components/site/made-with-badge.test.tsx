// @vitest-environment jsdom
import { BrandProvider } from '@nibleaf/design-system/brand';
import { DEFAULT_BRAND, SOFTWARE } from '@nibleaf/shared/brand';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MadeWithBadge } from './made-with-badge';

describe('MadeWithBadge', () => {
  it('credits the software, not the instance name, and keeps the instance abuse contact', () => {
    const brand = {
      ...DEFAULT_BRAND,
      name: 'Mikoshi',
      url: 'https://wiki.example.test',
      abuseEmail: 'abuse@wiki.example.test',
      markUrl: '/brand-assets/mark.svg',
    };
    const container = document.createElement('div');
    container.innerHTML = renderToString(
      <BrandProvider brand={brand}>
        <MadeWithBadge />
      </BrandProvider>,
    );

    expect(container.textContent).toContain(SOFTWARE.name);
    expect(container.textContent).not.toContain('Mikoshi');
    expect([...container.querySelectorAll('a')].map((link) => link.getAttribute('href'))).toEqual([SOFTWARE.url, 'mailto:abuse@wiki.example.test']);
    expect(container.querySelector('img')).toBeNull();
  });
});
