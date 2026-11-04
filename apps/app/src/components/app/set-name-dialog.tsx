import { Button } from '@nibleaf/design-system/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@nibleaf/design-system/components/ui/dialog';
import { FieldError } from '@nibleaf/design-system/components/ui/form-field';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { useT } from '@nibleaf/i18n/react';
import { useNavigate } from '@tanstack/react-router';
import { LogOut } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import { authClient } from '@/services/auth-client';

const subscribeToHydration = () => () => undefined;

/** Blocking prompt for a display name, shown while the signed-in user has none.
 *  It closes only once the refreshed session carries a name; signing out is the other exit. */
export function SetNameDialog({ name: currentName, onSaved }: { name: string | null | undefined; onSaved: () => unknown }) {
  const t = useT();
  const navigate = useNavigate();
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );
  const [name, setName] = useState('');
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!name.trim()) return;
    setSubmitting(true);
    setError(undefined);
    try {
      const res = await authClient.updateUser({ name: name.trim() });
      if (res?.error) {
        setError(res.error.message || t('settings.account.name.error'));
        return;
      }
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings.account.name.error'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog disablePointerDismissal open={hydrated && !currentName?.trim()}>
      <DialogContent showCloseButton={false}>
        <form
          className="flex flex-col gap-6"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('account.setName.title')}</DialogTitle>
            <DialogDescription>{t('account.setName.description')}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="set-name">{t('settings.account.name.label')}</Label>
            <Input autoComplete="name" autoFocus dir="auto" id="set-name" onChange={(event) => setName(event.target.value)} value={name} />
            <FieldError errors={error ? [error] : []} />
          </div>
          <DialogFooter>
            <Button
              onClick={async () => {
                await authClient.signOut();
                navigate({ to: '/sign-in' });
              }}
              className="sm:me-auto"
              type="button"
              variant="ghost"
            >
              <LogOut className="size-4" /> {t('account.signOut')}
            </Button>
            <Button disabled={submitting || !name.trim()} type="submit">
              {submitting ? t('common.saving') : t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
