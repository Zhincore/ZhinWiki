import { useT } from '@nibleaf/i18n/react';
import { useBrand } from '@/lib/brand';

const linkClass = 'underline hover:text-primary';

/** "By continuing, you agree to the Terms of Service and the Privacy Policy", linking the instance's legal pages in a new tab. */
export function LegalNotice() {
  const t = useT();
  const brand = useBrand();
  return (
    <p className="mt-4 text-center text-muted-foreground text-xs leading-relaxed">
      {t('auth.legal.socialNoticePrefix')}
      <a className={linkClass} href={brand.termsUrl} rel="noreferrer" target="_blank">
        {t('auth.legal.terms')}
      </a>
      {t('auth.legal.and')}
      <a className={linkClass} href={brand.privacyUrl} rel="noreferrer" target="_blank">
        {t('auth.legal.privacy')}
      </a>
      {t('auth.legal.agreeSuffix')}
    </p>
  );
}
