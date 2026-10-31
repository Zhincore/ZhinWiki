import { Button } from '@nibleaf/design-system/components/ui/button';
import { SegmentedControl, SegmentedControlItem } from '@nibleaf/design-system/components/ui/segmented-control';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import { useT } from '@nibleaf/i18n/react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { GitPullRequest, Loader2, Plus, User, UserCheck } from 'lucide-react';
import { useMemo } from 'react';
import { z } from 'zod';
import { ChangeRequestStatusBadge } from '@/components/change-requests/change-request-header';
import { QueryErrorState } from '@/components/query-error-state';
import { type ChangeRequestStatus, useChangeRequests, useProject, useStartChangeRequest } from '@/hooks/api';
import { useFormatters } from '@/lib/format';
import { useSession } from '@/services/auth-client';

const FILTERS = {
  open: ['DRAFT', 'IN_REVIEW'],
  merged: ['MERGED'],
  archived: ['ARCHIVED'],
} as const satisfies Record<string, readonly ChangeRequestStatus[]>;

export const Route = createFileRoute('/app/projects/$projectId/changes/')({
  component: ChangeRequestsPage,
  validateSearch: (search) =>
    z
      .object({
        status: z.enum(['open', 'merged', 'archived']).optional().catch(undefined),
        mine: z.preprocess((value) => (value === true || value === 'true' ? true : undefined), z.literal(true).optional()),
        awaiting: z.preprocess((value) => (value === true || value === 'true' ? true : undefined), z.literal(true).optional()),
      })
      .parse(search),
});

function ChangeRequestsPage() {
  const t = useT();
  const { projectId } = Route.useParams();
  const { status = 'open', mine, awaiting } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { relativeTime } = useFormatters();
  const { data: session } = useSession();
  const userId = session?.user.id;
  const { data, isPending, isError, refetch, isRefetching } = useChangeRequests(projectId);
  const startChangeRequest = useStartChangeRequest(projectId);
  const { data: project } = useProject(projectId);
  const reviewer = project !== undefined && project.viewerRole !== 'contributor';
  const rows = useMemo(
    () =>
      (data ?? []).filter(
        (changeRequest) =>
          (FILTERS[status] as readonly ChangeRequestStatus[]).includes(changeRequest.status) &&
          (!mine || changeRequest.authorId === userId) &&
          (!awaiting || Boolean(changeRequest.reviewers?.some((reviewer) => reviewer.userId === userId && reviewer.awaiting))),
      ),
    [data, status, mine, awaiting, userId],
  );

  return (
    <div className="w-full px-6 py-8 xl:px-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-semibold text-2xl tracking-tight">{t('changeRequest.title')}</h1>
          <p className="mt-1 text-muted-foreground text-sm">{t('changeRequest.subtitle')}</p>
        </div>
        <Button size="sm" onClick={startChangeRequest.start} disabled={startChangeRequest.isPending}>
          {startChangeRequest.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} {t('changeRequest.new')}
        </Button>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <SegmentedControl density="compact">
          {(Object.keys(FILTERS) as (keyof typeof FILTERS)[]).map((key) => (
            <SegmentedControlItem
              key={key}
              active={status === key}
              onClick={() => void navigate({ search: (prev) => ({ ...prev, status: key === 'open' ? undefined : key }) })}
            >
              {t(`changeRequest.filter.${key}`)}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
        <Button
          size="sm"
          variant={mine ? 'secondary' : 'outline'}
          aria-pressed={Boolean(mine)}
          onClick={() => void navigate({ search: (prev) => ({ ...prev, mine: mine ? undefined : true }) })}
        >
          <User className="size-3.5" /> {t('changeRequest.filter.yours')}
        </Button>
        {reviewer ? (
          <Button
            size="sm"
            variant={awaiting ? 'secondary' : 'outline'}
            aria-pressed={Boolean(awaiting)}
            onClick={() => void navigate({ search: (prev) => ({ ...prev, awaiting: awaiting ? undefined : true }) })}
          >
            <UserCheck className="size-3.5" /> {t('changeRequest.filter.awaitingReview')}
          </Button>
        ) : null}
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-border bg-card">
        {isPending ? (
          <div className="space-y-3 p-4">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-5 w-1/2" />
          </div>
        ) : isError ? (
          <QueryErrorState onRetry={() => void refetch()} retrying={isRefetching} />
        ) : rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-muted-foreground text-sm">{t('changeRequest.empty')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((changeRequest) => (
              <li key={changeRequest.id}>
                <Link
                  to="/app/projects/$projectId/changes/$number"
                  params={{ projectId, number: String(changeRequest.number) }}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
                >
                  <GitPullRequest className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-sm" dir="auto">
                      {changeRequest.title}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-muted-foreground text-xs">
                      <span dir="ltr">#{changeRequest.number}</span>
                      <span aria-hidden>·</span>
                      <span dir="auto">{changeRequest.author?.name ?? t('changeRequest.unknownAuthor')}</span>
                      <span aria-hidden>·</span>
                      <time dateTime={changeRequest.createdAt}>{relativeTime(changeRequest.createdAt)}</time>
                    </div>
                  </div>
                  <ChangeRequestStatusBadge status={changeRequest.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
