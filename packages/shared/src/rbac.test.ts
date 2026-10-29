import { describe, expect, it } from 'vitest';
import { MemberRole } from './constants';
import {
  ASSIGNABLE_MEMBER_ROLES,
  canAdminister,
  canAssignRole,
  canCreateWiki,
  canEdit,
  canManageMember,
  EXPORT_CREATE_ROLE,
  EXPORT_SCHEDULE_ROLE,
  effectiveWikiRole,
  planOwnershipTransfer,
  rankOf,
  roleAtLeast,
} from './rbac';

describe('rankOf', () => {
  it('orders owner > admin > member > unknown', () => {
    expect(rankOf('owner')).toBeGreaterThan(rankOf('admin'));
    expect(rankOf('admin')).toBeGreaterThan(rankOf('member'));
    expect(rankOf('member')).toBeGreaterThan(rankOf('viewer'));
    expect(rankOf('nonsense')).toBe(0);
    expect(rankOf('constructor')).toBe(0);
  });
});

describe('effectiveWikiRole — max of membership role and platform grant', () => {
  it('gives a platform editor member rights on a wiki they do not belong to in shared tenancy', () => {
    expect(effectiveWikiRole(null, 'editor', 'shared')).toBe(MemberRole.MEMBER);
  });
  it('grants a platform editor nothing in independent tenancy', () => {
    expect(effectiveWikiRole(null, 'editor', 'independent')).toBeNull();
    expect(effectiveWikiRole('admin', 'editor', 'independent')).toBe(MemberRole.ADMIN);
  });
  it('keeps a higher membership role over the editor grant', () => {
    expect(effectiveWikiRole('owner', 'editor', 'shared')).toBe(MemberRole.OWNER);
    expect(effectiveWikiRole('admin', 'editor', 'shared')).toBe(MemberRole.ADMIN);
  });
  it('gives a platform admin wiki-admin rights everywhere in shared tenancy only', () => {
    expect(effectiveWikiRole(null, 'admin', 'shared')).toBe(MemberRole.ADMIN);
    expect(effectiveWikiRole('member', 'admin', 'shared')).toBe(MemberRole.ADMIN);
    expect(effectiveWikiRole('owner', 'admin', 'shared')).toBe(MemberRole.OWNER);
    expect(effectiveWikiRole(null, 'admin', 'independent')).toBeNull();
  });
  it.each(['user', 'constructor', '__proto__', 'toString', null, undefined])(
    'grants no wiki access to a non-member with platform role %s',
    (platformRole) => {
      expect(effectiveWikiRole(null, platformRole, 'shared')).toBeNull();
      expect(effectiveWikiRole(null, platformRole, 'independent')).toBeNull();
    },
  );
  it('keeps the membership role when the platform role grants nothing', () => {
    expect(effectiveWikiRole('member', 'user', 'shared')).toBe(MemberRole.MEMBER);
  });
});

describe('canCreateWiki', () => {
  it.each(['admin', 'editor', 'user', null, undefined])('lets any signed-in user create in independent (role %s)', (role) => {
    expect(canCreateWiki('independent', role)).toBe(true);
  });
  it('lets only platform admins create in shared', () => {
    expect(canCreateWiki('shared', 'admin')).toBe(true);
    for (const role of ['editor', 'user', null, undefined]) {
      expect(canCreateWiki('shared', role)).toBe(false);
    }
  });
});

describe('canAssignRole — owner is never assignable; otherwise never above your own rank', () => {
  it('blocks EVERYONE — including the owner — from granting the owner role', () => {
    expect(canAssignRole('owner', 'owner')).toBe(false);
    expect(canAssignRole('admin', 'owner')).toBe(false);
    expect(canAssignRole('member', 'owner')).toBe(false);
  });
  it('excludes owner from the assignable-roles set', () => {
    expect(ASSIGNABLE_MEMBER_ROLES).not.toContain(MemberRole.OWNER);
  });
  it('lets an owner assign the non-owner roles', () => {
    expect(canAssignRole('owner', 'admin')).toBe(true);
    expect(canAssignRole('owner', 'member')).toBe(true);
  });
  it('lets an admin assign admin and member only', () => {
    expect(canAssignRole('admin', 'admin')).toBe(true);
    expect(canAssignRole('admin', 'member')).toBe(true);
  });
  it('lets a member assign only member', () => {
    expect(canAssignRole('member', 'admin')).toBe(false);
    expect(canAssignRole('member', 'member')).toBe(true);
  });
  it('blocks an unknown actor role from assigning any real role', () => {
    expect(canAssignRole('', 'member')).toBe(false);
  });
});

describe('planOwnershipTransfer — exactly one owner after every valid transfer', () => {
  const owner = { id: 'm-owner', role: 'owner' };
  const admin = { id: 'm-admin', role: 'admin' };
  const editor = { id: 'm-editor', role: 'member' };

  it('swaps roles: target promoted, current owner demoted to admin', () => {
    const plan = planOwnershipTransfer([owner, admin, editor], owner.id, admin.id);
    expect(plan).toEqual({ ok: true, demote: [owner.id], promote: admin.id });
  });
  it('demotes ALL owners when legacy data holds several (ending state = one owner)', () => {
    const legacyOwner = { id: 'm-legacy', role: 'owner' };
    const plan = planOwnershipTransfer([owner, legacyOwner, admin], owner.id, admin.id);
    expect(plan).toEqual({ ok: true, demote: [owner.id, legacyOwner.id], promote: admin.id });
  });
  it('rejects when the actor is not a member', () => {
    expect(planOwnershipTransfer([owner, admin], 'm-ghost', admin.id)).toEqual({ ok: false, reason: 'actor_not_found' });
  });
  it('rejects when the actor is not the owner', () => {
    expect(planOwnershipTransfer([owner, admin, editor], admin.id, editor.id)).toEqual({ ok: false, reason: 'actor_not_owner' });
  });
  it('rejects transferring to yourself', () => {
    expect(planOwnershipTransfer([owner, admin], owner.id, owner.id)).toEqual({ ok: false, reason: 'target_is_actor' });
  });
  it('rejects an unknown target', () => {
    expect(planOwnershipTransfer([owner, admin], owner.id, 'm-ghost')).toEqual({ ok: false, reason: 'target_not_found' });
  });
  it('rejects a target that is already an owner (legacy data)', () => {
    const legacyOwner = { id: 'm-legacy', role: 'owner' };
    expect(planOwnershipTransfer([owner, legacyOwner], owner.id, legacyOwner.id)).toEqual({ ok: false, reason: 'target_already_owner' });
  });
  it('rejects a non-admin target — ownership only transfers to an admin', () => {
    expect(planOwnershipTransfer([owner, admin, editor], owner.id, editor.id)).toEqual({ ok: false, reason: 'target_not_admin' });
  });
});

describe('canManageMember — never act on someone ranked above you', () => {
  it('blocks an admin from managing an owner', () => {
    expect(canManageMember('admin', 'owner')).toBe(false);
  });
  it('lets an owner manage everyone', () => {
    expect(canManageMember('owner', 'owner')).toBe(true);
    expect(canManageMember('owner', 'admin')).toBe(true);
  });
  it('lets an admin manage members and peers', () => {
    expect(canManageMember('admin', 'member')).toBe(true);
    expect(canManageMember('admin', 'admin')).toBe(true);
  });
});

describe('capability helpers', () => {
  it('canEdit requires at least member', () => {
    expect(canEdit('member')).toBe(true);
    expect(canEdit('admin')).toBe(true);
    expect(canEdit('')).toBe(false);
  });
  it('canAdminister requires at least admin', () => {
    expect(canAdminister('member')).toBe(false);
    expect(canAdminister('admin')).toBe(true);
    expect(canAdminister('owner')).toBe(true);
  });
  it('roleAtLeast respects the MemberRole enum', () => {
    expect(roleAtLeast('owner', MemberRole.ADMIN)).toBe(true);
    expect(roleAtLeast('member', MemberRole.ADMIN)).toBe(false);
  });
});

describe('export permissions', () => {
  it('allows editors to create runs but reserves schedules for admins', () => {
    expect(roleAtLeast(MemberRole.MEMBER, EXPORT_CREATE_ROLE)).toBe(true);
    expect(roleAtLeast(MemberRole.MEMBER, EXPORT_SCHEDULE_ROLE)).toBe(false);
    expect(roleAtLeast(MemberRole.ADMIN, EXPORT_SCHEDULE_ROLE)).toBe(true);
    expect(roleAtLeast('viewer', EXPORT_CREATE_ROLE)).toBe(false);
  });
});
