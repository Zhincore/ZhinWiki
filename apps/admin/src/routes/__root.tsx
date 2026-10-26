import { BrandProvider } from '@nibleaf/design-system/brand';
import { ConfirmProvider } from '@nibleaf/design-system/components/ui/confirm';
import { Toaster } from '@nibleaf/design-system/components/ui/sonner';
import { ThemeProvider } from '@nibleaf/design-system/theme';
import { isRtl, translateFn } from '@nibleaf/i18n';
import { useLocale } from '@nibleaf/i18n/react';
import { BRAND_ASSETS_PATH, DEFAULT_BRAND } from '@nibleaf/shared/brand';
import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, HeadContent, Outlet, Scripts } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { getBrandFn } from '@/functions/brand';
import appCss from '@/styles.css?url';

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  // The brand comes from runtime env; it never changes while the panel runs.
  loader: async () => ({ brand: await getBrandFn() }),
  staleTime: Number.POSITIVE_INFINITY,
  head: ({ loaderData }) => {
    const iconBase = (loaderData?.brand ?? DEFAULT_BRAND).iconBase;
    return {
      meta: [
        { charSet: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { title: translateFn('admin.meta.title') },
        { name: 'application-name', content: translateFn('admin.meta.title') },
        { name: 'theme-color', content: '#181612' },
        // Internal panel — never index.
        { name: 'robots', content: 'noindex, nofollow' },
      ],
      links: [
        { rel: 'stylesheet', href: appCss },
        { rel: 'icon', href: `${iconBase}/favicon.svg`, type: 'image/svg+xml' },
        { rel: 'icon', href: `${iconBase}/favicon-32x32.png`, type: 'image/png', sizes: '32x32' },
        { rel: 'apple-touch-icon', href: `${iconBase}/apple-touch-icon.png` },
        { rel: 'manifest', href: `${BRAND_ASSETS_PATH}/site.webmanifest` },
      ],
    };
  },
  component: RootComponent,
});

function RootComponent() {
  const { brand } = Route.useLoaderData();
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
  return (
    <html lang={locale} dir={isRtl(locale) ? 'rtl' : 'ltr'} suppressHydrationWarning>
      <head>
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
