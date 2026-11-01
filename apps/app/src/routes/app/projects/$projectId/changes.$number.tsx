import { Button } from '@nibleaf/design-system/components/ui/button';
import { useConfirm } from '@nibleaf/design-system/components/ui/confirm';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import { Textarea } from '@nibleaf/design-system/components/ui/textarea';
import { cn } from '@nibleaf/design-system/lib/utils';
import { useT } from '@nibleaf/i18n/react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Archive, ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, Eye, GitMerge, RotateCcw, Send, TriangleAlert, Undo2 } from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { ChangeRequestHeader, useChangeRequestAccess } from '@/components/change-requests/change-request-header';
import { ChangedPages, ChangeMarker, changeKey, useChangesByLanguage } from '@/components/change-requests/changed-pages';
import { MergeDialog } from '@/components/change-requests/merge-dialog';
import { ApprovalStatus, ParticipantsPanel, ReviewersPanel, ReviewHistory, SubmitReviewMenu } from '@/components/change-requests/reviews';
import { QueryErrorState } from '@/components/query-error-state';
import {
  type ChangeRequestDetail,
  type ChangeRequestPageChange,
  type ChangeRequestStatus,
  type Language,
  useChangeRequest,
  useLanguages,
  useUpdateChangeRequest,
} from '@/hooks/api';
import { useFormatters } from '@/lib/format';

const PageDiff = lazy(() => import('@/components/change-requests/page-diff'));

export const Route = createFileRoute('/app/projects/$projectId/changes/$number')({
  component: ChangeRequestPage,
  validateSearch: (search) => z.object({ tab: z.literal('changes').optional().catch(undefined) }).parse(search),
});

const diffSkeleton = (
  <div className="space-y-2 p-4">
    <Skeleton className="h-4 w-3/4" />
    <Skeleton className="h-4 w-1/2" />
  </div>
);

function ChangeRequestPage() {
  const t = useT();
  const { projectId, number: numberParam } = Route.useParams();
  const { tab } = Route.useSearch();
  const number = Number(numberParam);
  const { data: changeRequest, isError, refetch, isRefetching } = useChangeRequest(projectId, number);
  const { data: languages } = useLanguages(projectId);

  if (isError) {
    return (
      <div className="grid h-screen place-items-center px-6">
        <QueryErrorState onRetry={() => void refetch()} retrying={isRefetching} />
      </div>
    );
  }
  if (!changeRequest) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-4 w-1/3" />
      </div>
    );
  }
  return (
    <div className="flex h-screen flex-col">
      <ChangeRequestHeader
        projectId={projectId}
        changeRequest={changeRequest}
        tab={tab === 'changes' ? 'changes' : 'overview'}
        back={{ to: '/app/projects/$projectId/changes', label: t('changeRequest.backToList') }}
      >
        <StatusActions projectId={projectId} changeRequest={changeRequest} />
      </ChangeRequestHeader>
      {tab === 'changes' ? (
        <ChangesTab projectId={projectId} changeRequest={changeRequest} languages={languages} />
      ) : (
        <OverviewTab projectId={projectId} changeRequest={changeRequest} languages={languages} />
      )}
    </div>
  );
}

/** Status transitions and the merge entry point for the header. */
function StatusActions({ projectId, changeRequest }: { projectId: string; changeRequest: ChangeRequestDetail }) {
  const t = useT();
  const confirm = useConfirm();
  const update = useUpdateChangeRequest(projectId, changeRequest.number);
  const [mergeOpen, setMergeOpen] = useState(false);
  const { contributor, canEdit } = useChangeRequestAccess(projectId, changeRequest);
  const { status, branchId } = changeRequest;
  const open = status === 'DRAFT' || status === 'IN_REVIEW';
  const setStatus = (next: Exclude<ChangeRequestStatus, 'MERGED'>) =>
    update.mutate({ status: next }, { onError: (error) => toast.error(error.message || t('changeRequest.updateError')) });
  const archive = async () => {
    const ok = await confirm({
      title: t('changeRequest.archive'),
      description: t('changeRequest.archiveConfirm'),
      confirmLabel: t('changeRequest.archive'),
    });
    if (ok) setStatus('ARCHIVED');
  };

  return (
    <>
      {branchId && !contributor ? (
        <Button
          nativeButton={false}
          render={<Link to="/app/projects/$projectId/preview" params={{ projectId }} search={{ branchId }} />}
          size="sm"
          variant="ghost"
          aria-label={t('project.preview')}
        >
          <Eye className="size-3.5" /> <span className="hidden md:inline">{t('project.preview')}</span>
        </Button>
      ) : null}
      {open && canEdit ? (
        <Button size="sm" variant="ghost" onClick={() => void archive()} disabled={update.isPending} aria-label={t('changeRequest.archive')}>
          <Archive className="size-3.5" /> <span className="hidden md:inline">{t('changeRequest.archive')}</span>
        </Button>
      ) : null}
      {status === 'DRAFT' && canEdit ? (
        <Button size="sm" variant="outline" onClick={() => setStatus('IN_REVIEW')} disabled={update.isPending}>
          <Send className="size-3.5" /> {t('changeRequest.markReady')}
        </Button>
      ) : null}
      {status === 'IN_REVIEW' && canEdit ? (
        <Button size="sm" variant="outline" onClick={() => setStatus('DRAFT')} disabled={update.isPending}>
          <Undo2 className="size-3.5" /> {t('changeRequest.backToDraft')}
        </Button>
      ) : null}
      {status === 'ARCHIVED' && branchId && canEdit ? (
        <Button size="sm" variant="outline" onClick={() => setStatus('DRAFT')} disabled={update.isPending}>
          <RotateCcw className="size-3.5" /> {t('changeRequest.reopen')}
        </Button>
      ) : null}
      {open && !contributor ? <SubmitReviewMenu projectId={projectId} number={changeRequest.number} /> : null}
      {open && branchId && !contributor ? (
        <>
          <ApprovalStatus review={changeRequest.review} />
          <Button size="sm" onClick={() => setMergeOpen(true)} disabled={!changeRequest.review.mergeable}>
            <GitMerge className="size-3.5" /> {t('changeRequest.merge')}
          </Button>
          <MergeDialog
            projectId={projectId}
            number={changeRequest.number}
            conflicts={changeRequest.conflicts}
            open={mergeOpen}
            onOpenChange={setMergeOpen}
          />
        </>
      ) : null}
    </>
  );
}

function OverviewTab({
  projectId,
  changeRequest,
  languages,
}: {
  projectId: string;
  changeRequest: ChangeRequestDetail;
  languages: Language[] | undefined;
}) {
  const t = useT();
  const { relativeTime } = useFormatters();
  const update = useUpdateChangeRequest(projectId, changeRequest.number);
  const [title, setTitle] = useState(changeRequest.title);
  const [description, setDescription] = useState(changeRequest.description ?? '');
  useEffect(() => setTitle(changeRequest.title), [changeRequest.title]);
  useEffect(() => setDescription(changeRequest.description ?? ''), [changeRequest.description]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const { groups, orphaned } = useChangesByLanguage(changeRequest.changes, languages);
  const ordered = useMemo(() => [...groups.flatMap((group) => group.changes), ...orphaned], [groups, orphaned]);
  const save = (body: { title?: string; description?: string | null }) =>
    update.mutate(body, { onError: (error) => toast.error(error.message || t('changeRequest.updateError')) });
  const author = changeRequest.author?.name ?? t('changeRequest.unknownAuthor');
  const { contributor, canEdit } = useChangeRequestAccess(projectId, changeRequest);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8">
        <input
          aria-label={t('changeRequest.field.title')}
          className="w-full rounded-sm border-0 bg-transparent font-semibold text-2xl tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          dir="auto"
          maxLength={200}
          readOnly={!canEdit}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => {
            const next = title.trim();
            if (next && next !== changeRequest.title) save({ title: next });
            else setTitle(changeRequest.title);
          }}
        />
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-sm">
          <span>{t('changeRequest.openedBy', { name: author, time: relativeTime(changeRequest.createdAt) })}</span>
          <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-0.5 text-xs" dir="ltr">
            <span className="font-mono">main</span>
            <ArrowLeft className="size-3" />
            <span className="max-w-[16rem] truncate" dir="auto">
              {changeRequest.title}
            </span>
            <span>#{changeRequest.number}</span>
          </span>
          {changeRequest.status === 'MERGED' && changeRequest.mergedAt ? (
            <span>
              {t('changeRequest.mergedBy', {
                name: changeRequest.mergedBy?.name ?? t('changeRequest.unknownAuthor'),
                time: relativeTime(changeRequest.mergedAt),
              })}
            </span>
          ) : null}
        </div>
        <Textarea
          aria-label={t('changeRequest.field.description')}
          className="mt-4 min-h-20"
          dir="auto"
          maxLength={20_000}
          placeholder={t('changeRequest.descriptionPlaceholder')}
          readOnly={!canEdit}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          onBlur={() => {
            if (description !== (changeRequest.description ?? '')) save({ description: description.trim() ? description : null });
          }}
        />

        <div className="mt-6 grid gap-6 rounded-xl border border-border bg-card p-4 sm:grid-cols-2">
          <ReviewersPanel projectId={projectId} changeRequest={changeRequest} manage={!contributor} />
          <ParticipantsPanel participants={changeRequest.participants} />
        </div>

        {changeRequest.conflicts.length > 0 ? (
          <div
            role="status"
            className="mt-4 flex items-start gap-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3.5 py-2.5 text-[13px] text-amber-700 dark:text-amber-300"
          >
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <p>{t('changeRequest.conflictsNotice', { count: changeRequest.conflicts.length })}</p>
          </div>
        ) : null}

        <h2 className="mt-8 mb-3 font-semibold text-sm">{t('changeRequest.changedPages')}</h2>
        {changeRequest.changes.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('changeRequest.noChanges')}</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[240px_1fr]">
            <aside className="lg:sticky lg:top-4 lg:self-start">
              <ChangedPages
                changes={changeRequest.changes}
                languages={languages}
                onSelect={(change) => document.getElementById(`change-${changeKey(change)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              />
            </aside>
            <div className="min-w-0 space-y-3">
              {ordered.map((change) => {
                const key = changeKey(change);
                const isCollapsed = collapsed.has(key);
                return (
                  <section key={key} id={`change-${key}`} className="scroll-mt-4 overflow-hidden rounded-xl border border-border bg-card">
                    <button
                      type="button"
                      aria-expanded={!isCollapsed}
                      onClick={() =>
                        setCollapsed((current) => {
                          const next = new Set(current);
                          if (next.has(key)) next.delete(key);
                          else next.add(key);
                          return next;
                        })
                      }
                      className={cn(
                        'flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-start hover:bg-muted/50',
                        !isCollapsed && 'border-border border-b',
                      )}
                    >
                      <ChevronDown
                        className={cn('size-4 shrink-0 text-muted-foreground transition-transform', isCollapsed && '-rotate-90 rtl:rotate-90')}
                      />
                      <span className="min-w-0 truncate font-medium text-sm" dir="auto">
                        {change.title || change.path}
                      </span>
                      <span className="hidden truncate font-mono text-muted-foreground text-xs sm:inline" dir="ltr">
                        /{change.path}
                      </span>
                      <span className="ms-auto">
                        <ChangeMarker change={change.change} />
                      </span>
                    </button>
                    {isCollapsed ? null : (
                      <Suspense fallback={diffSkeleton}>
                        <PageDiff projectId={projectId} number={changeRequest.number} pageId={key} dir={languageDir(languages, change)} />
                      </Suspense>
                    )}
                  </section>
                );
              })}
            </div>
          </div>
        )}
        <ReviewHistory reviews={changeRequest.reviews} />
      </div>
    </div>
  );
}

const languageDir = (languages: Language[] | undefined, change: ChangeRequestPageChange) =>
  languages?.find((language) => language.id === change.languageId)?.direction === 'RTL' ? 'rtl' : 'ltr';

/** Changed pages only, one diff at a time with previous/next navigation. */
function ChangesTab({
  projectId,
  changeRequest,
  languages,
}: {
  projectId: string;
  changeRequest: ChangeRequestDetail;
  languages: Language[] | undefined;
}) {
  const t = useT();
  const { groups, orphaned } = useChangesByLanguage(changeRequest.changes, languages);
  const ordered = useMemo(() => [...groups.flatMap((group) => group.changes), ...orphaned], [groups, orphaned]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const index = Math.max(
    0,
    ordered.findIndex((change) => changeKey(change) === activeKey),
  );
  const active = ordered[index];
  const go = (offset: number) => {
    const next = ordered[index + offset];
    if (next) setActiveKey(changeKey(next));
  };

  if (!active) {
    return (
      <div className="grid flex-1 place-items-center px-6 text-center">
        <p className="text-muted-foreground text-sm">{t('changeRequest.noChanges')}</p>
      </div>
    );
  }
  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[260px_1fr] lg:grid-rows-[minmax(0,1fr)]">
      <aside className="max-h-48 overflow-y-auto border-border border-b bg-sidebar/40 p-2 lg:max-h-none lg:border-e lg:border-b-0">
        <ChangedPages
          changes={changeRequest.changes}
          languages={languages}
          activeKey={changeKey(active)}
          onSelect={(change) => setActiveKey(changeKey(change))}
        />
      </aside>
      <section className="flex min-h-0 min-w-0 flex-col">
        <div className="flex min-h-12 items-center gap-2 border-border border-b px-3 sm:px-4">
          <ChangeMarker change={active.change} />
          <span className="min-w-0 truncate font-medium text-sm" dir="auto">
            {active.title || active.path}
          </span>
          <span className="ms-auto text-muted-foreground text-xs">{t('changeRequest.position', { current: index + 1, total: ordered.length })}</span>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => go(-1)}
            disabled={index === 0}
            aria-label={t('changeRequest.previousChange')}
            title={t('changeRequest.previousChange')}
          >
            <ChevronLeft className="size-4 rtl:-scale-x-100" />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => go(1)}
            disabled={index === ordered.length - 1}
            aria-label={t('changeRequest.nextChange')}
            title={t('changeRequest.nextChange')}
          >
            <ChevronRight className="size-4 rtl:-scale-x-100" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[820px]">
            <Suspense fallback={diffSkeleton}>
              <PageDiff
                key={changeKey(active)}
                projectId={projectId}
                number={changeRequest.number}
                pageId={changeKey(active)}
                dir={languageDir(languages, active)}
              />
            </Suspense>
          </div>
        </div>
      </section>
    </div>
  );
}
