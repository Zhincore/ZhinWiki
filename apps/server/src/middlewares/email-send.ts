import type { Context } from 'hono';
import { envExtras } from '@/lib/env-extras';
import type { HonoEnv } from '@/lib/hono/context';
import { requireCaptcha } from './captcha';
import { clientBucket, rateLimit } from './rate-limit';

const HOUR_MS = 60 * 60_000;

/** Lower-cased `email` of a JSON request body, read from a clone. */
export const emailFromJsonBody = async (request: Request): Promise<string | null> => {
  try {
    const body = (await request.clone().json()) as { email?: unknown };
    return typeof body.email === 'string' ? body.email.trim().toLowerCase() : null;
  } catch {
    return null;
  }
};

/**
 * Guards for unauthenticated endpoints that send email: the captcha, then
 * per-IP and per-address budgets that only solved requests can spend, so
 * unsolved requests cannot lock a shared IP or an address out.
 */
export const emailSendGuards = (exemptFromCaptcha: (ctx: Context<HonoEnv>) => Promise<boolean>) =>
  [
    requireCaptcha(exemptFromCaptcha),
    rateLimit({
      name: 'email-send-ip',
      windowMs: HOUR_MS,
      max: envExtras.OTP_SEND_LIMIT_PER_IP,
      key: (ctx) => (ctx.req.method === 'POST' ? clientBucket(ctx) : null),
    }),
    rateLimit({
      name: 'email-send-address',
      windowMs: HOUR_MS,
      max: envExtras.OTP_SEND_LIMIT_PER_EMAIL,
      key: (ctx) => (ctx.req.method === 'POST' ? emailFromJsonBody(ctx.req.raw) : null),
    }),
  ] as const;
