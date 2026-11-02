import { createHmac, randomUUID } from 'node:crypto';
import { keys as authKeys } from '@nibleaf/auth/keys.server';
import { type Challenge, createChallenge, type Payload, randomInt, verifySolution } from 'altcha-lib';
import { deriveKey } from 'altcha-lib/algorithms/pbkdf2';
import { envExtras } from './env-extras';
import { redisConfigured, sharedRedis } from './redis';

export type CaptchaProvider = 'altcha' | 'turnstile' | 'off';
export type CaptchaResult = 'verified' | 'invalid' | 'unavailable';

const TURNSTILE_SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const CHALLENGE_TTL_MS = 10 * 60_000;
const MAX_REMEMBERED_SOLUTIONS = 10_000;

/** Provider settings, validated once; a half-configured Turnstile stops boot. */
export const captchaConfig = (() => {
  const provider: CaptchaProvider = envExtras.CAPTCHA_PROVIDER;
  const siteKey = envExtras.TURNSTILE_SITE_KEY?.trim();
  const secretKey = envExtras.TURNSTILE_SECRET_KEY?.trim();
  if (provider === 'turnstile' && !(siteKey && secretKey)) {
    throw new Error('CAPTCHA_PROVIDER=turnstile needs TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY.');
  }
  return { provider, siteKey: provider === 'turnstile' ? siteKey : undefined, secretKey };
})();

const hmac = (key: string, label: string): string => createHmac('sha256', key).update(label).digest('hex');

/** CAPTCHA_HMAC_KEY, or a key derived from BETTER_AUTH_SECRET when unset. */
const altchaKey = envExtras.CAPTCHA_HMAC_KEY ?? hmac(authKeys().BETTER_AUTH_SECRET, 'nibleaf:captcha');
const altchaSecrets = {
  hmacSignatureSecret: hmac(altchaKey, 'altcha:challenge'),
  hmacKeySignatureSecret: hmac(altchaKey, 'altcha:key'),
};

/** Signed proof-of-work challenge, valid for CHALLENGE_TTL_MS. */
export const createAltchaChallenge = (): Promise<Challenge> =>
  createChallenge({
    algorithm: 'PBKDF2/SHA-256',
    // Deterministic counter: the browser searches up to it, verification checks one signature.
    cost: 1000,
    counter: randomInt(6000, 2000),
    deriveKey,
    expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    ...altchaSecrets,
  });

const remembered = new Map<string, number>();

/** Marks `id` used for `ttlMs`; false when it already was. Shared through
 *  Redis when configured, per process otherwise or while Redis is down. */
export const claimOnce = async (id: string, ttlMs: number): Promise<boolean> => {
  if (redisConfigured()) {
    try {
      const client = await sharedRedis();
      return (await client.set(`nibleaf:captcha:${id}`, '1', 'PX', ttlMs, 'NX')) === 'OK';
    } catch {
      // Fall through to this process's memory.
    }
  }
  const now = Date.now();
  if ((remembered.get(id) ?? 0) > now) {
    return false;
  }
  if (remembered.size >= MAX_REMEMBERED_SOLUTIONS) {
    for (const [key, expiresAt] of remembered) {
      if (expiresAt <= now || remembered.size >= MAX_REMEMBERED_SOLUTIONS) {
        remembered.delete(key);
      }
    }
  }
  remembered.set(id, now + ttlMs);
  return true;
};

const parseAltchaPayload = (token: string): Payload | null => {
  try {
    const payload = JSON.parse(Buffer.from(token, 'base64').toString('utf8')) as Payload;
    return payload?.challenge?.parameters && payload.solution ? payload : null;
  } catch {
    return null;
  }
};

/** Valid, unexpired, signed by us, and not used before. */
export const verifyAltcha = async (token: string): Promise<CaptchaResult> => {
  const payload = parseAltchaPayload(token);
  if (!payload) {
    return 'invalid';
  }
  const result = await verifySolution({ challenge: payload.challenge, solution: payload.solution, deriveKey, ...altchaSecrets }).catch(() => null);
  const expiresAt = (payload.challenge.parameters.expiresAt ?? 0) * 1000;
  if (!result?.verified || expiresAt <= Date.now()) {
    return 'invalid';
  }
  return (await claimOnce(`altcha:${payload.challenge.parameters.nonce}`, expiresAt - Date.now())) ? 'verified' : 'invalid';
};

/** Cloudflare siteverify; one retry with the same idempotency key on network failure. */
export const verifyTurnstile = async (token: string, remoteIp: string | null): Promise<CaptchaResult> => {
  const body = new URLSearchParams({ secret: captchaConfig.secretKey ?? '', response: token, idempotency_key: randomUUID() });
  if (remoteIp) {
    body.set('remoteip', remoteIp);
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(TURNSTILE_SITEVERIFY, { method: 'POST', body, signal: AbortSignal.timeout(5000) });
      if (response.ok) {
        const outcome = (await response.json()) as { success?: boolean };
        return outcome.success === true ? 'verified' : 'invalid';
      }
    } catch {
      // Retried below.
    }
  }
  return 'unavailable';
};

export const verifyCaptcha = (token: string, remoteIp: string | null): Promise<CaptchaResult> =>
  captchaConfig.provider === 'turnstile' ? verifyTurnstile(token, remoteIp) : verifyAltcha(token);
