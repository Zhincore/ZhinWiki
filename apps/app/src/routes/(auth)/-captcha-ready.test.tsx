// @vitest-environment jsdom

import { act, type ComponentType, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ publicMeta: vi.fn(), send: vi.fn(), navigate: vi.fn() }));

vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options, useSearch: () => ({ email: 'synthetic@example.test' }) }),
  useNavigate: () => mocks.navigate,
  Link: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock('@/hooks/api/public', () => ({ useGetPublicMeta: mocks.publicMeta }));
vi.mock('@/hooks/use-tenancy', () => ({ useTenancy: () => 'independent' }));
vi.mock('@/layouts/auth', () => ({ AuthLayout: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('@/services/auth-client', () => ({ authClient: { emailOtp: { sendVerificationOtp: mocks.send } }, signIn: {} }));
vi.mock('@/lib/invitations', () => ({ readPendingInvitation: () => null }));

import { Route } from './sign-in';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
// input-otp checks password-manager badge geometry; jsdom has no hit testing.
document.elementFromPoint = () => null;
const SignInPage = Route.options.component as unknown as ComponentType;
const loadedMeta = { isPending: false, data: { signupDisabled: false, providers: { google: false }, captcha: { provider: 'off', siteKey: null } } };

describe('sign-in before the instance meta loads', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.publicMeta.mockReturnValue({ isPending: true, data: undefined });
    mocks.send.mockResolvedValue({ error: null });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  const render = () => act(async () => root.render(<SignInPage />));
  const submitButton = () => container.querySelector<HTMLButtonElement>('button[type="submit"]');

  it('ignores a submit while the captcha config is unknown, then sends once meta has loaded', async () => {
    await render();
    expect(submitButton()?.disabled).toBe(true);
    await act(async () => container.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(mocks.send).not.toHaveBeenCalled();

    mocks.publicMeta.mockReturnValue(loadedMeta);
    await render();
    expect(submitButton()?.disabled).toBe(false);
    await act(async () => submitButton()?.click());
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});
