import { Button } from '@nibleaf/design-system/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@nibleaf/design-system/components/ui/dialog';
import { Switch } from '@nibleaf/design-system/components/ui/switch';
import type { MessageKey } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import { GitMerge, Loader2, TriangleAlert } from 'lucide-react';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { type MergeConflict, type MergeConflictReason, useMergeChangeRequest } from '@/hooks/api';
import { conflictsFromError, forceList } from './merge-conflicts';

const REASON: Record<MergeConflictReason, MessageKey> = {
  BOTH_CHANGED: 'changeRequest.conflict.bothChanged',
  DELETED_ON_MAIN: 'changeRequest.conflict.deletedOnMain',
  DELETED_IN_BRANCH: 'changeRequest.conflict.deletedInBranch',
};

/** Merge confirmation. Conflicting pages are listed with their reason; the
 *  merge runs once the change request is picked to win on each of them, and
 *  says inside the dialog what still blocks it. */
export function MergeDialog({
  projectId,
  number,
  conflicts: initialConflicts,
  open,
  onOpenChange,
}: {
  projectId: string;
  number: number;
  conflicts: MergeConflict[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const merge = useMergeChangeRequest(projectId, number);
  const [refused, setRefused] = useState<MergeConflict[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hintId = useId();
  const conflicts = refused ?? initialConflicts;
  const force = forceList(conflicts, picked);
  const unresolved = conflicts.length - force.length;

  const toggle = (pageId: string, checked: boolean) =>
    setPicked((current) => {
      const next = new Set(current);
      if (checked) next.add(pageId);
      else next.delete(pageId);
      return next;
    });

  const submit = () => {
    setAttempted(true);
    setError(null);
    if (unresolved > 0) return;
    merge.mutate(force, {
      onSuccess: () => {
        toast.success(t('changeRequest.merged'));
        onOpenChange(false);
      },
      onError: (failure) => {
        const next = conflictsFromError(failure);
        if (next) setRefused(next);
        else setError(failure.message || t('changeRequest.mergeError'));
      },
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setRefused(null);
          setPicked(new Set());
          setAttempted(false);
          setError(null);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('changeRequest.mergeDialog.title')}</DialogTitle>
          <DialogDescription>{t('changeRequest.mergeDialog.description')}</DialogDescription>
        </DialogHeader>
        {conflicts.length > 0 ? (
          <div className="space-y-2">
            <p className="flex items-start gap-2 text-amber-700 text-sm dark:text-amber-300">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              {t('changeRequest.mergeDialog.conflicts')}
            </p>
            <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-md border border-border">
              {conflicts.map((conflict) => {
                const id = `force-${conflict.pageId}`;
                return (
                  <li key={conflict.pageId} className="flex items-center gap-3 px-3 py-2">
                    <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
                      <span className="block truncate font-medium text-sm" dir="auto">
                        {conflict.title || conflict.path}
                      </span>
                      <span className="block text-muted-foreground text-xs">{t(REASON[conflict.reason])}</span>
                    </label>
                    <Switch
                      id={id}
                      checked={picked.has(conflict.pageId)}
                      onCheckedChange={(checked) => toggle(conflict.pageId, checked)}
                      aria-describedby={hintId}
                    />
                  </li>
                );
              })}
            </ul>
            <p id={hintId} className="text-muted-foreground text-xs">
              {t('changeRequest.mergeDialog.useChangeRequest')}
            </p>
          </div>
        ) : null}
        {attempted && unresolved > 0 ? (
          <p className="text-destructive text-sm" role="alert">
            {t('changeRequest.mergeDialog.unresolved', { count: unresolved })}
          </p>
        ) : null}
        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>{t('common.cancel')}</DialogClose>
          <Button type="button" onClick={submit} disabled={merge.isPending}>
            {merge.isPending ? <Loader2 className="size-4 animate-spin" /> : <GitMerge className="size-4" />}
            {merge.isPending ? t('changeRequest.mergeDialog.merging') : t('changeRequest.merge')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
