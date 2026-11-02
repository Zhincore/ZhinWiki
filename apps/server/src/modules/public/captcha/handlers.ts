import { Hono } from 'hono';
import { AppError } from '@/errors';
import { captchaConfig, createAltchaChallenge } from '@/lib/captcha';
import type { HonoEnv } from '@/lib/hono/context';
import captchaRoutes from './routes';

/** Fresh ALTCHA proof-of-work challenge; 404 under other providers. */
const app = new Hono<HonoEnv>().get('/', ...captchaRoutes.challenge, async (ctx) => {
  if (captchaConfig.provider !== 'altcha') {
    throw new AppError({ code: 'http:not_found', message: 'Captcha challenges are not enabled.' });
  }
  ctx.header('Cache-Control', 'no-store');
  return ctx.json(await createAltchaChallenge(), 200);
});

export default app;
