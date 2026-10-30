import { Badge } from '@nibleaf/design-system/components/ui/badge';
import { SegmentedControl, SegmentedControlItem } from '@nibleaf/design-system/components/ui/segmented-control';
import { cn } from '@nibleaf/design-system/lib/utils';
import type { MessageKey } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import { Link, useNavigate } from '@tanstack/react-router';
import { ChevronLeft, GitPullRequest } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ChangeRequest, ChangeRequestStatus } from '@/hooks/api';

const STATUS: Record<ChangeRequestStatus, { label: MessageKey; className: string }> = {
  DRAFT: { label: 'changeRequest.status.draft', className: 'border-border text-muted-foreground' },
  IN_REVIEW: { label: 'changeRequest.status.inReview', className: 'bg-amber-500/15 text-amber-800 dark:text-amber-300' },
  MERGED: { label: 'changeRequest.status.merged', className: 'bg-violet-500/15 text-violet-700 dark:text-violet-300' },
  ARCHIVED: { label: 'changeRequest.status.archived', className: 'bg-muted text-muted-foreground' },
};

export function ChangeRequestStatusBadge({ status, className }: { status: ChangeRequestStatus; className?: string }) {
  const t = useT();
  return (
    <Badge variant="outline" className={cn(STATUS[status].className, className)}>
      {t(STATUS[status].label)}
    </Badge>
  );
}

/** Open change requests with a branch take edits; merged and archived ones are read-only. */
export const isChangeRequestEditable = (changeRequest: Pick<ChangeRequest, 'status' | 'branchId'>) =>
  Boolean(changeRequest.branchId) && (changeRequest.status === 'DRAFT' || changeRequest.status === 'IN_REVIEW');

export type ChangeRequestTab = 'overview' | 'editor' | 'changes';

/** Top bar of a change request: back link, title `#n` with status, the
 *  Overview · Editor · Changes tabs, and page-specific actions on the end. */
export function ChangeRequestHeader({
  projectId,
  changeRequest,
  tab,
  back,
  children,
}: {
  projectId: string;
  changeRequest: Pick<ChangeRequest, 'number' | 'title' | 'status' | 'branchId'>;
  tab: ChangeRequestTab;
  back: { to: '/app/projects/$projectId/changes' | '/app/projects/$projectId/editor'; label: string };
  children?: ReactNode;
}) {
  const t = useT();
  const navigate = useNavigate();
  const { number } = changeRequest;
  const open = (next: ChangeRequestTab) => {
    if (next === tab) return;
    if (next === 'editor') {
      void navigate({ to: '/app/projects/$projectId/editor', params: { projectId }, search: { cr: number } });
      return;
    }
    void navigate({
      to: '/app/projects/$projectId/changes/$number',
      params: { projectId, number: String(number) },
      search: next === 'changes' ? { tab: 'changes' } : {},
    });
  };

  return (
    <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-x-2.5 gap-y-1.5 border-border border-b bg-background px-2 py-2 sm:px-3">
      <Link
        to={back.to}
        params={{ projectId }}
        className="flex items-center rounded-md px-1.5 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        title={back.label}
        aria-label={back.label}
      >
        <ChevronLeft className="size-4 rtl:-scale-x-100" />
      </Link>
      <div className="flex min-w-0 items-center gap-2">
        <GitPullRequest className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate font-medium text-sm" dir="auto">
          {changeRequest.title}
        </span>
        <span className="shrink-0 text-muted-foreground text-sm" dir="ltr">
          #{number}
        </span>
        <ChangeRequestStatusBadge status={changeRequest.status} />
      </div>
      <SegmentedControl density="compact" className="sm:ms-2">
        <SegmentedControlItem active={tab === 'overview'} onClick={() => open('overview')}>
          {t('changeRequest.tab.overview')}
        </SegmentedControlItem>
        <SegmentedControlItem active={tab === 'editor'} disabled={!isChangeRequestEditable(changeRequest)} onClick={() => open('editor')}>
          {t('changeRequest.tab.editor')}
        </SegmentedControlItem>
        <SegmentedControlItem active={tab === 'changes'} onClick={() => open('changes')}>
          {t('changeRequest.tab.changes')}
        </SegmentedControlItem>
      </SegmentedControl>
      {children ? <div className="ms-auto flex items-center gap-1.5 sm:gap-2">{children}</div> : null}
    </header>
  );
}
