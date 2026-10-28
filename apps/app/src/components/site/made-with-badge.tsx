import { BrandMark } from '@nibleaf/design-system/brand';
import { siteT } from '@nibleaf/i18n/site';
import { SOFTWARE } from '@nibleaf/shared/brand';
import { useBrand } from '@/lib/brand';

/**
 * "Made with ‹software›" attribution (the software, not the instance's `APP_NAME`) + a low-key abuse-report contact, shown in the
 * published-site footer. On by default; site owners can hide it with the
 * `footer.madeWithBadge` config toggle (Site configuration → Footer).
 *
 * Copy is served by the same Paraglide catalog as the rest of the public reader.
 * RTL-safe: flex + gap only, no directional margins.
 */
export function MadeWithBadge({ lang }: { lang?: string }) {
  const t = siteT(lang);
  const brand = useBrand();
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground/80">
      <a href={SOFTWARE.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground">
        <BrandMark className="size-3.5" decorative name={SOFTWARE.name} src={null} />
        <span>
          {t('madeWith')} <span className="font-semibold">{SOFTWARE.name}</span>
        </span>
      </a>
      <span aria-hidden>·</span>
      <a href={`mailto:${brand.abuseEmail}`} className="transition-colors hover:text-foreground">
        {t('reportAbuse')}
      </a>
    </div>
  );
}
