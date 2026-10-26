import { useT } from '@nibleaf/i18n/react';
import { useRouterState } from '@tanstack/react-router';
import { type ReactNode, useEffect } from 'react';
import { LocalizedProductProviders } from '@/components/localized-product-providers';
import { authDocumentTitle } from '@/lib/auth-document-title';
import { useBrand } from '@/lib/brand';

function AuthDocumentTitle() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const t = useT();
  const brandName = useBrand().name;

  useEffect(() => {
    const title = authDocumentTitle(pathname, t, brandName);
    if (title) document.title = title;
  }, [pathname, t, brandName]);

  return null;
}

/** Auth/common namespace only; editor, analytics, and admin copy remain in the
 * authenticated application chunk. */
export function AuthProviders({ children }: { children: ReactNode }) {
  return (
    <LocalizedProductProviders>
      <AuthDocumentTitle />
      {children}
    </LocalizedProductProviders>
  );
}
