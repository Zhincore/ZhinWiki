import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import { cn } from '@nibleaf/design-system/lib/utils';
import type { MessageKey } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import { ChevronsUpDown } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Markdown } from '@/components/markdown';
import { type ChangeRequestDiffSide, useChangeRequestPageDiff } from '@/hooks/api';
import { type BlockDiffRow, collapseUnchanged, diffBlocks } from '@/lib/block-diff';

type ScalarField = Exclude<keyof ChangeRequestDiffSide, 'config'>;

const FIELDS: { key: ScalarField; label: MessageKey }[] = [
  { key: 'title', label: 'changeRequest.field.title' },
  { key: 'slug', label: 'changeRequest.field.slug' },
  { key: 'path', label: 'changeRequest.field.path' },
  { key: 'icon', label: 'changeRequest.field.icon' },
  { key: 'description', label: 'changeRequest.field.description' },
  { key: 'hidden', label: 'changeRequest.field.hidden' },
  { key: 'position', label: 'changeRequest.field.position' },
  { key: 'translationKey', label: 'editor.pageSettings.translationKey' },
];

/** Page settings as `dotted.key → JSON value` leaves, so nested changes show one row each. */
const flattenConfig = (value: unknown, prefix = '', out = new Map<string, string>()) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) flattenConfig(child, prefix ? `${prefix}.${key}` : key, out);
  } else if (prefix && value !== undefined && value !== null) {
    out.set(prefix, typeof value === 'string' ? value : JSON.stringify(value));
  }
  return out;
};

/** Changed page settings between two sides, sorted by key. */
const configChanges = (main: ChangeRequestDiffSide['config'], change: ChangeRequestDiffSide['config']) => {
  const before = flattenConfig(main);
  const after = flattenConfig(change);
  return [...new Set([...before.keys(), ...after.keys()])]
    .sort()
    .filter((key) => before.get(key) !== after.get(key))
    .map((key) => ({ key, before: before.get(key) ?? null, after: after.get(key) ?? null }));
};

/** Rendered block-level diff of one page between main and a change request,
 *  with its changed metadata above. `pageId` names either side. */
export default function PageDiff({ projectId, number, pageId, dir }: { projectId: string; number: number; pageId: string; dir?: 'ltr' | 'rtl' }) {
  const t = useT();
  const { data, isPending, isError } = useChangeRequestPageDiff(projectId, number, pageId);
  const rows = useMemo(() => (data ? diffBlocks(data.main?.content ?? '', data.change?.content ?? '') : []), [data]);

  if (isPending) {
    return (
      <div className="space-y-2 p-4">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  }
  if (isError || !data) {
    return <p className="p-4 text-destructive text-sm">{t('changeRequest.diff.loadError')}</p>;
  }
  const { main, change } = data;
  const format = (value: ChangeRequestDiffSide[ScalarField]) =>
    typeof value === 'boolean'
      ? t(value ? 'changeRequest.field.yes' : 'changeRequest.field.no')
      : value === null || value === ''
        ? '—'
        : String(value);
  const fields = [
    ...(main && change
      ? FIELDS.filter(({ key }) => main[key] !== change[key]).map(({ key, label }) => ({
          key,
          label: t(label),
          before: format(main[key]),
          after: format(change[key]),
        }))
      : []),
    // Settings of added pages too, so reviewers see SEO overrides such as a canonical URL.
    ...(change
      ? configChanges(main?.config ?? null, change.config).map(({ key, before, after }) => ({
          key: `config.${key}`,
          label: `${t('editor.pageSettings.title')}: ${key}`,
          before: format(before),
          after: format(after),
        }))
      : []),
  ];

  return (
    <div className="space-y-3 p-3 sm:p-4" dir={dir}>
      {fields.length > 0 ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-md border border-border bg-muted/30 px-3 py-2 text-[13px]">
          {fields.map(({ key, label, before, after }) => (
            <div key={key} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="flex min-w-0 flex-wrap items-center gap-x-2">
                <span className="break-all text-red-700 line-through decoration-red-500/60 dark:text-red-400" dir="auto">
                  {before}
                </span>
                <span aria-hidden className="text-muted-foreground rtl:-scale-x-100">
                  →
                </span>
                <span className="break-all text-emerald-700 dark:text-emerald-400" dir="auto">
                  {after}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {rows.length === 0 || rows.every((row) => row.kind === 'same') ? (
        <p className="text-muted-foreground text-sm">{t('changeRequest.diff.noContentChanges')}</p>
      ) : (
        <BlockRows rows={rows} />
      )}
    </div>
  );
}

function BlockRows({ rows }: { rows: BlockDiffRow[] }) {
  const t = useT();
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const segments = useMemo(() => collapseUnchanged(rows), [rows]);
  return (
    <div className="space-y-1">
      {segments.map((segment, index) =>
        segment.kind === 'collapsed' && !expanded.has(index) ? (
          <button
            // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional and rebuilt with the rows
            key={index}
            type="button"
            className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-md border border-border border-dashed py-1.5 text-muted-foreground text-xs hover:bg-muted hover:text-foreground"
            onClick={() => setExpanded((current) => new Set(current).add(index))}
          >
            <ChevronsUpDown className="size-3.5" />
            {t('changeRequest.diff.showUnchanged', { count: segment.rows.length })}
          </button>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional and rebuilt with the rows
          <div key={index} className="space-y-1">
            {segment.rows.map((row, rowIndex) =>
              row.kind === 'changed' ? (
                // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
                <div key={rowIndex} className="space-y-1">
                  <Block kind="removed" source={row.before} />
                  <Block kind="added" source={row.after} />
                </div>
              ) : (
                // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
                <Block key={rowIndex} kind={row.kind} source={row.block} />
              ),
            )}
          </div>
        ),
      )}
    </div>
  );
}

const BLOCK_STYLE = {
  same: { gutter: '', label: null, className: 'border-transparent opacity-70' },
  added: { gutter: '+', label: 'changeRequest.change.added', className: 'border-emerald-500 bg-emerald-500/10' },
  removed: { gutter: '−', label: 'changeRequest.change.removed', className: 'border-red-500 bg-red-500/10' },
} as const satisfies Record<string, { gutter: string; label: MessageKey | null; className: string }>;

function Block({ kind, source }: { kind: keyof typeof BLOCK_STYLE; source: string }) {
  const t = useT();
  const style = BLOCK_STYLE[kind];
  return (
    <div className={cn('relative rounded-e-md border-s-2 py-1 ps-7 pe-3', style.className)}>
      <span aria-hidden className="absolute start-2 top-1.5 select-none font-mono text-muted-foreground text-xs">
        {style.gutter}
      </span>
      {style.label ? <span className="sr-only">{t(style.label)}</span> : null}
      <Markdown content={source} className="min-w-0 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0" />
    </div>
  );
}
