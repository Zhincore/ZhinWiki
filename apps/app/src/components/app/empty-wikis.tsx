import { Button } from '@nibleaf/design-system/components/ui/button';
import { useT } from '@nibleaf/i18n/react';
import { Plus } from 'lucide-react';
import { useTenancy } from '@/hooks/use-tenancy';

/** Copy and call to action for a user with no wikis. Independent tenancy keeps the
 *  generic copy (`withBody` toggles its body line); shared tenancy invites
 *  admins to create the first wiki and tells everyone else where wikis appear. */
export function EmptyWikis({ canCreate, onCreate, withBody = false }: { canCreate: boolean; onCreate?: () => void; withBody?: boolean }) {
  const t = useT();
  const shared = useTenancy() === 'shared';
  const body = shared ? 'dashboard.empty.firstWiki.body' : withBody ? 'dashboard.empty.body' : null;
  if (!canCreate) {
    return (
      <>
        <p className="mt-3 font-medium">{t('dashboard.empty.contributor.title')}</p>
        <p className="mt-1 max-w-sm text-muted-foreground text-sm">{t('dashboard.empty.contributor.body')}</p>
      </>
    );
  }
  return (
    <>
      <p className="mt-3 font-medium">{t(shared ? 'dashboard.empty.firstWiki.title' : 'dashboard.empty.title')}</p>
      {body ? <p className="mt-1 max-w-sm text-muted-foreground text-sm">{t(body)}</p> : null}
      <Button className="mt-4" onClick={onCreate}>
        <Plus className="size-4" /> {t(shared ? 'dashboard.empty.firstWiki.cta' : 'dashboard.empty.cta')}
      </Button>
    </>
  );
}
