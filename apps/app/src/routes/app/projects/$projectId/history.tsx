import { Button } from '@nibleaf/design-system/components/ui/button';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import { useT } from '@nibleaf/i18n/react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { GitMerge, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { QueryErrorState } from '@/components/query-error-state';
import { useChangeRequestHistory } from '@/hooks/api';
import { useFormatters } from '@/lib/format';

export const Route = createFileRoute('/app/projects/$projectId/history')({
  component: HistoryPage,
});

/** Merged change requests, newest merge first, a page at a time. */
function HistoryPage() {
  const t = useT();
  const { projectId } = Route.useParams();
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);

  return (
    <div className="w-full px-6 py-8 xl:px-10">
      <h1 className="font-semibold text-2xl tracking-tight">{t('changeRequest.history.title')}</h1>
      <p className="mt-1 text-muted-foreground text-sm">{t('changeRequest.history.subtitle')}</p>
      <div className="mt-6 overflow-hidden rounded-xl border border-border bg-card">
        <ul className="divide-y divide-border">
          {cursors.map((cursor, index) => (
            <HistoryChunk
              key={cursor ?? ''}
              projectId={projectId}
              cursor={cursor}
              first={index === 0}
              onMore={index === cursors.length - 1 ? (next) => setCursors((current) => [...current, next]) : undefined}
            />
          ))}
        </ul>
      </div>
    </div>
  );
}

/** One fetched page of the history; the last one offers the next. */
function HistoryChunk({
  projectId,
  cursor,
  first,
  onMore,
}: {
  projectId: string;
  cursor: string | undefined;
  first: boolean;
  onMore?: (cursor: string) => void;
}) {
  const t = useT();
  const { relativeTime } = useFormatters();
  const { data, isPending, isError, refetch, isRefetching } = useChangeRequestHistory(projectId, cursor);

  if (isPending) {
    return first ? (
      <li className="space-y-3 p-4">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-5 w-1/2" />
      </li>
    ) : (
      <li className="flex justify-center p-3">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      </li>
    );
  }
  if (isError) {
    return (
      <li>
        <QueryErrorState onRetry={() => void refetch()} retrying={isRefetching} />
      </li>
    );
  }
  if (first && data.items.length === 0) {
    return <li className="px-4 py-10 text-center text-muted-foreground text-sm">{t('changeRequest.history.empty')}</li>;
  }
  const next = data.nextCursor;
  return (
    <>
      {data.items.map((entry) => (
        <li key={entry.id}>
          <Link
            to="/app/projects/$projectId/changes/$number"
            params={{ projectId, number: String(entry.number) }}
            className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
          >
            <GitMerge className="size-4 shrink-0 text-violet-600 dark:text-violet-300" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium text-sm" dir="auto">
                {entry.title}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-muted-foreground text-xs">
                <span dir="ltr">#{entry.number}</span>
                <span aria-hidden>·</span>
                <span dir="auto">{entry.author?.name ?? t('changeRequest.unknownAuthor')}</span>
                {entry.mergedAt ? (
                  <>
                    <span aria-hidden>·</span>
                    <span>
                      {t('changeRequest.mergedBy', {
                        name: entry.mergedBy?.name ?? t('changeRequest.unknownAuthor'),
                        time: relativeTime(entry.mergedAt),
                      })}
                    </span>
                  </>
                ) : null}
              </div>
            </div>
            <span className="shrink-0 text-muted-foreground text-xs">{t('changeRequest.history.pages', { count: entry.pagesCount })}</span>
          </Link>
        </li>
      ))}
      {next && onMore ? (
        <li className="flex justify-center p-2">
          <Button size="sm" variant="ghost" onClick={() => onMore(next)}>
            {t('changeRequest.history.loadMore')}
          </Button>
        </li>
      ) : null}
    </>
  );
}
