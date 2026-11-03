// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WikiDirectory, type WikiDirectoryEntry } from './wiki-directory';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const roots: Array<ReturnType<typeof createRoot>> = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren();
});

async function render(wikis: WikiDirectoryEntry[]) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(<WikiDirectory wikis={wikis} />));
  return container;
}

const wiki = (id: string, over: Partial<WikiDirectoryEntry> = {}): WikiDirectoryEntry => ({
  id,
  name: id,
  description: null,
  icon: null,
  logo: null,
  url: `https://wiki.example/${id}`,
  ...over,
});

const names = (container: HTMLElement) => [...container.querySelectorAll('li a')].map((link) => link.textContent);

async function type(container: HTMLElement, value: string) {
  const input = container.querySelector('input');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input?.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('WikiDirectory', () => {
  it('links each wiki to its public URL', async () => {
    const container = await render([wiki('handbook', { description: 'Team docs', icon: '📘' }), wiki('guide', { logo: '/logo.svg' })]);
    expect([...container.querySelectorAll('li a')].map((link) => link.getAttribute('href'))).toEqual([
      'https://wiki.example/handbook',
      'https://wiki.example/guide',
    ]);
    expect(names(container)).toEqual(['📘handbookTeam docs', 'guide']);
    expect(container.querySelector('img')?.getAttribute('referrerpolicy')).toBe('no-referrer');
  });

  it('filters by name and description, case-insensitively', async () => {
    const container = await render([wiki('Handbook'), wiki('Guide', { description: 'Onboarding for new hires' })]);
    await type(container, 'HAND');
    expect(names(container)).toEqual(['HHandbook']);
    await type(container, 'onboarding');
    expect(names(container)).toEqual(['GGuideOnboarding for new hires']);
    await type(container, 'nothing');
    expect(names(container)).toEqual([]);
    expect(container.textContent).toContain('No wikis match your filter.');
  });

  it('shows an empty state without a filter when nothing is published', async () => {
    const container = await render([]);
    expect(container.querySelector('input')).toBeNull();
    expect(container.textContent).toContain('No wikis are published yet.');
  });
});
