import { type Brand, DEFAULT_BRAND } from '@nibleaf/shared/brand';
import type { MessageVariables } from './message-types';

/** Brand variables every message may reference as `{brand}` / `{supportEmail}`. */
const brandVariables = { brand: DEFAULT_BRAND.name, supportEmail: DEFAULT_BRAND.supportEmail };

/** Set the instance brand for all messages in this process (once at startup, or on render). */
export function setMessageBrand(brand: Pick<Brand, 'name' | 'supportEmail'>): void {
  brandVariables.brand = brand.name;
  brandVariables.supportEmail = brand.supportEmail;
}

/** Message variables with the brand filled in; explicit variables win. */
export const withBrand = (variables?: MessageVariables): MessageVariables => (variables ? { ...brandVariables, ...variables } : brandVariables);
