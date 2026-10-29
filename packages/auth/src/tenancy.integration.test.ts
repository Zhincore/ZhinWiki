import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { emailOTP, organization } from 'better-auth/plugins';
import { describe, expect, it, vi } from 'vitest';
import { onUserCreated, organizationTenancyOptions } from './tenancy';

const setup = (tenancy: 'single' | 'multi') => {
  type Rows = Record<string, unknown>[];
  const data: Record<'user' | 'session' | 'account' | 'verification' | 'organization' | 'member' | 'invitation', Rows> = {
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
  const handleUserCreated = onUserCreated(tenancy, { provision, logSignup, onLogFailure: vi.fn() });
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
  const signIn = async (email: string) => {
    await auth.api.sendVerificationOTP({ body: { email, type: 'sign-in' } });
    const response = await auth.api.signInEmailOTP({ body: { email, otp }, asResponse: true });
    const headers = new Headers({
      cookie: response.headers
        .getSetCookie()
        .map((cookie) => cookie.split(';')[0])
        .join('; '),
    });
    const userId = data.user.find((user) => user.email === email)?.id as string;
    return { headers, userId };
  };
  return { auth, data, provision, logSignup, signIn };
};

const signUpAndCreateOrg = async (tenancy: 'single' | 'multi') => {
  const { auth, data, provision, logSignup, signIn } = setup(tenancy);
  const { headers } = await signIn('synthetic@example.test');
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

  it('still adds a member on an accepted invitation in single tenancy', async () => {
    const { auth, data, signIn } = setup('single');
    const owner = await signIn('owner@example.test');
    const now = new Date();
    data.organization.push({ id: 'org-1', name: 'Wiki', slug: 'wiki', createdAt: now });
    data.member.push({ id: 'member-1', organizationId: 'org-1', userId: owner.userId, role: 'owner', createdAt: now });
    const invitation = await auth.api.createInvitation({
      body: { organizationId: 'org-1', email: 'editor@example.test', role: 'member' },
      headers: owner.headers,
    });
    const editor = await signIn('editor@example.test');
    await auth.api.acceptInvitation({ body: { invitationId: invitation.id }, headers: editor.headers });
    expect(data.member).toContainEqual(expect.objectContaining({ organizationId: 'org-1', userId: editor.userId, role: 'member' }));
  });
});
