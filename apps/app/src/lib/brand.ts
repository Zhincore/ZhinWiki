import { type Brand, DEFAULT_BRAND } from '@nibleaf/shared/brand';

export { useBrand } from '@nibleaf/design-system/brand';

/** The brand the root route loaded (`matches[0]`), or the default before it has loaded. */
export const loadedBrand = (matches: ReadonlyArray<{ loaderData?: unknown }>): Brand =>
  (matches[0]?.loaderData as { brand?: Brand } | undefined)?.brand ?? DEFAULT_BRAND;

/** `‹title› — ‹brand›` for a route `head`. */
export const brandedTitle = (matches: ReadonlyArray<{ loaderData?: unknown }>, title: string, separator = '—'): string =>
  `${title} ${separator} ${loadedBrand(matches).name}`;
