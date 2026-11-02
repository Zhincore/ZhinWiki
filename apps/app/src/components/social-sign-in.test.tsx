// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ social: vi.fn() }));

vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string, params?: { provider?: string }) => `${key}:${params?.provider ?? ''}` }));
vi.mock('@/services/auth-client', () => ({ signIn: { social: mocks.social } }));

import { SocialSignIn } from './social-sign-in';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const container = document.createElement('div');
document.body.append(container);
const root = createRoot(container);

afterEach(async () => {
  await act(async () => root.render(null));
  mocks.social.mockReset();
});

const render = (enabled: Record<string, boolean> | undefined, onError = vi.fn()) =>
  act(async () => root.render(<SocialSignIn callbackURL="/app" enabled={enabled} mode="signIn" onError={onError} />));

it('shows a button only for each configured provider', async () => {
  await render({ google: false, github: true, discord: true });
  const labels = [...container.querySelectorAll('button')].map((button) => button.textContent);
  expect(labels).toEqual(['auth.social.signIn:GitHub', 'auth.social.signIn:Discord']);
});

it('renders nothing, not even the divider, when no provider is configured', async () => {
  await render({ google: false, github: false, discord: false });
  expect(container.innerHTML).toBe('');
  await render(undefined);
  expect(container.innerHTML).toBe('');
});

it('starts the chosen provider with the post-auth destination, clearing an earlier error', async () => {
  mocks.social.mockReturnValue(new Promise(() => undefined));
  const onError = vi.fn();
  await render({ discord: true }, onError);
  await act(async () => container.querySelector('button')?.click());
  expect(mocks.social).toHaveBeenCalledWith({ provider: 'discord', callbackURL: '/app' });
  expect(onError).toHaveBeenCalledWith(null);
  expect(container.querySelector('button')?.disabled).toBe(true);
});
