import { BrandMark } from '@nibleaf/design-system/brand';
import { isRtl } from '@nibleaf/i18n/locales';
import { useLocale } from '@nibleaf/i18n/react';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { ForkFooter } from '@/components/fork-footer';
import { useBrand } from '@/lib/brand';

/** One numbered section of a legal page. */
export interface LegalSection {
  heading: string;
  body: ReactNode;
}

const linkClass = 'underline-offset-4 hover:text-foreground hover:underline';

/** A `mailto:` link showing the address. */
export const Mail = ({ address }: { address: string }) => (
  <a className="text-foreground underline underline-offset-4" href={`mailto:${address}`}>
    {address}
  </a>
);

/** Shell of the built-in legal pages: brand header, localized title, English body, legal links and fork footer. */
export function LegalPage({ title, intro, sections }: { title: string; intro: ReactNode; sections: LegalSection[] }) {
  const { locale, t } = useLocale();
  const brand = useBrand();
  return (
    <div className="flex min-h-screen flex-col bg-background px-6 py-10" dir={isRtl(locale) ? 'rtl' : 'ltr'} lang={locale}>
      <header className="mx-auto w-full max-w-3xl">
        <Link className="inline-flex items-center gap-2" to="/">
          <BrandMark className="size-7" />
          <span className="font-semibold text-lg tracking-tight">{brand.name}</span>
        </Link>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 py-12">
        <h1 className="text-balance font-semibold text-3xl tracking-tight sm:text-4xl">{title}</h1>
        <article className="mt-8 space-y-8 text-muted-foreground leading-relaxed" dir="ltr" lang="en">
          <p>{intro}</p>
          {sections.map((section, index) => (
            <section key={section.heading}>
              <h2 className="font-semibold text-foreground text-xl tracking-tight">
                {index + 1}. {section.heading}
              </h2>
              <div className="mt-3 space-y-3">{section.body}</div>
            </section>
          ))}
        </article>
      </main>
      <nav className="flex justify-center gap-4 text-muted-foreground text-xs">
        <a className={linkClass} href={brand.termsUrl}>
          {t('auth.legal.terms')}
        </a>
        <a className={linkClass} href={brand.privacyUrl}>
          {t('auth.legal.privacy')}
        </a>
      </nav>
      <ForkFooter className="mt-3" />
    </div>
  );
}
