import { BrandMark } from '@nibleaf/design-system/brand';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { isRtl } from '@nibleaf/i18n/locales';
import { useLocale } from '@nibleaf/i18n/react';
import { Link } from '@tanstack/react-router';
import { ForkFooter } from '@/components/fork-footer';
import { useTenancy } from '@/hooks/use-tenancy';
import { useBrand } from '@/lib/brand';

/** The default `/` of a fresh instance: confirms it runs and points the operator at sign-in. */
export function WelcomePage({ signedIn }: { signedIn: boolean }) {
  const { locale, t } = useLocale();
  const brand = useBrand();
  const shared = useTenancy() === 'shared';
  return (
    <div className="flex min-h-screen flex-col bg-background px-6 py-10" dir={isRtl(locale) ? 'rtl' : 'ltr'} lang={locale}>
      <main className="flex flex-1 flex-col items-center justify-center text-center">
        <div className="inline-flex items-center gap-2.5">
          <BrandMark className="size-9" />
          <span className="font-semibold text-2xl tracking-tight">{brand.name}</span>
        </div>
        <h1 className="mt-8 max-w-xl text-balance font-semibold text-3xl tracking-tight sm:text-4xl">{t('welcome.heading')}</h1>
        <p className="mt-3 max-w-md text-muted-foreground">{t(shared ? 'welcome.descriptionShared' : 'welcome.description')}</p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
          {signedIn ? (
            <Button nativeButton={false} render={<Link to="/app" />} size="lg">
              {t('welcome.openDashboard')}
            </Button>
          ) : null}
          <Button nativeButton={false} render={<Link to="/sign-in" />} size="lg" variant={signedIn ? 'outline' : 'default'}>
            {t('welcome.signIn')}
          </Button>
          <Button nativeButton={false} render={<Link to="/sign-up" />} size="lg" variant="outline">
            {t('welcome.signUp')}
          </Button>
        </div>
        <p className="mt-12 max-w-md text-muted-foreground/80 text-xs">{t('welcome.operatorHint')}</p>
      </main>
      <ForkFooter className="mt-10" />
    </div>
  );
}
