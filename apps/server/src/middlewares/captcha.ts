import type { Context, MiddlewareHandler } from 'hono';
import { env } from '@/env';
import { captchaConfig, verifyCaptcha } from '@/lib/captcha';
import type { HonoEnv } from '@/lib/hono/context';
import { resolveClientKey } from './rate-limit';

/** Request header carrying the widget's solution (ALTCHA payload or Turnstile token). */
const CAPTCHA_HEADER = 'x-captcha-response';

/** Hosts that render the widget: the app and the admin console. */
const widgetHostnames = (): string[] => [new URL(env.APP_URL).hostname, new URL(env.ADMIN_URL).hostname];

/**
 * Refuses POSTs without a solved captcha, unless the provider is `off` or
 * `exempt` says the request needs none. Errors use Better Auth's
 * `{ code, message }` shape so the auth client surfaces them as-is.
 */
export const requireCaptcha =
  (exempt: (ctx: Context<HonoEnv>) => Promise<boolean>): MiddlewareHandler<HonoEnv> =>
  async (ctx, next) => {
    if (ctx.req.method !== 'POST' || captchaConfig.provider === 'off' || (await exempt(ctx))) {
      return next();
    }
    const token = ctx.req.header(CAPTCHA_HEADER)?.trim();
    if (!token) {
      return ctx.json({ code: 'CAPTCHA_REQUIRED', message: 'Complete the bot check first.' }, 400);
    }
    const ip = resolveClientKey(ctx);
    const result = await verifyCaptcha(token, ip === 'unknown' ? null : ip, widgetHostnames());
    if (result === 'unavailable') {
      return ctx.json({ code: 'CAPTCHA_UNAVAILABLE', message: 'The bot check is unavailable, try again later.' }, 503);
    }
    if (result === 'invalid') {
      return ctx.json({ code: 'CAPTCHA_FAILED', message: 'The bot check failed, try again.' }, 403);
    }
    return next();
  };
