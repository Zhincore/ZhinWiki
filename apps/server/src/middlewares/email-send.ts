import type { Context } from 'hono';
import { envExtras } from '@/lib/env-extras';
import type { HonoEnv } from '@/lib/hono/context';
import { requireCaptcha } from './captcha';
import { rateLimit, resolveClientKey } from './rate-limit';

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
 * Guards for unauthenticated endpoints that send email: a per-IP budget, the
 * captcha, then a per-address budget that only solved requests can spend.
 */
export const emailSendGuards = (exemptFromCaptcha: (ctx: Context<HonoEnv>) => Promise<boolean>) =>
  [
    rateLimit({
      name: 'email-send-ip',
      windowMs: HOUR_MS,
      max: envExtras.OTP_SEND_LIMIT_PER_IP,
      key: (ctx) => (ctx.req.method === 'POST' ? resolveClientKey(ctx) : null),
    }),
    requireCaptcha(exemptFromCaptcha),
    rateLimit({
      name: 'email-send-address',
      windowMs: HOUR_MS,
      max: envExtras.OTP_SEND_LIMIT_PER_EMAIL,
      key: (ctx) => (ctx.req.method === 'POST' ? emailFromJsonBody(ctx.req.raw) : null),
    }),
  ] as const;
