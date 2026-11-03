import { enabledOAuthProviders } from '@nibleaf/auth/providers';
import { Hono } from 'hono';
import { aiDraftAvailable } from '@/actions/ai';
import { env } from '@/env';
import { answerSearchAvailable } from '@/lib/ai-search/runtime';
import { captchaConfig } from '@/lib/captcha';
import { envExtras } from '@/lib/env-extras';
import type { HonoEnv } from '@/lib/hono/context';
import metaRoutes from './routes';

/** Public instance metadata. AI flags report instance capability only, never provider keys. OAuth credentials and captcha secrets never cross this boundary. */
const app = new Hono<HonoEnv>().get('/', ...metaRoutes.meta, (ctx) =>
  ctx.json(
    {
      data: {
        ai: { draft: aiDraftAvailable(), answers: answerSearchAvailable() },
        providers: enabledOAuthProviders(env),
        captcha: { provider: captchaConfig.provider, siteKey: captchaConfig.siteKey ?? null },
        signupDisabled: envExtras.DISABLE_SIGNUP,
      },
    },
    200,
  ),
);

export default app;
