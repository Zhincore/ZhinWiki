import { Button } from '@nibleaf/design-system/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@nibleaf/design-system/components/ui/dropdown-menu';
import { useT } from '@nibleaf/i18n/react';
import { useNavigate } from '@tanstack/react-router';
import { GitPullRequest, List } from 'lucide-react';
import { useMemo } from 'react';
import { useChangeRequests } from '@/hooks/api';
import { isChangeRequestEditable } from './change-request-header';

/** Editor dropdown of open change requests (the viewer's first) to continue one. */
export function ChangeRequestsMenu({ projectId, userId }: { projectId: string; userId: string | undefined }) {
  const t = useT();
  const navigate = useNavigate();
  const { data } = useChangeRequests(projectId);
  const open = useMemo(
    () =>
      (data ?? [])
        .filter(isChangeRequestEditable)
        .sort((a, b) => Number(b.authorId === userId) - Number(a.authorId === userId) || b.number - a.number),
    [data, userId],
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button size="sm" variant="outline" className="gap-1.5" aria-label={t('changeRequest.title')}>
            <GitPullRequest className="size-3.5" />
            <span className="hidden md:inline">{t('changeRequest.title')}</span>
            {open.length > 0 ? <span className="text-muted-foreground text-xs">{open.length}</span> : null}
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-72">
        {open.length === 0 ? <p className="px-2 py-1.5 text-muted-foreground text-sm">{t('changeRequest.menu.empty')}</p> : null}
        {open.map((changeRequest) => (
          <DropdownMenuItem
            key={changeRequest.id}
            onClick={() => void navigate({ to: '/app/projects/$projectId/editor', params: { projectId }, search: { cr: changeRequest.number } })}
          >
            <GitPullRequest className="size-3.5 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate" dir="auto">
              {changeRequest.title}
            </span>
            <span className="text-muted-foreground text-xs" dir="ltr">
              #{changeRequest.number}
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void navigate({ to: '/app/projects/$projectId/changes', params: { projectId } })}>
          <List className="size-3.5" /> {t('changeRequest.menu.viewAll')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
