import { Button } from '@nibleaf/design-system/components/ui/button';
import { useT } from '@nibleaf/i18n/react';
import { Plus } from 'lucide-react';
import { useTenancy } from '@/hooks/use-tenancy';

/** Copy and call to action for a user with no wikis. Multi tenancy keeps the
 *  generic copy (`withBody` toggles its body line); single tenancy invites
 *  admins to create the first wiki and tells everyone else where wikis appear. */
export function EmptyWikis({ canCreate, onCreate, withBody = false }: { canCreate: boolean; onCreate: () => void; withBody?: boolean }) {
  const t = useT();
  const single = useTenancy() === 'single';
  const body = single ? 'dashboard.empty.firstWiki.body' : withBody ? 'dashboard.empty.body' : null;
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
      <p className="mt-3 font-medium">{t(single ? 'dashboard.empty.firstWiki.title' : 'dashboard.empty.title')}</p>
      {body ? <p className="mt-1 max-w-sm text-muted-foreground text-sm">{t(body)}</p> : null}
      <Button className="mt-4" onClick={onCreate}>
        <Plus className="size-4" /> {t(single ? 'dashboard.empty.firstWiki.cta' : 'dashboard.empty.cta')}
      </Button>
    </>
  );
}
