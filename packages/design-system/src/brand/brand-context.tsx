import { type Brand, DEFAULT_BRAND } from '@nibleaf/shared/brand';
import { createContext, type ReactNode, useContext } from 'react';

const BrandContext = createContext<Brand>(DEFAULT_BRAND);

/** Provide the instance brand (loaded by the app's root route) to the tree. */
export function BrandProvider({ brand, children }: { brand: Brand; children: ReactNode }) {
  return <BrandContext.Provider value={brand}>{children}</BrandContext.Provider>;
}

/** The instance brand; the built-in default outside a provider (tests, early pending states). */
export const useBrand = (): Brand => useContext(BrandContext);
