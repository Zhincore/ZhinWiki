import { describe, expect, it } from 'vitest';
import { enabledOAuthProviders, isUnverifiedOAuthSignUp, oauthCredentials } from './providers';

describe('OAuth providers', () => {
  it('enables a provider only when both credentials are non-blank after trimming', () => {
    expect(enabledOAuthProviders({ GOOGLE_CLIENT_ID: 'client', GOOGLE_CLIENT_SECRET: 'secret' }).google).toBe(true);
    expect(enabledOAuthProviders({ GOOGLE_CLIENT_ID: 'client' }).google).toBe(false);
    expect(enabledOAuthProviders({ GITHUB_CLIENT_SECRET: 'secret' }).github).toBe(false);
    expect(enabledOAuthProviders({ GITHUB_CLIENT_ID: ' ', GITHUB_CLIENT_SECRET: 'secret' }).github).toBe(false);
    expect(enabledOAuthProviders({ DISCORD_CLIENT_ID: 'client', DISCORD_CLIENT_SECRET: ' ' }).discord).toBe(false);
  });

  it('keeps each provider independent', () => {
    expect(enabledOAuthProviders({ DISCORD_CLIENT_ID: 'client', DISCORD_CLIENT_SECRET: 'secret' })).toEqual({
      google: false,
      github: false,
      discord: true,
    });
    expect(oauthCredentials({ GITHUB_CLIENT_ID: ' id ', GITHUB_CLIENT_SECRET: ' secret ' })).toEqual({
      github: { clientId: 'id', clientSecret: 'secret' },
    });
  });

  it('refuses OAuth sign-up for addresses the provider has not verified', () => {
    expect(isUnverifiedOAuthSignUp({ emailVerified: false }, '/callback/discord')).toBe(true);
    expect(isUnverifiedOAuthSignUp({}, '/callback/github')).toBe(true);
    expect(isUnverifiedOAuthSignUp({ emailVerified: true }, '/callback/discord')).toBe(false);
    expect(isUnverifiedOAuthSignUp({ emailVerified: false }, '/sign-up/email')).toBe(false);
    expect(isUnverifiedOAuthSignUp({ emailVerified: false }, undefined)).toBe(false);
  });
});
