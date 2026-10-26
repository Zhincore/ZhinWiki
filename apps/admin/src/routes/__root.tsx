import { BrandProvider } from '@nibleaf/design-system/brand';
import { ConfirmProvider } from '@nibleaf/design-system/components/ui/confirm';
import { Toaster } from '@nibleaf/design-system/components/ui/sonner';
import { ThemeProvider } from '@nibleaf/design-system/theme';
import { isRtl, setMessageBrand, translateFn } from '@nibleaf/i18n';
import { useLocale } from '@nibleaf/i18n/react';
import { brandIconLinks, DEFAULT_BRAND } from '@nibleaf/shared/brand';
import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, HeadContent, Outlet, Scripts } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { getBrandFn } from '@/functions/brand';
import { APP_URL_META, appUrl } from '@/lib/public-urls';
import appCss from '@/styles.css?url';

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  // The brand and app URL come from runtime env; they never change while the panel runs.
  loader: async () => ({ brand: await getBrandFn(), appUrl: appUrl() }),
  staleTime: Number.POSITIVE_INFINITY,
  head: ({ loaderData }) => {
    const { iconBase, name, themeColor } = loaderData?.brand ?? DEFAULT_BRAND;
    const title = translateFn('admin.meta.title', { brand: name });
    return {
      meta: [
        { charSet: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { title },
        { name: 'application-name', content: title },
        { name: 'theme-color', content: themeColor },
        // Internal panel — never index.
        { name: 'robots', content: 'noindex, nofollow' },
      ],
      links: [{ rel: 'stylesheet', href: appCss }, ...brandIconLinks(iconBase)],
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
  const { locale } = useLocale();
  const { appUrl } = Route.useLoaderData();
  return (
    <html lang={locale} dir={isRtl(locale) ? 'rtl' : 'ltr'} suppressHydrationWarning>
      <head>
        <meta name={APP_URL_META} content={appUrl} />
        <HeadContent />
      </head>
      <body>
        <ThemeProvider>
          <ConfirmProvider>{children}</ConfirmProvider>
          <Toaster position="bottom-right" richColors />
        </ThemeProvider>
        <Scripts />
      </body>
    </html>
  );
}
