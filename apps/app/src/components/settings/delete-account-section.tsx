import { ACCOUNT_DELETION_ERROR, type BlockingWorkspace } from '@nibleaf/auth/account-deletion-errors';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { usePrompt } from '@nibleaf/design-system/components/ui/confirm';
import { useT } from '@nibleaf/i18n/react';
import { Link, useNavigate } from '@tanstack/react-router';
import { TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { authClient } from '@/services/auth-client';
import { SettingsSection } from './section';

type Blocker = { kind: 'workspaces'; workspaces: BlockingWorkspace[] } | { kind: 'session' };

/** Danger-zone account deletion: type-the-email confirmation, then Better Auth `deleteUser`. */
export function DeleteAccountSection({ email }: { email: string }) {
  const t = useT();
  const prompt = usePrompt();
  const navigate = useNavigate();
  const [isDeleting, setIsDeleting] = useState(false);
  const [blocker, setBlocker] = useState<Blocker | null>(null);

  const deleteAccount = async () => {
    const typed = await prompt({
      title: t('settings.account.delete.title'),
      description: t('settings.account.delete.confirm'),
      label: t('settings.account.delete.typeToConfirm', { email }),
      placeholder: email,
      confirmLabel: t('settings.account.delete.button'),
    });
    if (typed === null) return;
    if (typed.trim().toLowerCase() !== email.toLowerCase()) {
      toast.error(t('settings.account.delete.mismatch'));
      return;
    }
    setIsDeleting(true);
    try {
      const res = await authClient.deleteUser({});
      if (!res.error) {
        toast.success(t('settings.account.delete.deleted'));
        window.location.assign('/');
        return;
      }
      if (res.error.code === ACCOUNT_DELETION_ERROR.OWNS_SHARED_WORKSPACES) {
        setBlocker({ kind: 'workspaces', workspaces: (res.error as { workspaces?: BlockingWorkspace[] }).workspaces ?? [] });
      } else if (res.error.code === 'SESSION_EXPIRED') {
        setBlocker({ kind: 'session' });
      } else if (res.error.code === ACCOUNT_DELETION_ERROR.ERASURE_PENDING) {
        toast.error(t('settings.account.delete.pending'));
      } else {
        toast.error(res.error.message ?? t('settings.account.delete.error'));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings.account.delete.error'));
    } finally {
      setIsDeleting(false);
    }
  };

  const signInAgain = async () => {
    await authClient.signOut();
    navigate({ to: '/sign-in' });
  };

  return (
    <SettingsSection
      className="border-destructive/30"
      title={
        <span className="flex items-center gap-2 text-destructive">
          <TriangleAlert aria-hidden className="size-4" />
          {t('settings.account.delete.title')}
        </span>
      }
      description={t('settings.account.delete.description')}
      action={
        <Button disabled={isDeleting} onClick={deleteAccount} variant="destructive">
          {isDeleting ? t('settings.account.delete.deleting') : t('settings.account.delete.button')}
        </Button>
      }
    >
      {blocker?.kind === 'workspaces' ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm" role="alert">
          <p>{t('settings.account.delete.blocked')}</p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {blocker.workspaces.map((workspace) => (
              <li className="flex flex-wrap items-center justify-between gap-2" key={workspace.organizationId}>
                <span className="font-medium" dir="auto">
                  {workspace.name}
                </span>
                {workspace.projectId ? (
                  <Link
                    className="text-primary underline-offset-4 hover:underline"
                    params={{ projectId: workspace.projectId }}
                    search={{ section: 'danger' }}
                    to="/app/projects/$projectId/settings"
                  >
                    {t('settings.account.delete.transfer')}
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {blocker?.kind === 'session' ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm" role="alert">
          <p className="flex-1">{t('settings.account.delete.sessionExpired')}</p>
          <Button onClick={signInAgain} size="sm" variant="outline">
            {t('settings.account.delete.signInAgain')}
          </Button>
        </div>
      ) : null}
    </SettingsSection>
  );
}
