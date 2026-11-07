/** @vitest-environment jsdom */

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ updateUser: vi.fn(), signOut: vi.fn(), navigate: vi.fn() }));

vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('@/services/auth-client', () => ({ authClient: { updateUser: mocks.updateUser, signOut: mocks.signOut } }));

import { SetNameDialog } from './set-name-dialog';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const roots: Array<ReturnType<typeof createRoot>> = [];

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
});

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await act(async () => root.unmount());
  }
  document.body.replaceChildren();
  vi.clearAllMocks();
});

async function render(name: string | null, onSaved = vi.fn()) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(<SetNameDialog name={name} onSaved={onSaved} />));
  return onSaved;
}

const input = () => document.querySelector<HTMLInputElement>('#set-name');

async function type(value: string) {
  const field = input();
  if (!field) throw new Error('name input missing');
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    setValue?.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('SetNameDialog', () => {
  it.each([null, '', '   '])('shows the prompt without a close button when the name is %j', async (name) => {
    await render(name);

    expect(document.body.textContent).toContain('account.setName.title');
    expect(input()).not.toBeNull();
    expect(document.querySelector('[data-slot="dialog-close"]')).toBeNull();
  });

  it('renders nothing when the user already has a name', async () => {
    await render('Layla');

    expect(input()).toBeNull();
    expect(document.body.textContent).not.toContain('account.setName.title');
  });

  it('saves the trimmed name and refreshes the session', async () => {
    mocks.updateUser.mockResolvedValue({ data: { status: true }, error: null });
    const onSaved = await render('');

    await type('  Layla  ');
    await act(async () => input()?.form?.requestSubmit());

    expect(mocks.updateUser).toHaveBeenCalledWith({ name: 'Layla' });
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('keeps the dialog open and does not save a whitespace-only name', async () => {
    const onSaved = await render('');

    await type('   ');
    await act(async () => input()?.form?.requestSubmit());

    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(input()).not.toBeNull();
  });
});
