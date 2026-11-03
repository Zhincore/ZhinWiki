import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HonoEnv } from '@/lib/hono/context';

const mocks = vi.hoisted(() => ({
  ai: { draft: false, answers: false },
  extras: { DISABLE_SIGNUP: false },
  env: {} as Record<string, string>,
  captcha: { provider: 'altcha', siteKey: undefined as string | undefined, secretKey: 'turnstile-secret' },
}));

vi.mock('@/env', () => ({ env: mocks.env }));
vi.mock('@/actions/ai', () => ({ aiDraftAvailable: () => mocks.ai.draft }));
vi.mock('@/lib/ai-search/runtime', () => ({ answerSearchAvailable: () => mocks.ai.answers }));
vi.mock('@/lib/env-extras', () => ({ envExtras: mocks.extras }));
vi.mock('@/lib/captcha', () => ({ captchaConfig: mocks.captcha }));

import handlers from './handlers';

const app = new Hono<HonoEnv>().route('/meta', handlers);

describe('public instance metadata', () => {
  beforeEach(() => {
    mocks.ai.draft = false;
    mocks.ai.answers = false;
    mocks.extras.DISABLE_SIGNUP = false;
    for (const key of Object.keys(mocks.env)) delete mocks.env[key];
    Object.assign(mocks.env, { GOOGLE_CLIENT_ID: 'google-id', GOOGLE_CLIENT_SECRET: 'google-secret' });
    Object.assign(mocks.captcha, { provider: 'altcha', siteKey: undefined });
  });

  it('reports providers, captcha and sign-up policy', async () => {
    const response = await app.request('/meta');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: {
        ai: { draft: false, answers: false },
        providers: { google: true, github: false, discord: false },
        captcha: { provider: 'altcha', siteKey: null },
        signupDisabled: false,
      },
    });
  });

  it('lists only OAuth providers with both credentials', async () => {
    Object.assign(mocks.env, { GITHUB_CLIENT_ID: 'github-id', GITHUB_CLIENT_SECRET: 'github-secret', DISCORD_CLIENT_ID: 'discord-id' });
    const body = (await (await app.request('/meta')).json()) as { data: { providers: Record<string, boolean> } };
    expect(body.data.providers).toEqual({ google: true, github: true, discord: false });
  });

  it('never exposes OAuth credentials or the captcha secret', async () => {
    Object.assign(mocks.captcha, { provider: 'turnstile', siteKey: 'turnstile-site' });
    const body = JSON.stringify(await (await app.request('/meta')).json());
    expect(body).toContain('turnstile-site');
    for (const secret of ['google-id', 'google-secret', 'turnstile-secret']) {
      expect(body).not.toContain(secret);
    }
  });

  it('reports instance AI capabilities', async () => {
    mocks.ai.draft = true;
    mocks.ai.answers = true;
    const body = (await (await app.request('/meta')).json()) as { data: { ai: { draft: boolean; answers: boolean } } };

    expect(body.data.ai).toEqual({ draft: true, answers: true });
  });
});
