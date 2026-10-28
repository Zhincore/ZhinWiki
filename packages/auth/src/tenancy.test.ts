import { describe, expect, it, vi } from 'vitest';
import { keys } from './keys.server';
import { onUserCreated } from './tenancy';

const user = { id: 'user-1', email: 'user@example.test' };

describe('TENANCY env', () => {
  const withTenancy = (value: string | undefined) => {
    vi.stubEnv('TENANCY', value);
    try {
      return keys().TENANCY;
    } finally {
      vi.unstubAllEnvs();
    }
  };

  it.each([undefined, ''])('defaults to multi when unset or empty (%j)', (value) => {
    expect(withTenancy(value)).toBe('multi');
  });

  it('accepts single', () => {
    expect(withTenancy('single')).toBe('single');
  });

  it('rejects an unknown value at boot', () => {
    expect(() => withTenancy('singel')).toThrow();
  });
});

describe('onUserCreated', () => {
  it('never blocks a single-tenancy sign-up on a failed event log', async () => {
    const provision = vi.fn();
    const handle = onUserCreated('single', { provision, logSignup: vi.fn(async () => Promise.reject(new Error('db down'))) });
    await expect(handle(user)).resolves.toBeUndefined();
    expect(provision).not.toHaveBeenCalled();
  });

  it('passes the request locale to multi-tenancy provisioning', async () => {
    const provision = vi.fn(async () => undefined);
    await onUserCreated('multi', { provision, logSignup: vi.fn() })(user, 'de');
    expect(provision).toHaveBeenCalledWith(user, 'de');
  });
});
