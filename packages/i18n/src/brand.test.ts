import { DEFAULT_BRAND } from '@nibleaf/shared/brand';
import { afterEach, describe, expect, it } from 'vitest';
import { setMessageBrand } from './brand';
import { emailT } from './email';
import { translateFn } from './translate';

afterEach(() => setMessageBrand(DEFAULT_BRAND));

describe('message brand', () => {
  it('fills {brand} and {supportEmail} from the instance brand', () => {
    setMessageBrand({ name: 'Acme Docs', supportEmail: 'help@acme.test' });
    expect(translateFn('auth.passwordless.subtitle', undefined, 'en')).toBe('Acme Docs is passwordless');
    expect(emailT('en')('email.newSignIn.detail')).toContain('help@acme.test');
    expect(translateFn('admin.meta.title', undefined, 'ar')).toBe('إدارة Acme Docs');
  });

  it('defaults to the built-in brand and lets explicit variables win', () => {
    expect(translateFn('auth.verify.continueToApp', undefined, 'en')).toBe(`Open ${DEFAULT_BRAND.name}`);
    expect(translateFn('admin.meta.title', { brand: 'Ops' }, 'en')).toBe('Ops Admin');
  });
});
