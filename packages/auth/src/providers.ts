export const OAUTH_PROVIDERS = ['google', 'github', 'discord'] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export interface OAuthEnvironment {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  DISCORD_CLIENT_ID?: string;
  DISCORD_CLIENT_SECRET?: string;
}

export interface OAuthCredentials {
  clientId: string;
  clientSecret: string;
}

/** Credentials of each provider whose id and secret are both non-blank. */
export function oauthCredentials(environment: OAuthEnvironment): Partial<Record<OAuthProvider, OAuthCredentials>> {
  const configured: Partial<Record<OAuthProvider, OAuthCredentials>> = {};
  for (const provider of OAUTH_PROVIDERS) {
    const prefix = provider.toUpperCase() as Uppercase<OAuthProvider>;
    const clientId = environment[`${prefix}_CLIENT_ID`]?.trim();
    const clientSecret = environment[`${prefix}_CLIENT_SECRET`]?.trim();
    if (clientId && clientSecret) {
      configured[provider] = { clientId, clientSecret };
    }
  }
  return configured;
}

/** Keep server registration and public capability metadata on the same rule. */
export function enabledOAuthProviders(environment: OAuthEnvironment): Record<OAuthProvider, boolean> {
  const configured = oauthCredentials(environment);
  return { google: Boolean(configured.google), github: Boolean(configured.github), discord: Boolean(configured.discord) };
}

/** An OAuth callback about to create an account for an address the provider
 *  has not verified; such sign-ups are refused. */
export function isUnverifiedOAuthSignUp(user: { emailVerified?: boolean | null }, path: string | undefined): boolean {
  return Boolean(path?.startsWith('/callback/')) && user.emailVerified !== true;
}
