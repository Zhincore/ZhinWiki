import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { errorMiddleware } from '@/errors/handler';
import type { HonoEnv } from '@/lib/hono/context';

const mocks = vi.hoisted(() => ({
  config: { provider: 'altcha' as 'altcha' | 'turnstile' | 'off' },
  verify: vi.fn(),
  extras: { OTP_SEND_LIMIT_PER_IP: 4, OTP_SEND_LIMIT_PER_EMAIL: 2, TRUSTED_PROXY_HOPS: 0, INTERNAL_API_SECRET: undefined },
}));

vi.mock('@/lib/captcha', () => ({ captchaConfig: mocks.config, verifyCaptcha: mocks.verify }));
vi.mock('@/lib/env-extras', () => ({ envExtras: mocks.extras }));

import { emailSendGuards } from './email-send';

const build = (exempt = async () => false) => {
  const sent = vi.fn();
  const app = new Hono<HonoEnv>();
  app.onError(errorMiddleware({ isDevelopment: false }));
  app.use('/send', ...emailSendGuards(exempt));
  app.post('/send', (ctx) => {
    sent();
    return ctx.json({ success: true });
  });
  return { app, sent };
};

const send = (app: Hono<HonoEnv>, { email = 'ada@example.test', ip = '198.51.100.7', captcha = 'solution' } = {}) =>
  app.request('/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...(captcha ? { 'x-captcha-response': captcha } : {}) },
    body: JSON.stringify({ email, type: 'sign-in' }),
  });

describe('email send guards', () => {
  beforeEach(() => {
    mocks.config.provider = 'altcha';
    mocks.verify.mockReset().mockResolvedValue('verified');
  });

  it('requires a captcha solution before sending', async () => {
    const { app, sent } = build();
    const response = await send(app, { captcha: '' });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'CAPTCHA_REQUIRED' });
    expect(sent).not.toHaveBeenCalled();
  });

  it('refuses failed solutions and fails closed when the provider is unreachable', async () => {
    const { app, sent } = build();
    mocks.verify.mockResolvedValueOnce('invalid').mockResolvedValueOnce('unavailable');
    expect((await send(app)).status).toBe(403);
    const unavailable = await send(app);
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toMatchObject({ code: 'CAPTCHA_UNAVAILABLE' });
    expect(sent).not.toHaveBeenCalled();
    expect(mocks.verify).toHaveBeenCalledWith('solution', '198.51.100.7');
  });

  it('skips the captcha when the provider is off or the request is exempt', async () => {
    mocks.config.provider = 'off';
    const off = build();
    expect((await send(off.app, { captcha: '' })).status).toBe(200);

    mocks.config.provider = 'altcha';
    const exempt = build(async () => true);
    expect((await send(exempt.app, { captcha: '' })).status).toBe(200);
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it('limits sends per address across IPs, case-insensitively', async () => {
    const { app } = build();
    expect((await send(app, { email: 'ada@example.test', ip: '198.51.100.1' })).status).toBe(200);
    expect((await send(app, { email: 'ADA@example.test', ip: '198.51.100.2' })).status).toBe(200);
    const limited = await send(app, { email: 'ada@example.test', ip: '198.51.100.3' });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(3500);
    expect(await limited.json()).toMatchObject({ error: { code: 'http:rate_limited' } });
    expect((await send(app, { email: 'grace@example.test', ip: '198.51.100.3' })).status).toBe(200);
  });

  it('limits sends per IP across addresses', async () => {
    const { app } = build();
    for (const name of ['a', 'b', 'c', 'd']) {
      expect((await send(app, { email: `${name}@example.test` })).status).toBe(200);
    }
    expect((await send(app, { email: 'e@example.test' })).status).toBe(429);
    expect((await send(app, { email: 'e@example.test', ip: '198.51.100.8' })).status).toBe(200);
  });

  it('spends the per-address budget only on solved requests', async () => {
    const { app } = build();
    mocks.verify.mockResolvedValue('invalid');
    expect((await send(app, { ip: '198.51.100.11' })).status).toBe(403);
    expect((await send(app, { ip: '198.51.100.12' })).status).toBe(403);
    mocks.verify.mockResolvedValue('verified');
    expect((await send(app, { ip: '198.51.100.13' })).status).toBe(200);
  });
});
