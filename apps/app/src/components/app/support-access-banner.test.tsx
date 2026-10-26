/** @vitest-environment jsdom */

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ stopImpersonating: vi.fn() }));

vi.mock('@nibleaf/i18n/react', () => ({
  useT: () => (key: string, variables?: Record<string, string>) => (variables ? `${key}(${Object.values(variables).join(',')})` : key),
}));
vi.mock('@/services/auth-client', () => ({ authClient: { admin: { stopImpersonating: mocks.stopImpersonating } } }));

import { SupportAccessBanner } from './support-access-banner';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const roots: Array<ReturnType<typeof createRoot>> = [];

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await act(async () => root.unmount());
  }
  document.body.replaceChildren();
  vi.clearAllMocks();
});

async function render(customerName?: string | null, adminUrl: string | null = 'https://admin.example.test') {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(<SupportAccessBanner adminUrl={adminUrl} customerId="user-1" customerName={customerName} />));
  return container;
}

describe('SupportAccessBanner', () => {
  it('localizes the stop button and falls back to the translated customer label', async () => {
    const container = await render(null);

    expect(container.querySelector('button')?.textContent).toBe('support.banner.stop');
    expect(container.textContent).toContain('support.banner.viewingAs(support.banner.customerFallback)');
  });

  it('shows the localized error when stopping support access fails without a message', async () => {
    mocks.stopImpersonating.mockResolvedValue({ error: { message: '' } });
    const container = await render('Layla');

    await act(async () => container.querySelector('button')?.click());

    expect(container.querySelector('[role="alert"]')?.textContent).toBe('support.banner.stopError');
    expect(container.querySelector('button')?.textContent).toBe('support.banner.stop');
  });

  it.each([
    ['https://admin.example.test', 'https://admin.example.test/users/user-1'],
    [null, '/app'],
  ])('returns to the operator console %s after stopping', async (adminUrl, target) => {
    const assign = vi.fn();
    vi.stubGlobal('location', { assign });
    mocks.stopImpersonating.mockResolvedValue({});
    const container = await render('Layla', adminUrl);

    await act(async () => container.querySelector('button')?.click());

    expect(assign).toHaveBeenCalledWith(target);
    vi.unstubAllGlobals();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  });
});
