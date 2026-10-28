// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prompt: vi.fn(),
  deleteUser: vi.fn(),
  signOut: vi.fn(),
  navigate: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  assign: vi.fn(),
}));
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.mock('@nibleaf/design-system/components/ui/confirm', () => ({ usePrompt: () => mocks.prompt }));
vi.mock('@/services/auth-client', () => ({ authClient: { deleteUser: mocks.deleteUser, signOut: mocks.signOut } }));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mocks.navigate,
  Link: ({ children, params, search }: { children: ReactNode; params: { projectId: string }; search: { section: string } }) => (
    <a href={`/app/projects/${params.projectId}/settings?section=${search.section}`}>{children}</a>
  ),
}));
vi.mock('sonner', () => ({ toast: { success: mocks.toastSuccess, error: mocks.toastError } }));

import { DeleteAccountSection } from './delete-account-section';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const email = 'ada@example.test';

describe('DeleteAccountSection', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    vi.stubGlobal('location', { ...window.location, assign: mocks.assign });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<DeleteAccountSection email={email} />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  const clickDelete = async () => {
    const button = [...container.querySelectorAll('button')].find((el) => el.textContent === 'settings.account.delete.button');
    await act(async () => button?.click());
  };

  it('does not delete the account when the typed email does not match', async () => {
    mocks.prompt.mockResolvedValue('someone@example.test');
    await clickDelete();
    expect(mocks.deleteUser).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledWith('settings.account.delete.mismatch');
  });

  it('does nothing when the confirmation is cancelled', async () => {
    mocks.prompt.mockResolvedValue(null);
    await clickDelete();
    expect(mocks.deleteUser).not.toHaveBeenCalled();
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it('deletes the account after the email is typed and leaves the dashboard', async () => {
    mocks.prompt.mockResolvedValue(' ADA@example.test ');
    mocks.deleteUser.mockResolvedValue({ data: { success: true }, error: null });
    await clickDelete();
    expect(mocks.deleteUser).toHaveBeenCalledWith({});
    expect(mocks.assign).toHaveBeenCalledWith('/');
  });

  it('lists owned shared workspaces with a link to transfer ownership', async () => {
    mocks.prompt.mockResolvedValue(email);
    mocks.deleteUser.mockResolvedValue({
      data: null,
      error: {
        status: 409,
        code: 'OWNS_SHARED_WORKSPACES',
        message: 'blocked',
        workspaces: [{ organizationId: 'org-1', projectId: 'project-1', name: 'Team docs' }],
      },
    });
    await clickDelete();
    expect(container.textContent).toContain('settings.account.delete.blocked');
    expect(container.textContent).toContain('Team docs');
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/app/projects/project-1/settings?section=danger');
    expect(mocks.assign).not.toHaveBeenCalled();
  });

  it('asks the user to sign in again when the session is no longer fresh', async () => {
    mocks.prompt.mockResolvedValue(email);
    mocks.deleteUser.mockResolvedValue({ data: null, error: { status: 400, code: 'SESSION_EXPIRED', message: 'expired' } });
    mocks.signOut.mockResolvedValue({});
    await clickDelete();
    expect(container.textContent).toContain('settings.account.delete.sessionExpired');
    const signIn = [...container.querySelectorAll('button')].find((el) => el.textContent === 'settings.account.delete.signInAgain');
    await act(async () => signIn?.click());
    expect(mocks.signOut).toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/sign-in' });
  });

  it('reports pending workspace erasure as retryable', async () => {
    mocks.prompt.mockResolvedValue(email);
    mocks.deleteUser.mockResolvedValue({ data: null, error: { status: 409, code: 'WORKSPACE_ERASURE_PENDING', message: 'pending' } });
    await clickDelete();
    expect(mocks.toastError).toHaveBeenCalledWith('settings.account.delete.pending');
  });
});
