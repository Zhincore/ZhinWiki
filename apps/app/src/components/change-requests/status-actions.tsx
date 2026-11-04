import { Button } from '@nibleaf/design-system/components/ui/button';
import { useConfirm } from '@nibleaf/design-system/components/ui/confirm';
import { useT } from '@nibleaf/i18n/react';
import { Archive, GitMerge, Loader2, RotateCcw, Send, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  type ChangeRequestDetail,
  type ChangeRequestStatus,
  useChangeRequest,
  useMergeChangeRequest,
  useRevertChangeRequest,
  useUpdateChangeRequest,
} from '@/hooks/api';
import { useChangeRequestAccess } from './change-request-header';
import { conflictsFromError } from './merge-conflicts';
import { MergeDialog, toastMerged } from './merge-dialog';
import { ApprovalStatus, SubmitReviewMenu } from './reviews';

/** Status transitions, review and merge for a change request header.
 *  `prepare` runs before a review or merge starts, e.g. to save a draft;
 *  false cancels it. */
export function StatusActions({
  projectId,
  changeRequest,
  prepare,
}: {
  projectId: string;
  changeRequest: ChangeRequestDetail;
  prepare?: () => Promise<boolean>;
}) {
  const t = useT();
  const confirm = useConfirm();
  const { number, status, branchId } = changeRequest;
  const update = useUpdateChangeRequest(projectId, number);
  const revert = useRevertChangeRequest(projectId, number);
  const merge = useMergeChangeRequest(projectId, number);
  const { refetch } = useChangeRequest(projectId, number);
  const [mergeOpen, setMergeOpen] = useState(false);
  const { contributor, canEdit } = useChangeRequestAccess(projectId, changeRequest);
  const open = status === 'DRAFT' || status === 'IN_REVIEW';
  const mergeable = open && Boolean(branchId) && !contributor;
  const setStatus = (next: Exclude<ChangeRequestStatus, 'MERGED'>) =>
    update.mutate({ status: next }, { onError: (error) => toast.error(error.message) });
  const archive = async () => {
    const ok = await confirm({
      title: t('changeRequest.archive'),
      description: t('changeRequest.archiveConfirm'),
      confirmLabel: t('changeRequest.archive'),
    });
    if (ok) setStatus('ARCHIVED');
  };
  const confirmRevert = async () => {
    const ok = await confirm({
      title: t('changeRequest.revert'),
      description: t('changeRequest.revertConfirm'),
      confirmLabel: t('changeRequest.revert'),
    });
    if (ok) revert.revert();
  };
  const openMerge = async () => {
    if (!prepare || (await prepare())) setMergeOpen(true);
  };
  /** After an approval: merge right away, open the dialog for conflicts, or say what still blocks it. */
  const mergeApproved = async () => {
    const { data: latest } = await refetch();
    if (!latest) return;
    const { review, conflicts } = latest;
    if (!review.mergeable) {
      toast.info(
        review.changesRequested > 0
          ? t('changeRequest.review.state.changesRequested')
          : t('changeRequest.review.approvals', { approvals: review.approvals, required: review.required }),
      );
      return;
    }
    if (conflicts.length > 0) {
      setMergeOpen(true);
      return;
    }
    merge.mutate([], {
      onSuccess: ({ publish }) => toastMerged(t, publish),
      onError: (error) => {
        if (conflictsFromError(error)) setMergeOpen(true);
        else toast.error(error.message);
      },
    });
  };

  return (
    <>
      {open && canEdit ? (
        <Button size="sm" variant="ghost" onClick={() => void archive()} disabled={update.isPending} aria-label={t('changeRequest.archive')}>
          <Archive className="size-3.5" /> <span className="hidden md:inline">{t('changeRequest.archive')}</span>
        </Button>
      ) : null}
      {status === 'DRAFT' && canEdit ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => setStatus('IN_REVIEW')}
          disabled={update.isPending}
          aria-label={t('changeRequest.markReady')}
        >
          <Send className="size-3.5" /> <span className="hidden md:inline">{t('changeRequest.markReady')}</span>
        </Button>
      ) : null}
      {status === 'IN_REVIEW' && canEdit ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => setStatus('DRAFT')}
          disabled={update.isPending}
          aria-label={t('changeRequest.backToDraft')}
        >
          <Undo2 className="size-3.5" /> <span className="hidden md:inline">{t('changeRequest.backToDraft')}</span>
        </Button>
      ) : null}
      {status === 'ARCHIVED' && branchId && canEdit ? (
        <Button size="sm" variant="outline" onClick={() => setStatus('DRAFT')} disabled={update.isPending} aria-label={t('changeRequest.reopen')}>
          <RotateCcw className="size-3.5" /> <span className="hidden md:inline">{t('changeRequest.reopen')}</span>
        </Button>
      ) : null}
      {status === 'MERGED' && !contributor && changeRequest.changes.length > 0 ? (
        <Button size="sm" variant="outline" onClick={() => void confirmRevert()} disabled={revert.isPending} aria-label={t('changeRequest.revert')}>
          {revert.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Undo2 className="size-3.5" />}{' '}
          <span className="hidden md:inline">{t('changeRequest.revert')}</span>
        </Button>
      ) : null}
      {open && !contributor ? (
        <SubmitReviewMenu
          projectId={projectId}
          number={number}
          beforeSubmit={prepare}
          onApproved={mergeable ? () => void mergeApproved() : undefined}
        />
      ) : null}
      {mergeable ? (
        <>
          <ApprovalStatus review={changeRequest.review} />
          <Button
            size="sm"
            onClick={() => void openMerge()}
            disabled={!changeRequest.review.mergeable || merge.isPending}
            aria-label={t('changeRequest.merge')}
          >
            {merge.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <GitMerge className="size-3.5" />}{' '}
            <span className="hidden md:inline">{t('changeRequest.merge')}</span>
          </Button>
          <MergeDialog projectId={projectId} number={number} conflicts={changeRequest.conflicts} open={mergeOpen} onOpenChange={setMergeOpen} />
        </>
      ) : null}
    </>
  );
}
