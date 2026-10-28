import type { MessageKey } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import type { UsageAvailability } from '@nibleaf/usage';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Bot,
  Boxes,
  Database,
  Eye,
  Files,
  Globe2,
  HardDrive,
  type LucideIcon,
  Rocket,
  Search,
  Users,
} from 'lucide-react';
import { QueryErrorState } from '@/components/query-error-state';
import type { Project } from '@/hooks/api';
import { useProjectUsage } from '@/hooks/api';
import { useFormatters } from '@/lib/format';
import { formatByteQuantity } from '@/lib/usage-format';
import { SettingsSection } from './section';

const meterPresentation: Record<string, { icon: LucideIcon; label: MessageKey }> = {
  editor_seat: { icon: Users, label: 'settings.usage.meter.editorSeat' },
  asset_storage_byte: { icon: HardDrive, label: 'settings.usage.meter.assetStorage' },
  custom_domain: { icon: Globe2, label: 'settings.usage.meter.customDomain' },
  published_page: { icon: Files, label: 'settings.usage.meter.publishedPage' },
  public_page_view: { icon: Eye, label: 'settings.usage.meter.publicPageView' },
  search_query: { icon: Search, label: 'settings.usage.meter.searchQuery' },
  ai_answer: { icon: Bot, label: 'settings.usage.meter.aiAnswer' },
  ai_input_token: { icon: ArrowDownToLine, label: 'settings.usage.meter.aiInputToken' },
  ai_output_token: { icon: ArrowUpFromLine, label: 'settings.usage.meter.aiOutputToken' },
  embedded_chunk: { icon: Boxes, label: 'settings.usage.meter.embeddedChunk' },
  indexed_content_byte: { icon: Database, label: 'settings.usage.meter.indexedContent' },
  build: { icon: Rocket, label: 'settings.usage.meter.build' },
};

const groups = [
  {
    title: 'settings.usage.group.capacity' as const,
    description: 'settings.usage.group.capacity.description' as const,
    keys: ['published_page', 'editor_seat', 'asset_storage_byte', 'custom_domain'],
  },
  {
    title: 'settings.usage.group.delivery' as const,
    description: 'settings.usage.group.delivery.description' as const,
    keys: ['build', 'public_page_view'],
  },
  {
    title: 'settings.usage.group.searchAi' as const,
    description: 'settings.usage.group.searchAi.description' as const,
    keys: ['search_query', 'ai_answer', 'ai_input_token', 'ai_output_token', 'embedded_chunk', 'indexed_content_byte'],
  },
];

const availabilityKeys: Record<UsageAvailability, MessageKey> = {
  complete: 'settings.usage.availability.complete',
  partial: 'settings.usage.availability.partial',
  unavailable: 'settings.usage.availability.unavailable',
};

const limitRows = [
  { key: 'aiDraftsPerDay', label: 'settings.usage.limit.aiDrafts', unit: 'count' },
  { key: 'aiAnswersPerDay', label: 'settings.usage.limit.aiAnswers', unit: 'count' },
  { key: 'exportsPerDay', label: 'settings.usage.limit.exportsDaily', unit: 'count' },
  { key: 'exportsActive', label: 'settings.usage.limit.exportsActive', unit: 'count' },
  { key: 'exportPages', label: 'settings.usage.limit.exportPages', unit: 'count' },
  { key: 'exportBytes', label: 'settings.usage.limit.exportSize', unit: 'byte' },
] as const;

function UsageSkeleton() {
  return <div aria-hidden className="h-24 animate-pulse rounded-xl border border-border bg-muted/40" />;
}

export function UsageTab({ project }: { project: Project }) {
  const t = useT();
  const { date, number } = useFormatters();
  const { data: usage, isPending, isError, isFetching, refetch } = useProjectUsage(project.id);

  if (isError || (!isPending && !usage)) {
    return <QueryErrorState onRetry={() => void refetch()} retrying={isFetching} />;
  }

  const formatQuantity = (value: string | number, unit: string) => {
    if (unit !== 'byte') return number(BigInt(value));
    return formatByteQuantity(String(value), {
      number,
      decimal: (whole, fraction) => t('settings.usage.decimal', { whole, fraction }),
      unit: (valueLabel, byteUnit) =>
        t('settings.usage.unit', {
          value: valueLabel,
          unit: t(byteUnit === 'gib' ? 'settings.usage.unit.gib' : byteUnit === 'mib' ? 'settings.usage.unit.mib' : 'settings.usage.unit.byte'),
        }),
    });
  };
  const limits = usage ? limitRows.filter((row) => usage.limits[row.key] !== null) : [];

  return (
    <div className="flex flex-col gap-6">
      <header className="rounded-xl border border-border bg-card p-5">
        <h2 className="font-semibold text-xl tracking-tight">{t('settings.usage.title')}</h2>
        <p className="mt-1 max-w-2xl text-muted-foreground text-sm">{t('settings.usage.description')}</p>
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-border border-t pt-4 text-muted-foreground text-xs">
          <span>
            {usage
              ? t('settings.usage.period', {
                  start: date(usage.period.start),
                  end: date(new Date(new Date(usage.period.endExclusive).getTime() - 1)),
                })
              : t('settings.usage.period.loading')}
          </span>
          <span aria-live="polite">{usage ? t(availabilityKeys[usage.availability]) : null}</span>
        </div>
      </header>

      {groups.map((group) => {
        const metrics = usage?.meters.filter((metric) => group.keys.includes(metric.key)) ?? [];
        return (
          <SettingsSection description={t(group.description)} key={group.title} title={t(group.title)}>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {isPending || !usage
                ? group.keys.slice(0, 3).map((key) => <UsageSkeleton key={key} />)
                : metrics.map((metric) => {
                    const presentation = meterPresentation[metric.key] ?? {
                      icon: Database,
                      label: 'settings.usage.meter.unknown' as const,
                    };
                    const Icon = presentation.icon;
                    return (
                      <article className="rounded-xl border border-border bg-background p-4" data-meter={metric.key} key={metric.key}>
                        <div className="flex min-w-0 items-center gap-2 text-muted-foreground text-sm">
                          <Icon aria-hidden className="size-4 shrink-0" />
                          <h3 className="truncate font-medium text-foreground">{t(presentation.label)}</h3>
                        </div>
                        <div
                          className="mt-3 font-semibold text-2xl tabular-nums"
                          title={
                            metric.quantity !== null && metric.unit === 'byte'
                              ? t('settings.usage.exactBytes', { value: number(BigInt(metric.quantity)) })
                              : undefined
                          }
                        >
                          {metric.quantity === null ? '—' : formatQuantity(metric.quantity, metric.unit)}
                        </div>
                        {metric.quantity === null ? (
                          <p className="mt-2 text-muted-foreground text-xs">{t('settings.usage.unknownExplanation')}</p>
                        ) : null}
                      </article>
                    );
                  })}
            </div>
          </SettingsSection>
        );
      })}

      {limits.length > 0 ? (
        <SettingsSection description={t('settings.usage.group.limits.description')} title={t('settings.usage.group.limits')}>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {limits.map((row) => (
              <div className="flex items-baseline justify-between gap-3 border-border border-b py-2" key={row.key}>
                <dt className="text-muted-foreground">{t(row.label)}</dt>
                <dd className="font-medium tabular-nums">{formatQuantity(usage?.limits[row.key] ?? 0, row.unit)}</dd>
              </div>
            ))}
          </dl>
        </SettingsSection>
      ) : null}

      <p className="rounded-lg border border-border bg-muted/30 p-3 text-muted-foreground text-xs">{t('settings.usage.privacyNote')}</p>
    </div>
  );
}
