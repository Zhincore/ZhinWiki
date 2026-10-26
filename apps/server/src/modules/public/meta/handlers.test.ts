import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HonoEnv } from '@/lib/hono/context';

const mocks = vi.hoisted(() => ({
  ai: { draft: false, answers: false },
  extras: { DISABLE_SIGNUP: false },
}));

vi.mock('@nibleaf/auth/providers', () => ({ googleOAuthEnabled: () => true }));
vi.mock('@/env', () => ({ env: {} }));
vi.mock('@/actions/ai', () => ({ aiDraftAvailable: () => mocks.ai.draft }));
vi.mock('@/lib/ai-search/runtime', () => ({ answerSearchAvailable: () => mocks.ai.answers }));
vi.mock('@/lib/env-extras', () => ({ envExtras: mocks.extras }));

import handlers from './handlers';

const app = new Hono<HonoEnv>().route('/meta', handlers);

describe('public instance metadata', () => {
  beforeEach(() => {
    mocks.ai.draft = false;
    mocks.ai.answers = false;
    mocks.extras.DISABLE_SIGNUP = false;
  });

  it('reports providers and sign-up policy', async () => {
    const response = await app.request('/meta');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: {
        ai: { draft: false, answers: false },
        providers: { google: true },
        signupDisabled: false,
      },
    });
  });

  it('never exposes OAuth credentials', async () => {
    const body = JSON.stringify(await (await app.request('/meta')).json());
    expect(body).not.toContain('clientSecret');
    expect(body).not.toContain('clientId');
  });

  it('reports instance AI capabilities', async () => {
    mocks.ai.draft = true;
    mocks.ai.answers = true;
    const body = (await (await app.request('/meta')).json()) as { data: { ai: { draft: boolean; answers: boolean } } };

    expect(body.data.ai).toEqual({ draft: true, answers: true });
  });
});
