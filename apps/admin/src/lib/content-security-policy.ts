const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';

/** Enforced policy for the private administration surface. The application is
 * never embeddable and communicates with its same-origin API proxy plus the one
 * configured customer-app origin used for the support-session handoff.
 * Turnstile's script and frame are allowed only when it is the captcha provider. */
export function adminContentSecurityPolicy(nonce: string, appOrigin: string, turnstile = false): string {
  const trustedAppOrigin = new URL(appOrigin).origin;
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src 'self' 'nonce-${nonce}'${turnstile ? ` ${TURNSTILE_ORIGIN}` : ''}`,
    ...(turnstile ? [`frame-src ${TURNSTILE_ORIGIN}`] : []),
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' data: blob:",
    `connect-src 'self' ${trustedAppOrigin}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ].join('; ');
}
