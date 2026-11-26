import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { admin } from 'better-auth/plugins';
import { serializeSignedCookie } from 'better-call';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  memberFindMany: vi.fn(),
  transaction: vi.fn(),
  eraseProjectOrganization: vi.fn(),
  eraseContributions: vi.fn(),
}));

vi.mock('@nibleaf/database', () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique },
    member: { findMany: mocks.memberFindMany },
    platformEvent: { deleteMany: vi.fn() },
    notification: { deleteMany: vi.fn() },
    $transaction: mocks.transaction,
  },
}));
vi.mock('./tenant-erasure', () => ({
  eraseProjectOrganization: mocks.eraseProjectOrganization,
  TenantUsageDeletionPendingError: class extends Error {},
}));

import { adminUserRemoval, setContributionErasure } from './account-deletion';

const ORIGIN = 'http://localhost:3000';
const SECRET = 'synthetic-admin-removal-secret-at-least-32-characters';
const now = new Date();

const userRow = (id: string, role: string) => ({
  id,
  name: id,
  email: `${id}@example.test`,
  emailVerified: true,
  role,
  createdAt: now,
  updatedAt: now,
});
const membership = (members: number) => [{ role: 'owner', organization: { id: 'org-a', name: 'A', projects: [], _count: { members } } }];

async function fixture() {
  const db = {
    user: [userRow('admin-1', 'admin'), userRow('user-1', 'user'), userRow('user-2', 'user')],
    session: [],
    account: [],
    verification: [],
  };
  const auth = betterAuth({
    secret: SECRET,
    baseURL: ORIGIN,
    database: memoryAdapter(db),
    logger: { disabled: true },
    plugins: [admin({ adminRoles: ['admin'], defaultRole: 'user' }), adminUserRemoval('independent')],
  });
  const context = await auth.$context;
  const cookieFor = async (userId: string) => {
    const session = await context.internalAdapter.createSession(userId);
    const cookie = await serializeSignedCookie(context.authCookies.sessionToken.name, session.token, SECRET);
    return cookie.split(';')[0] ?? '';
  };
  const remove = async (as: string, userId: string) =>
    auth.handler(
      new Request(`${ORIGIN}/api/auth/admin/remove-user`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ORIGIN, cookie: await cookieFor(as) },
        body: JSON.stringify({ userId }),
      }),
    );
  return { db, remove };
}

describe('admin user removal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setContributionErasure(mocks.eraseContributions);
    mocks.eraseContributions.mockResolvedValue(undefined);
    mocks.eraseProjectOrganization.mockResolvedValue(undefined);
    mocks.transaction.mockResolvedValue([]);
    mocks.userFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({ id: where.id, name: where.id }));
    mocks.memberFindMany.mockResolvedValue(membership(1));
  });

  it('runs account deletion preparation before removing the user', async () => {
    const { db, remove } = await fixture();

    const response = await remove('admin-1', 'user-1');

    expect(response.status).toBe(200);
    expect(mocks.eraseProjectOrganization).toHaveBeenCalledWith('org-a');
    expect(mocks.eraseContributions).toHaveBeenCalledWith({ id: 'user-1', name: 'user-1' });
    expect(db.user.map((row) => row.id)).not.toContain('user-1');
  });

  it('keeps the user when preparation refuses the deletion', async () => {
    mocks.memberFindMany.mockResolvedValue(membership(2));
    const { db, remove } = await fixture();

    const response = await remove('admin-1', 'user-1');

    expect(response.status).toBe(409);
    expect(mocks.eraseProjectOrganization).not.toHaveBeenCalled();
    expect(db.user.map((row) => row.id)).toContain('user-1');
  });

  it('does not erase anything for a non-admin caller', async () => {
    const { db, remove } = await fixture();

    const response = await remove('user-2', 'user-1');

    expect(response.status).toBe(403);
    expect(mocks.eraseProjectOrganization).not.toHaveBeenCalled();
    expect(db.user.map((row) => row.id)).toContain('user-1');
  });

  it('does not erase anything when an admin targets themselves', async () => {
    const { remove } = await fixture();

    const response = await remove('admin-1', 'admin-1');

    expect(response.status).toBe(400);
    expect(mocks.eraseProjectOrganization).not.toHaveBeenCalled();
  });
});
