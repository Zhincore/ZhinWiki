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

  it('rejects an unknown value at boot', () => {
    expect(() => withTenancy('singel')).toThrow();
  });
});

describe('onUserCreated', () => {
  it('never blocks a single-tenancy sign-up on a failed event log, and reports it', async () => {
    const provision = vi.fn();
    const onLogFailure = vi.fn();
    const failure = new Error('db down');
    const handle = onUserCreated('single', { provision, logSignup: vi.fn(async () => Promise.reject(failure)), onLogFailure });
    await expect(handle(user)).resolves.toBeUndefined();
    expect(provision).not.toHaveBeenCalled();
    expect(onLogFailure).toHaveBeenCalledWith(failure, user.id);
  });

  it('passes the request locale to multi-tenancy provisioning', async () => {
    const provision = vi.fn(async () => undefined);
    await onUserCreated('multi', { provision, logSignup: vi.fn(), onLogFailure: vi.fn() })(user, 'de');
    expect(provision).toHaveBeenCalledWith(user, 'de');
  });
});
