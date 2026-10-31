import { MemberRole, PlatformRole } from './constants';

export type Tenancy = 'shared' | 'independent';

/** Higher rank = more privilege. Unknown roles rank lowest. */
const ROLE_RANK = new Map<string, number>([
  [MemberRole.MEMBER, 1],
  [MemberRole.ADMIN, 2],
  [MemberRole.OWNER, 3],
]);

export const rankOf = (role: string): number => ROLE_RANK.get(role) ?? 0;

/** Wiki role a platform role grants on every wiki in shared tenancy. */
const PLATFORM_WIKI_GRANT = new Map<string, MemberRole>([
  [PlatformRole.ADMIN, MemberRole.ADMIN],
  [PlatformRole.EDITOR, MemberRole.MEMBER],
]);

/** Wiki role the platform role grants on every wiki; null in independent
 *  tenancy, where only memberships count. */
export const platformWikiGrant = (tenancy: Tenancy, platformRole: string | null | undefined): MemberRole | null =>
  (tenancy === 'shared' && platformRole && PLATFORM_WIKI_GRANT.get(platformRole)) || null;

/** Effective wiki role: the higher of the membership role and the platform
 *  role's grant. null when the user has neither. */
export const effectiveWikiRole = (
  membershipRole: string | null | undefined,
  platformRole: string | null | undefined,
  tenancy: Tenancy,
): MemberRole | null => {
  const granted = platformWikiGrant(tenancy, platformRole);
  const member = membershipRole as MemberRole | null | undefined;
  if (!member) {
    return granted;
  }
  return granted && rankOf(granted) > rankOf(member) ? granted : member;
};

/** Who may create a wiki: anyone signed in on an independent instance, only
 *  platform admins on a shared one. */
export const canCreateWiki = (tenancy: Tenancy, platformRole?: string | null): boolean =>
  tenancy === 'independent' || platformRole === PlatformRole.ADMIN;

/** Whether `role` is at least as privileged as `required`. */
export const roleAtLeast = (role: string, required: MemberRole): boolean => rankOf(role) >= rankOf(required);

/** Roles allowed to edit documentation content. */
export const canEdit = (role: string): boolean => roleAtLeast(role, MemberRole.MEMBER);

/** Roles allowed to manage members, billing, domains, and danger-zone actions. */
export const canAdminister = (role: string): boolean => roleAtLeast(role, MemberRole.ADMIN);

/** Export policy constants are shared so API guards and permission tests cannot
 * drift: editors may create/cancel runs; only admins may manage schedules. */
export const EXPORT_CREATE_ROLE = MemberRole.MEMBER;
export const EXPORT_SCHEDULE_ROLE = MemberRole.ADMIN;

/** The roles that can be granted through invites and role changes. `owner` is
 *  deliberately absent: a workspace has exactly ONE owner, and ownership moves
 *  only through the explicit transfer-ownership flow (never by assigning the
 *  role directly). */
export const ASSIGNABLE_MEMBER_ROLES = [MemberRole.ADMIN, MemberRole.MEMBER] as const;
export type AssignableMemberRole = (typeof ASSIGNABLE_MEMBER_ROLES)[number];

/** Whether an actor may GRANT `targetRole` to someone. Two rules:
 *  1. `owner` is NEVER assignable — not even by the owner. Ownership changes
 *     hands only via the transfer-ownership flow, which atomically demotes the
 *     previous owner so exactly one owner exists at all times.
 *  2. Otherwise you can never grant a role more privileged than your own — so
 *     a member cannot mint admins. */
export const canAssignRole = (actorRole: string, targetRole: string): boolean =>
  targetRole !== MemberRole.OWNER && rankOf(actorRole) >= rankOf(targetRole);

/** Whether an actor may manage (change role of / remove) a member who currently
 *  holds `memberRole`. You cannot act on someone ranked above you; managing an
 *  owner therefore requires being an owner. */
export const canManageMember = (actorRole: string, memberRole: string): boolean => rankOf(actorRole) >= rankOf(memberRole);

// ─── Ownership transfer ──────────────────────────────────────────────────────

export type OwnershipTransferRejection =
  | 'actor_not_found'
  | 'actor_not_owner'
  | 'target_is_actor'
  | 'target_not_found'
  | 'target_already_owner'
  | 'target_not_admin';

/** `demote` → every current owner becomes admin; `promote` → the target becomes owner. */
export type OwnershipTransferPlan = { ok: true; demote: string[]; promote: string } | { ok: false; reason: OwnershipTransferRejection };

/**
 * Pure decision logic for transferring workspace ownership. The invariant it
 * encodes: a workspace has exactly ONE owner. A transfer is only valid from
 * the current owner to an existing ADMIN, and the resulting plan demotes
 * EVERY current owner to admin (the actor, plus any extra owners left behind
 * by legacy data from before the single-owner rule) before promoting the
 * target — so the ending state is always exactly one owner.
 */
export const planOwnershipTransfer = (
  members: ReadonlyArray<{ id: string; role: string }>,
  actorMemberId: string,
  targetMemberId: string,
): OwnershipTransferPlan => {
  const actor = members.find((member) => member.id === actorMemberId);
  if (!actor) {
    return { ok: false, reason: 'actor_not_found' };
  }
  if (actor.role !== MemberRole.OWNER) {
    return { ok: false, reason: 'actor_not_owner' };
  }
  if (targetMemberId === actorMemberId) {
    return { ok: false, reason: 'target_is_actor' };
  }
  const target = members.find((member) => member.id === targetMemberId);
  if (!target) {
    return { ok: false, reason: 'target_not_found' };
  }
  if (target.role === MemberRole.OWNER) {
    return { ok: false, reason: 'target_already_owner' };
  }
  if (target.role !== MemberRole.ADMIN) {
    return { ok: false, reason: 'target_not_admin' };
  }
  return {
    ok: true,
    demote: members.filter((member) => member.role === MemberRole.OWNER).map((member) => member.id),
    promote: target.id,
  };
};

// ─── Change requests ─────────────────────────────────────────────────────────

/** A wiki's change request policy from `project.config.changeRequests`, with defaults. */
export const changeRequestPolicy = (config: unknown): { requiredApprovals: number; outsideContributions: boolean } => {
  const section = (config as { changeRequests?: { requiredApprovals?: unknown; outsideContributions?: unknown } } | null)?.changeRequests;
  const required = section?.requiredApprovals;
  return {
    requiredApprovals: typeof required === 'number' && Number.isInteger(required) && required >= 0 ? required : 1,
    outsideContributions: section?.outsideContributions !== false,
  };
};

/** Whether signed-in non-members may open change requests on a wiki: shared
 *  tenancy, a published public site that is not taken down, and the wiki's
 *  outside-contributions setting on. */
export const acceptsOutsideContributions = (
  tenancy: Tenancy,
  project: { config: unknown; accessMode: string; takedownAt: Date | null; published: boolean },
): boolean =>
  tenancy === 'shared' &&
  project.accessMode === 'PUBLIC' &&
  !project.takedownAt &&
  project.published &&
  changeRequestPolicy(project.config).outsideContributions;
