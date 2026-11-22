import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { emailOTP } from 'better-auth/plugins';
import { describe, expect, it } from 'vitest';
import { enforceDisplayName } from './display-name';

const ORIGIN = 'http://localhost:3000';
const EMAIL = 'synthetic@example.test';

function authFixture() {
  const otps: string[] = [];
  const auth = betterAuth({
    secret: 'synthetic-display-name-secret-at-least-32-characters',
    baseURL: ORIGIN,
    database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
    logger: { disabled: true },
    hooks: { before: enforceDisplayName },
    plugins: [emailOTP({ sendVerificationOTP: async ({ otp }) => void otps.push(otp) })],
  });
  return { auth, otps };
}

function post(path: string, body: Record<string, unknown>) {
  return new Request(`${ORIGIN}/api/auth${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify(body),
  });
}

async function requestOtp(auth: ReturnType<typeof authFixture>['auth'], otps: string[]) {
  const response = await auth.handler(post('/email-otp/send-verification-otp', { email: EMAIL, type: 'sign-in' }));
  expect(response.status).toBe(200);
  const otp = otps.at(-1);
  if (!otp) throw new Error('OTP was not issued');
  return otp;
}

describe('enforceDisplayName', () => {
  it.each(['', '   ', 'x'.repeat(65)])('rejects the sign-up name %j before the code is checked', async (name) => {
    const { auth } = authFixture();
    const response = await auth.handler(post('/sign-in/email-otp', { email: EMAIL, otp: '000000', name }));
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('INVALID_NAME');
  });

  it('rejects an over-long name on profile updates', async () => {
    const { auth } = authFixture();
    const response = await auth.handler(post('/update-user', { name: 'x'.repeat(65) }));
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('INVALID_NAME');
  });

  it('stores the trimmed name on sign-up and accepts the maximum length', async () => {
    const { auth, otps } = authFixture();
    const otp = await requestOtp(auth, otps);
    const name = `  ${'y'.repeat(64)}  `;
    const response = await auth.handler(post('/sign-in/email-otp', { email: EMAIL, otp, name }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { user: { name: string } };
    expect(body.user.name).toBe('y'.repeat(64));
  });

  it('leaves requests without a name alone', async () => {
    const { auth } = authFixture();
    const response = await auth.handler(post('/update-user', { image: null }));
    expect(response.status).toBe(401);
  });
});
