import { cn } from '@nibleaf/design-system/lib/utils';
import type { MessageKey } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import { ArrowRightLeft, Circle, Languages, Minus, Plus } from 'lucide-react';
import { useMemo } from 'react';
import type { ChangeRequestPageChange, Language, PageChangeKind } from '@/hooks/api';

/** Stable key of a changed page: its change-request copy, or the main page when removed or merged. */
export const changeKey = (change: ChangeRequestPageChange) => change.branchPageId ?? change.mainPageId ?? change.path;

const MARKER: Record<PageChangeKind, { icon: typeof Plus; label: MessageKey; className: string }> = {
  added: { icon: Plus, label: 'changeRequest.change.added', className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' },
  removed: { icon: Minus, label: 'changeRequest.change.removed', className: 'bg-red-500/15 text-red-700 dark:text-red-400' },
  modified: { icon: Circle, label: 'changeRequest.change.modified', className: 'bg-sky-500/15 text-sky-700 dark:text-sky-400' },
  moved: { icon: ArrowRightLeft, label: 'changeRequest.change.moved', className: 'bg-muted text-muted-foreground' },
};

export function ChangeMarker({ change }: { change: PageChangeKind }) {
  const t = useT();
  const { icon: Icon, label, className } = MARKER[change];
  return (
    <span className={cn('inline-flex size-4 shrink-0 items-center justify-center rounded-sm', className)} title={t(label)}>
      <Icon className={cn('size-3', change === 'modified' && 'size-2 fill-current')} />
      <span className="sr-only">{t(label)}</span>
    </span>
  );
}

/** Changed pages grouped by language and ordered by path; nesting follows the path depth. */
export function useChangesByLanguage(changes: ChangeRequestPageChange[], languages: Language[] | undefined) {
  return useMemo(() => {
    const ordered = [...(languages ?? [])].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.position - b.position);
    const known = new Set(ordered.map((language) => language.id));
    const groups = ordered.map((language) => ({
      language,
      changes: changes.filter((change) => change.languageId === language.id).sort((a, b) => a.path.localeCompare(b.path)),
    }));
    const orphaned = changes.filter((change) => !known.has(change.languageId));
    return { groups: groups.filter((group) => group.changes.length > 0), orphaned };
  }, [changes, languages]);
}

/** Pages a change request touches, with added/removed/modified/moved markers, per language. */
export function ChangedPages({
  changes,
  languages,
  activeKey,
  onSelect,
}: {
  changes: ChangeRequestPageChange[];
  languages: Language[] | undefined;
  activeKey?: string | null;
  onSelect: (change: ChangeRequestPageChange) => void;
}) {
  const { groups, orphaned } = useChangesByLanguage(changes, languages);
  const showLanguages = groups.length > 1 || (languages?.length ?? 0) > 1;
  const rows = (items: ChangeRequestPageChange[], dir?: 'ltr' | 'rtl') => (
    <ul className="space-y-0.5" dir={dir}>
      {items.map((change) => {
        const key = changeKey(change);
        const depth = Math.max(0, change.path.split('/').filter(Boolean).length - 1);
        return (
          <li key={key}>
            <button
              type="button"
              onClick={() => onSelect(change)}
              aria-current={activeKey === key ? 'true' : undefined}
              className={cn(
                'flex w-full cursor-pointer items-center gap-2 rounded-md py-1.5 pe-2 text-start text-sm',
                activeKey === key ? 'bg-primary/10 font-medium text-primary' : 'text-foreground/80 hover:bg-muted hover:text-foreground',
              )}
              style={{ paddingInlineStart: 8 + depth * 14 }}
            >
              <span className="min-w-0 flex-1 truncate" dir="auto">
                {change.title || change.path}
              </span>
              <ChangeMarker change={change.change} />
            </button>
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="space-y-3">
      {groups.map(({ language, changes: items }) => (
        <div key={language.id}>
          {showLanguages ? (
            <div className="mb-1 flex items-center gap-1.5 px-2 font-semibold text-[12px] text-muted-foreground">
              <Languages className="size-3.5" />
              <span className="truncate">{language.label}</span>
            </div>
          ) : null}
          {rows(items, language.direction === 'RTL' ? 'rtl' : 'ltr')}
        </div>
      ))}
      {orphaned.length > 0 ? rows(orphaned) : null}
    </div>
  );
}
