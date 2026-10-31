import { Avatar, AvatarFallback, AvatarImage } from '@nibleaf/design-system/components/ui/avatar';
import { Badge } from '@nibleaf/design-system/components/ui/badge';
import { Button } from '@nibleaf/design-system/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@nibleaf/design-system/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@nibleaf/design-system/components/ui/popover';
import { Textarea } from '@nibleaf/design-system/components/ui/textarea';
import { cn } from '@nibleaf/design-system/lib/utils';
import type { MessageKey } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import { Check, ChevronDown, MessageSquare, RotateCcw, UserPlus, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  type ChangeRequestDetail,
  type ChangeRequestReviewState,
  type ChangeRequestUser,
  useChangeRequestReviewer,
  useReviewerCandidates,
  useSubmitChangeRequestReview,
} from '@/hooks/api';
import { useFormatters } from '@/lib/format';

const STATE: Record<ChangeRequestReviewState, { label: MessageKey; className: string }> = {
  APPROVED: { label: 'changeRequest.review.state.approved', className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  CHANGES_REQUESTED: { label: 'changeRequest.review.state.changesRequested', className: 'bg-red-500/15 text-red-700 dark:text-red-300' },
  COMMENTED: { label: 'changeRequest.review.state.commented', className: 'border-border text-muted-foreground' },
};

function ReviewStateBadge({ state }: { state: ChangeRequestReviewState }) {
  const t = useT();
  return (
    <Badge variant="outline" className={STATE[state].className}>
      {t(STATE[state].label)}
    </Badge>
  );
}

function UserAvatar({ user }: { user: ChangeRequestUser }) {
  return (
    <Avatar size="sm">
      {user.image ? <AvatarImage alt="" src={user.image} /> : null}
      <AvatarFallback className="text-[10px]">{user.name.slice(0, 1).toUpperCase()}</AvatarFallback>
    </Avatar>
  );
}

/** Approval count against the wiki's requirement, or the blocking change request. */
export function ApprovalStatus({ review }: { review: ChangeRequestDetail['review'] }) {
  const t = useT();
  const blocked = review.changesRequested > 0;
  return (
    <span
      className={cn(
        'hidden items-center gap-1 rounded-md px-2 py-0.5 text-xs sm:inline-flex',
        blocked
          ? 'bg-red-500/10 text-red-700 dark:text-red-300'
          : review.mergeable
            ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
            : 'bg-muted text-muted-foreground',
      )}
    >
      {blocked
        ? t('changeRequest.review.state.changesRequested')
        : t('changeRequest.review.approvals', { approvals: review.approvals, required: review.required })}
    </span>
  );
}

/** Approve, request changes or comment, with an optional message. */
export function SubmitReviewMenu({ projectId, number }: { projectId: string; number: number }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const submit = useSubmitChangeRequestReview(projectId, number);
  const send = (state: ChangeRequestReviewState) =>
    submit.mutate(
      { state, ...(body.trim() ? { body } : {}) },
      {
        onSuccess: () => {
          toast.success(t('changeRequest.review.submitted'));
          setBody('');
          setOpen(false);
        },
        onError: (error) => toast.error(error.message || t('changeRequest.review.error')),
      },
    );
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        render={
          <Button size="sm" variant="outline">
            {t('changeRequest.review.submit')} <ChevronDown className="size-3.5" />
          </Button>
        }
      />
      <PopoverContent align="end" className="w-80 gap-3">
        <Textarea
          aria-label={t('changeRequest.review.bodyPlaceholder')}
          className="min-h-20"
          dir="auto"
          maxLength={20_000}
          placeholder={t('changeRequest.review.bodyPlaceholder')}
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
        <div className="flex flex-wrap justify-end gap-2">
          <Button size="sm" variant="ghost" disabled={submit.isPending} onClick={() => send('COMMENTED')}>
            <MessageSquare className="size-3.5" /> {t('changeRequest.review.comment')}
          </Button>
          <Button size="sm" variant="outline" disabled={submit.isPending} onClick={() => send('CHANGES_REQUESTED')}>
            {t('changeRequest.review.requestChanges')}
          </Button>
          <Button size="sm" disabled={submit.isPending} onClick={() => send('APPROVED')}>
            <Check className="size-3.5" /> {t('changeRequest.review.approve')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Reviewers with their verdicts; members add, re-request and remove them. */
export function ReviewersPanel({ projectId, changeRequest, manage }: { projectId: string; changeRequest: ChangeRequestDetail; manage: boolean }) {
  const t = useT();
  const open = changeRequest.status === 'DRAFT' || changeRequest.status === 'IN_REVIEW';
  const canManage = manage && open;
  const [pickerOpen, setPickerOpen] = useState(false);
  const candidates = useReviewerCandidates(projectId, canManage && pickerOpen);
  const reviewer = useChangeRequestReviewer(projectId, changeRequest.number);
  const change = (userId: string, remove?: boolean) =>
    reviewer.mutate({ userId, remove }, { onError: (error) => toast.error(error.message || t('changeRequest.reviewers.error')) });
  const assigned = new Set(changeRequest.reviewers.map((item) => item.user.id));
  const available = (candidates.data ?? []).filter((user) => !assigned.has(user.id));

  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="font-semibold text-sm">{t('changeRequest.reviewers')}</h2>
        {canManage ? (
          <DropdownMenu onOpenChange={setPickerOpen} open={pickerOpen}>
            <DropdownMenuTrigger
              render={
                <Button size="icon-xs" variant="ghost" aria-label={t('changeRequest.reviewers.add')} title={t('changeRequest.reviewers.add')}>
                  <UserPlus className="size-3.5" />
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="max-h-72 w-60 overflow-y-auto">
              <DropdownMenuLabel>{t('changeRequest.reviewers.add')}</DropdownMenuLabel>
              {candidates.isPending ? (
                <p className="px-2 py-1.5 text-muted-foreground text-sm">{t('common.loading')}</p>
              ) : available.length === 0 ? (
                <p className="px-2 py-1.5 text-muted-foreground text-sm">{t('changeRequest.reviewers.noCandidates')}</p>
              ) : (
                available.map((user) => (
                  <DropdownMenuItem key={user.id} onClick={() => change(user.id)}>
                    <UserAvatar user={user} />
                    <span className="truncate" dir="auto">
                      {user.name}
                    </span>
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      {changeRequest.reviewers.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('changeRequest.reviewers.none')}</p>
      ) : (
        <ul className="space-y-1.5">
          {changeRequest.reviewers.map((item) => (
            <li key={item.user.id} className="group flex items-center gap-2 text-sm">
              <UserAvatar user={item.user} />
              <span className="min-w-0 flex-1 truncate" dir="auto">
                {item.user.name}
              </span>
              {item.state ? (
                <ReviewStateBadge state={item.state} />
              ) : (
                <span className="text-muted-foreground text-xs">{t('changeRequest.review.state.pending')}</span>
              )}
              {canManage ? (
                <span className="flex opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    disabled={reviewer.isPending}
                    onClick={() => change(item.user.id)}
                    aria-label={t('changeRequest.reviewers.rerequest', { name: item.user.name })}
                    title={t('changeRequest.reviewers.rerequest', { name: item.user.name })}
                  >
                    <RotateCcw className="size-3" />
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    disabled={reviewer.isPending}
                    onClick={() => change(item.user.id, true)}
                    aria-label={t('changeRequest.reviewers.remove', { name: item.user.name })}
                    title={t('changeRequest.reviewers.remove', { name: item.user.name })}
                  >
                    <X className="size-3" />
                  </Button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ParticipantsPanel({ participants }: { participants: ChangeRequestUser[] }) {
  const t = useT();
  return (
    <section>
      <h2 className="mb-2 font-semibold text-sm">{t('changeRequest.participants')}</h2>
      <ul className="flex flex-wrap gap-1.5">
        {participants.map((user) => (
          <li key={user.id} title={user.name}>
            <UserAvatar user={user} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Every review submission, oldest first. */
export function ReviewHistory({ reviews }: { reviews: ChangeRequestDetail['reviews'] }) {
  const t = useT();
  const { relativeTime } = useFormatters();
  if (reviews.length === 0) return null;
  return (
    <section className="mt-8">
      <h2 className="mb-3 font-semibold text-sm">{t('changeRequest.review.history')}</h2>
      <ol className="space-y-3">
        {reviews.map((review) => (
          <li key={review.id} className="rounded-xl border border-border bg-card px-3.5 py-2.5">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {review.author ? <UserAvatar user={review.author} /> : null}
              <span className="font-medium" dir="auto">
                {review.author?.name ?? t('changeRequest.unknownAuthor')}
              </span>
              <ReviewStateBadge state={review.state} />
              <time className="ms-auto text-muted-foreground text-xs" dateTime={review.createdAt}>
                {relativeTime(review.createdAt)}
              </time>
            </div>
            {review.body ? (
              <p className="mt-2 whitespace-pre-wrap text-sm" dir="auto">
                {review.body}
              </p>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
