import { BrandAccentStyle, BrandProvider } from '@nibleaf/design-system/brand';
import { ThemeProvider } from '@nibleaf/design-system/theme';
import { setMessageBrand } from '@nibleaf/i18n/brand';
import { brandIconLinks, DEFAULT_BRAND } from '@nibleaf/shared/brand';
import { createRootRoute, HeadContent, Outlet, Scripts, useRouter, useRouterState } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { getBrandFn } from '@/functions/brand';
import type { SiteShell } from '@/hooks/api/types';
import { formatHomepage } from '@/lib/homepage';
import { PUBLIC_URL_META, publicUrls } from '@/lib/public-urls';
import { currentHomepage } from '@/lib/site-origin';
import { siteThemeNoFlashScript } from '@/lib/site-theme';
import appCss from '@/styles.css?url';

export const Route = createRootRoute({
  // The brand, homepage and public URLs come from runtime env; they never change while the app runs.
  loader: async () => ({ brand: await getBrandFn(), homepage: currentHomepage(), urls: publicUrls() }),
  staleTime: Number.POSITIVE_INFINITY,
  head: ({ loaderData }) => {
    const brand = loaderData?.brand ?? DEFAULT_BRAND;
    return {
      meta: [
        { charSet: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { title: `${brand.name} — documentation workspace` },
        { name: 'application-name', content: brand.name },
        { name: 'theme-color', content: brand.themeColor },
      ],
      links: [{ rel: 'stylesheet', href: appCss }, ...brandIconLinks(brand.iconBase)],
    };
  },
  component: RootComponent,
});

function RootComponent() {
  const { brand } = Route.useLoaderData();
  // One brand per process/page: messages read it during this render's children.
  setMessageBrand(brand);
  return (
    <BrandProvider brand={brand}>
      <RootDocument>
        <Outlet />
      </RootDocument>
    </BrandProvider>
  );
}

function RootDocument({ children }: { children: ReactNode }) {
  const nonce = useRouter().options.ssr?.nonce;
  // Reflect a published site's active language on <html lang/dir> during SSR (so
  // crawlers + the first paint see e.g. lang="ar" dir="rtl"), updating reactively
  // on ?lang switches. Non-site routes keep the en/ltr default — the dashboard's
  // own DirectionProvider governs its direction.
  const { lang, dir, siteProjectId, siteThemeDefault } = useRouterState({
    select: (state) => {
      const match = state.matches.find((m) => m.routeId === '/sites/$projectId');
      const site = (match?.loaderData as { site?: SiteShell } | undefined)?.site;
      if (!site) {
        return { lang: 'en', dir: 'ltr' as const, siteProjectId: undefined, siteThemeDefault: undefined };
      }
      const code = (state.location.search as { lang?: string }).lang ?? site.activeLanguage;
      const active = site.languages.find((l) => l.code === code) ?? site.languages.find((l) => l.isDefault) ?? site.languages[0];
      return {
        lang: active?.code ?? 'en',
        dir: active?.direction === 'RTL' ? ('rtl' as const) : ('ltr' as const),
        siteProjectId: (match?.params as { projectId?: string } | undefined)?.projectId,
        siteThemeDefault: site.project.config?.styling?.theme ?? 'light',
      };
    },
  });
  const siteThemeBootstrap = siteProjectId ? siteThemeNoFlashScript(siteProjectId, siteThemeDefault ?? 'light') : null;
  const { homepage, urls } = Route.useLoaderData();
  return (
    <html lang={lang} dir={dir} suppressHydrationWarning>
      <head>
        {nonce ? <meta property="csp-nonce" content={nonce} /> : null}
        {siteProjectId ? <meta name="nibleaf-site-project" content={siteProjectId} /> : null}
        {homepage.mode !== 'welcome' ? <meta name="nibleaf-homepage" content={formatHomepage(homepage)} /> : null}
        <meta name={PUBLIC_URL_META.appUrl} content={urls.appUrl} />
        {urls.siteBaseDomain ? <meta name={PUBLIC_URL_META.siteBaseDomain} content={urls.siteBaseDomain} /> : null}
        <HeadContent />
        {/* Published sites keep their own theme accent. */}
        {siteProjectId ? null : <BrandAccentStyle />}
      </head>
      <body>
        <ThemeProvider applyDocumentTheme={!siteProjectId} initialThemeScript={siteThemeBootstrap ?? undefined}>
          {children}
        </ThemeProvider>
        <Scripts />
      </body>
    </html>
  );
}
