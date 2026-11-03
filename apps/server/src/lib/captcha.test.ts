import { solveChallenge } from 'altcha-lib';
import { deriveKey } from 'altcha-lib/algorithms/pbkdf2';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const extras = vi.hoisted(() => ({
  CAPTCHA_PROVIDER: 'altcha' as 'altcha' | 'turnstile' | 'off',
  CAPTCHA_HMAC_KEY: 'captcha-test-key-with-at-least-32-characters',
  TURNSTILE_SITE_KEY: undefined as string | undefined,
  TURNSTILE_SECRET_KEY: undefined as string | undefined,
}));

vi.mock('./env-extras', () => ({ envExtras: extras }));

const load = async (overrides: Partial<typeof extras> = {}) => {
  Object.assign(extras, { CAPTCHA_PROVIDER: 'altcha', TURNSTILE_SITE_KEY: undefined, TURNSTILE_SECRET_KEY: undefined }, overrides);
  vi.resetModules();
  return import('./captcha');
};

const solvedPayload = async (createAltchaChallenge: () => Promise<Parameters<typeof solveChallenge>[0]['challenge']>) => {
  const challenge = await createAltchaChallenge();
  const solution = await solveChallenge({ challenge, deriveKey });
  return Buffer.from(JSON.stringify({ challenge, solution })).toString('base64');
};

// Each case solves a real proof of work.
describe('ALTCHA verification', { timeout: 30_000 }, () => {
  const previousHost = process.env.REDIS_HOST;
  beforeEach(() => {
    delete process.env.REDIS_HOST;
  });
  afterEach(() => {
    vi.useRealTimers();
    if (previousHost !== undefined) process.env.REDIS_HOST = previousHost;
  });

  it('accepts a solved challenge once and refuses its replay', async () => {
    const { createAltchaChallenge, verifyAltcha } = await load();
    const payload = await solvedPayload(createAltchaChallenge);
    expect(await verifyAltcha(payload)).toBe('verified');
    expect(await verifyAltcha(payload)).toBe('invalid');
  });

  it('refuses new claims while the per-process store is full of unexpired ones', async () => {
    const { claimOnce } = await load();
    for (let index = 0; index < 10_000; index += 1) {
      await claimOnce(`id-${index}`, 60_000);
    }
    expect(await claimOnce('one-more', 60_000)).toBe(false);
    expect(await claimOnce('id-0', 60_000)).toBe(false);
  });

  it('refuses an expired challenge', async () => {
    const { createAltchaChallenge, verifyAltcha } = await load();
    const payload = await solvedPayload(createAltchaChallenge);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 10 * 60_000 + 1000);
    expect(await verifyAltcha(payload)).toBe('invalid');
  });

  it('refuses challenges signed with another key and malformed payloads', async () => {
    const foreign = await load({ CAPTCHA_HMAC_KEY: 'another-captcha-key-with-at-least-32-chars' });
    const payload = await solvedPayload(foreign.createAltchaChallenge);
    const { verifyAltcha } = await load({ CAPTCHA_HMAC_KEY: 'captcha-test-key-with-at-least-32-characters' });
    expect(await verifyAltcha(payload)).toBe('invalid');
    expect(await verifyAltcha('not-a-payload')).toBe('invalid');
  });
});

describe('Turnstile verification', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const hosts = ['docs.example.test'];
  const issued = { success: true, hostname: 'docs.example.test', action: 'email-send' };
  const turnstile = () => load({ CAPTCHA_PROVIDER: 'turnstile', TURNSTILE_SITE_KEY: 'site', TURNSTILE_SECRET_KEY: 'secret' });

  it('refuses to boot without both keys', async () => {
    await expect(load({ CAPTCHA_PROVIDER: 'turnstile', TURNSTILE_SITE_KEY: 'site' })).rejects.toThrow(/TURNSTILE_SECRET_KEY/);
  });

  it('verifies server-side with the secret and the visitor IP', async () => {
    fetchMock.mockResolvedValue(Response.json(issued));
    const { verifyCaptcha } = await turnstile();
    expect(await verifyCaptcha('token', '198.51.100.7', hosts)).toBe('verified');
    const body = fetchMock.mock.calls[0]?.[1].body as URLSearchParams;
    expect(Object.fromEntries(body)).toMatchObject({ secret: 'secret', response: 'token', remoteip: '198.51.100.7' });
    expect(body.get('idempotency_key')).toBeTruthy();
  });

  it('refuses tokens Cloudflare rejects, including reused ones', async () => {
    fetchMock.mockResolvedValue(Response.json({ success: false, 'error-codes': ['timeout-or-duplicate'] }));
    const { verifyCaptcha } = await turnstile();
    expect(await verifyCaptcha('token', null, hosts)).toBe('invalid');
  });

  it('refuses tokens solved on another hostname or widget action', async () => {
    const { verifyCaptcha } = await turnstile();
    fetchMock.mockResolvedValueOnce(Response.json({ ...issued, hostname: 'elsewhere.example' }));
    expect(await verifyCaptcha('token', null, hosts)).toBe('invalid');
    fetchMock.mockResolvedValueOnce(Response.json({ ...issued, action: 'login' }));
    expect(await verifyCaptcha('token', null, hosts)).toBe('invalid');
  });

  it("accepts Cloudflare's test-key results only when flagged as such", async () => {
    const { verifyCaptcha } = await turnstile();
    const testResult = { success: true, hostname: 'example.com' };
    fetchMock.mockResolvedValueOnce(Response.json({ ...testResult, metadata: { result_with_testing_key: true } }));
    expect(await verifyCaptcha('token', null, hosts)).toBe('verified');
    fetchMock.mockResolvedValueOnce(Response.json(testResult));
    expect(await verifyCaptcha('token', null, hosts)).toBe('invalid');
  });

  it('retries a network failure with the same idempotency key, then fails closed', async () => {
    fetchMock.mockRejectedValueOnce(new Error('reset')).mockResolvedValueOnce(Response.json(issued));
    const { verifyCaptcha } = await turnstile();
    expect(await verifyCaptcha('token', null, hosts)).toBe('verified');
    const keys = fetchMock.mock.calls.map((call) => (call[1].body as URLSearchParams).get('idempotency_key'));
    expect(keys[0]).toBe(keys[1]);

    fetchMock.mockReset();
    fetchMock.mockRejectedValue(new Error('down'));
    expect(await verifyCaptcha('token', null, hosts)).toBe('unavailable');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

const redisUrl = process.env.REDIS_INTEGRATION_URL;

describe.skipIf(!redisUrl)('replay store in Redis', () => {
  it('claims an id once across processes until it expires', async () => {
    const url = new URL(redisUrl ?? '');
    Object.assign(process.env, { REDIS_HOST: url.hostname, REDIS_PORT: url.port || '6379' });
    const id = `test:${crypto.randomUUID()}`;
    const first = await load();
    const second = await load();
    expect(await first.claimOnce(id, 300)).toBe(true);
    expect(await second.claimOnce(id, 300)).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(await second.claimOnce(id, 300)).toBe(true);
  });
});
