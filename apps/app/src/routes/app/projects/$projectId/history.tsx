import { Button } from '@nibleaf/design-system/components/ui/button';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import { useT } from '@nibleaf/i18n/react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { GitMerge, Loader2 } from 'lucide-react';
import { useUserName } from '@/components/change-requests/user-name';
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

  return (
    <div className="w-full px-6 py-8 xl:px-10">
      <h1 className="font-semibold text-2xl tracking-tight">{t('changeRequest.history.title')}</h1>
      <p className="mt-1 text-muted-foreground text-sm">{t('changeRequest.history.subtitle')}</p>
      <div className="mt-6 overflow-hidden rounded-xl border border-border bg-card">
        <ul className="divide-y divide-border">
          <HistoryList projectId={projectId} />
        </ul>
      </div>
    </div>
  );
}

/** The loaded history pages, with the next one on demand. */
function HistoryList({ projectId }: { projectId: string }) {
  const t = useT();
  const { relativeTime } = useFormatters();
  const userName = useUserName();
  const { data, isPending, isError, refetch, isRefetching, hasNextPage, fetchNextPage, isFetchingNextPage, isFetchNextPageError } =
    useChangeRequestHistory(projectId);

  if (isPending) {
    return (
      <li className="space-y-3 p-4">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-5 w-1/2" />
      </li>
    );
  }
  if (isError && !isFetchNextPageError) {
    return (
      <li>
        <QueryErrorState onRetry={() => void refetch()} retrying={isRefetching} />
      </li>
    );
  }
  const items = data.pages.flatMap((page) => page.items);
  if (items.length === 0) {
    return <li className="px-4 py-10 text-center text-muted-foreground text-sm">{t('changeRequest.history.empty')}</li>;
  }
  return (
    <>
      {items.map((entry) => (
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
                <span dir="auto">{userName(entry.author)}</span>
                {entry.mergedAt ? (
                  <>
                    <span aria-hidden>·</span>
                    <span>
                      {t('changeRequest.mergedBy', {
                        name: userName(entry.mergedBy),
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
      {isFetchNextPageError ? (
        <li>
          <QueryErrorState onRetry={() => void fetchNextPage()} retrying={isFetchingNextPage} />
        </li>
      ) : hasNextPage ? (
        <li className="flex justify-center p-2">
          <Button size="sm" variant="ghost" disabled={isFetchingNextPage} onClick={() => void fetchNextPage()}>
            {isFetchingNextPage ? <Loader2 className="size-4 animate-spin" /> : t('changeRequest.history.loadMore')}
          </Button>
        </li>
      ) : null}
    </>
  );
}
