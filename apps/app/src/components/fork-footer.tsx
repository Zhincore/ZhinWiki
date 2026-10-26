import { cn } from '@nibleaf/design-system/lib/utils';
import { useT } from '@nibleaf/i18n/react';
import { useBrand } from '@/lib/brand';

const UPSTREAM_URL = 'https://github.com/lord007tn/nibleaf';
const UPSTREAM_SLOT = '\u0000';

const linkClass = 'underline-offset-4 hover:text-foreground hover:underline';

/** Copyright, license, source link (AGPL-3.0 §13) and upstream attribution. */
export function ForkFooter({ className }: { className?: string }) {
  const t = useT();
  const brand = useBrand();
  const [forkBefore, forkAfter] = t('forkFooter.forkOf', { upstream: UPSTREAM_SLOT }).split(UPSTREAM_SLOT);
  const parts = [
    <span key="copyright">
      © {new Date().getFullYear()} {brand.name}
    </span>,
    <span key="license">{t('forkFooter.license')}</span>,
    <a className={linkClass} href={brand.sourceUrl} key="source" rel="noopener noreferrer" target="_blank">
      {t('forkFooter.source')}
    </a>,
    <span key="fork">
      {forkBefore}
      <a className={linkClass} href={UPSTREAM_URL} rel="noopener noreferrer" target="_blank">
        Nibleaf
      </a>
      {forkAfter}
    </span>,
  ];
  return (
    <footer className={cn('flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-muted-foreground text-xs', className)}>
      {parts.flatMap((part, index) =>
        index === 0
          ? [part]
          : [
              <span aria-hidden key={`separator-${part.key}`}>
                ·
              </span>,
              part,
            ],
      )}
    </footer>
  );
}
