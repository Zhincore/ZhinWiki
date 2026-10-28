import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { emailOTP, organization } from 'better-auth/plugins';
import { describe, expect, it, vi } from 'vitest';
import { onUserCreated, organizationTenancyOptions } from './tenancy';

const signUpAndCreateOrg = async (tenancy: 'single' | 'multi') => {
  const data: Record<string, Record<string, unknown>[]> = {
    user: [],
    session: [],
    account: [],
    verification: [],
    organization: [],
    member: [],
    invitation: [],
  };
  const provision = vi.fn(async () => undefined);
  const logSignup = vi.fn(async () => undefined);
  const handleUserCreated = onUserCreated(tenancy, { provision, logSignup });
  let otp = '';
  const auth = betterAuth({
    secret: 'synthetic-tenancy-secret-at-least-32-characters',
    baseURL: 'http://localhost:3000',
    database: memoryAdapter(data),
    databaseHooks: { user: { create: { after: (user) => handleUserCreated(user) } } },
    plugins: [
      emailOTP({
        async sendVerificationOTP(request) {
          otp = request.otp;
        },
      }),
      organization(organizationTenancyOptions(tenancy)),
    ],
  });
  const email = 'synthetic@example.test';
  await auth.api.sendVerificationOTP({ body: { email, type: 'sign-in' } });
  const signIn = await auth.api.signInEmailOTP({ body: { email, otp }, asResponse: true });
  const headers = new Headers({
    cookie: signIn.headers
      .getSetCookie()
      .map((cookie) => cookie.split(';')[0])
      .join('; '),
  });
  const create = await auth.api.createOrganization({ body: { name: 'Wiki', slug: 'wiki' }, headers, asResponse: true });
  return { provision, logSignup, createStatus: create.status, organizations: data.organization };
};

describe('installed Better Auth tenancy contract', () => {
  it('provisions a workspace on sign-up and allows org creation in multi tenancy', async () => {
    const result = await signUpAndCreateOrg('multi');
    expect(result.provision).toHaveBeenCalledOnce();
    expect(result.logSignup).not.toHaveBeenCalled();
    expect(result.createStatus).toBe(200);
    expect(result.organizations).toHaveLength(1);
  });

  it('provisions nothing on sign-up and forbids org creation in single tenancy', async () => {
    const result = await signUpAndCreateOrg('single');
    expect(result.provision).not.toHaveBeenCalled();
    expect(result.logSignup).toHaveBeenCalledOnce();
    expect(result.createStatus).toBe(403);
    expect(result.organizations).toHaveLength(0);
  });
});
