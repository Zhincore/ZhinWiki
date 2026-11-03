import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import type { HonoEnv } from '@/lib/hono/context';

vi.mock('@nibleaf/auth/server', () => ({ AUTH_CLIENT_IP_HEADER: 'x-nibleaf-auth-client-ip' }));
vi.mock('@/lib/env-extras', () => ({ envExtras: { TRUSTED_PROXY_HOPS: 1, INTERNAL_API_SECRET: undefined } }));

import { withAuthClientIp } from './auth-client-ip';

const app = new Hono<HonoEnv>().post('/auth/*', async (ctx) => {
  const request = withAuthClientIp(ctx);
  return ctx.json({ ip: request.headers.get('x-nibleaf-auth-client-ip'), body: await request.text() });
});

const call = async (headers: Record<string, string>) => {
  const response = await app.request('/auth/email-otp/send-verification-otp', { method: 'POST', headers, body: '{"email":"ada@example.test"}' });
  return (await response.json()) as { ip: string | null; body: string };
};

describe('withAuthClientIp', () => {
  it('gives Better Auth the client behind a multi-hop chain, keeping the body', async () => {
    // Client as appended by the public edge, then the edge (TRUSTED_PROXY_HOPS=1).
    const result = await call({ 'x-forwarded-for': '198.51.100.7, 203.0.113.9' });
    expect(result).toEqual({ ip: '198.51.100.7', body: '{"email":"ada@example.test"}' });
  });

  it('replaces a client-sent header', async () => {
    const result = await call({ 'x-forwarded-for': '198.51.100.7, 203.0.113.9', 'x-nibleaf-auth-client-ip': '192.0.2.1' });
    expect(result.ip).toBe('198.51.100.7');
  });

  it('drops a client-sent header when no address is known', async () => {
    const result = await call({ 'x-nibleaf-auth-client-ip': '192.0.2.1' });
    expect(result.ip).toBeNull();
  });
});
