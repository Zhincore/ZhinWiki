import { describe, expect, it } from 'vitest';
import { adminContentSecurityPolicy } from './content-security-policy';

describe('adminContentSecurityPolicy', () => {
  it('requires nonced scripts and prevents every embedding origin', () => {
    const policy = adminContentSecurityPolicy('test-nonce', 'https://nibleaf.test/path');

    expect(policy).toContain("script-src 'self' 'nonce-test-nonce'");
    expect(policy).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(policy).toContain("script-src-attr 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("connect-src 'self' https://nibleaf.test");
    expect(policy).not.toContain("connect-src 'self' https: http:");
  });

  it('allows Turnstile only when it is the captcha provider', () => {
    expect(adminContentSecurityPolicy('n', 'https://nibleaf.test')).not.toContain('challenges.cloudflare.com');
    const policy = adminContentSecurityPolicy('n', 'https://nibleaf.test', true);
    expect(policy).toContain("script-src 'self' 'nonce-n' https://challenges.cloudflare.com");
    expect(policy).toContain('frame-src https://challenges.cloudflare.com');
  });
});
