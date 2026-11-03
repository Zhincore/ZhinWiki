import { eraseProjectOrganization, TenantErasureProjectNotFoundError, TenantUsageDeletionPendingError } from '@nibleaf/auth/tenant-erasure';
import { wikiSlugUnavailable } from '@nibleaf/auth/wiki-slugs';
import { assignDefaultUsagePlan, type Prisma, prisma } from '@nibleaf/database';
import { addonDefinitions, defaultProjectAddonProvisioning, projectConfigWithAddons } from '@nibleaf/shared/addons';
import { MemberRole } from '@nibleaf/shared/constants';
import { acceptsOutsideContributions, effectiveWikiRole, platformWikiGrant } from '@nibleaf/shared/rbac';
import { THEME_PRESETS, THEME_SCHEMA_VERSION } from '@nibleaf/shared/themes';
import { slugify } from '@nibleaf/shared/utils';
import { isReservedWikiSlug, nextPreviousSlugs } from '@nibleaf/shared/wiki-paths';
import type { CreateProjectBody, ProjectConfigUpdate, UpdateProjectBody } from '@nibleaf/validators';
import { env } from '@/env';
import { badRequest, conflict, notFound } from '@/errors';
import { mutateProjectConfig } from './project-config';

const MAX_PROJECT_SLUG_LENGTH = 63;
const isPlainObject = (value: unknown): value is Record<string, unknown> => Object.prototype.toString.call(value) === '[object Object]';

/** Every new site starts on the curated default preset instead of the legacy
 *  accent-only palette: storing a versioned `theme` object opts the project
 *  into the theme resolver (no legacy branch in the reader). Existing projects
 *  without a `theme` keep their palette. Mirrors `createStarterProject` in
 *  @nibleaf/auth, which seeds the sign-up starter site the same way. */
const starterThemeConfig = () => ({ version: THEME_SCHEMA_VERSION, preset: 'harbor' as const, metadata: THEME_PRESETS.harbor.metadata });

/** What "pages" means wherever a site's page count is shown (workspace
 *  overview, sites list, MCP): content pages — not navigation groups — on the
 *  default branch, across all languages. The same set the Site Overview counts. */
const contentPagesWhere: Prisma.PageWhereInput = { kind: 'PAGE', branch: { isDefault: true } };

/** Throw unless the project exists and belongs to the organization. Returns it. */
export const assertProjectInOrg = async (organizationId: string, projectId: string) => {
  const project = await prisma.project.findFirst({ where: { id: projectId, organizationId } });
  if (!project) {
    throw notFound('project', { id: projectId });
  }
  return project;
};

/** The user's effective role in an organization: membership or a platform-role
 *  grant (shared tenancy only), whichever ranks higher; null when neither applies. */
export const resolveWikiRole = async (userId: string, organizationId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, members: { where: { organizationId }, select: { role: true } } },
  });
  return effectiveWikiRole(env.TENANCY, user?.members[0]?.role, user?.role);
};

/**
 * Resolve a project's own organization and the user's effective role in it.
 * Because each site owns its org (1:1), this IS the per-site access check:
 * membership in the project's org, or a platform role that grants wiki rights,
 * = access to the site. Throws notFound (not forbidden) otherwise so we never
 * leak that a site exists.
 */
export const assertProjectAccess = async (userId: string, projectId: string) => {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    throw notFound('project', { id: projectId });
  }
  const role = await resolveWikiRole(userId, project.organizationId);
  if (!role) {
    throw notFound('project', { id: projectId });
  }
  return { project, organizationId: project.organizationId, role };
};

/** Access to a project: an effective wiki role, or `contributor` for a
 *  signed-in non-member on a wiki that accepts outside change requests. */
export type ProjectViewer =
  | { organizationId: string; role: MemberRole; contributor: false }
  | { organizationId: string; role: null; contributor: true };

/** Resolve the caller's access to a project; notFound when they have none. */
export const resolveProjectViewer = async (userId: string, projectId: string): Promise<ProjectViewer> => {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { organizationId: true, config: true, accessMode: true, takedownAt: true },
  });
  if (!project) {
    throw notFound('project', { id: projectId });
  }
  const role = await resolveWikiRole(userId, project.organizationId);
  if (role) {
    return { organizationId: project.organizationId, role, contributor: false };
  }
  const open =
    acceptsOutsideContributions(env.TENANCY, { ...project, published: true }) &&
    (await prisma.deployment.count({ where: { projectId, status: 'READY' } })) > 0;
  if (!open) {
    throw notFound('project', { id: projectId });
  }
  return { organizationId: project.organizationId, role: null, contributor: true };
};

/** What a contributor sees of a project: its name and the typography the editor renders with. */
export const getContributorProject = async (id: string) => {
  const project = await prisma.project.findUniqueOrThrow({ where: { id }, select: { id: true, name: true, slug: true, icon: true, config: true } });
  const typography = (project.config as { typography?: unknown } | null)?.typography;
  return { ...project, config: typography === undefined ? {} : { typography } };
};

const candidateSlug = (base: string, index: number) => {
  if (index === 0) {
    return base.slice(0, MAX_PROJECT_SLUG_LENGTH).replace(/-+$/g, '') || 'docs';
  }
  const suffix = `-${index + 1}`;
  return `${base.slice(0, MAX_PROJECT_SLUG_LENGTH - suffix.length).replace(/-+$/g, '') || 'docs'}${suffix}`;
};

const uniqueProjectSlug = async (desired: string) => {
  const base = slugify(desired) || 'docs';
  for (let i = 0; i < 100; i++) {
    const candidate = candidateSlug(base, i);
    if (!(await wikiSlugUnavailable(candidate, env.TENANCY))) {
      return candidate;
    }
  }
  const suffix = `-${Date.now().toString(36)}`;
  return `${base.slice(0, MAX_PROJECT_SLUG_LENGTH - suffix.length).replace(/-+$/g, '') || 'docs'}${suffix}`;
};

/** The user's platform role and wiki memberships (organization id → member role). */
const wikiAccess = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, members: { select: { organizationId: true, role: true } } },
  });
  return { platformRole: user?.role ?? null, memberships: new Map(user?.members.map((m) => [m.organizationId, m.role]) ?? []) };
};

const reachableWhere = ({ platformRole, memberships }: Awaited<ReturnType<typeof wikiAccess>>): Prisma.ProjectWhereInput =>
  platformWikiGrant(env.TENANCY, platformRole) ? {} : { organizationId: { in: [...memberships.keys()] } };

/** Projects the user reaches with an effective role: every wiki when their
 *  platform role grants wiki rights, otherwise the wikis they are a member of. */
export const accessibleProjectsWhere = async (userId: string): Promise<Prisma.ProjectWhereInput> => reachableWhere(await wikiAccess(userId));

/** List every site the user can reach with a role, marked with that role. */
export const listProjects = async (userId: string) => {
  const access = await wikiAccess(userId);
  const projects = await prisma.project.findMany({
    where: reachableWhere(access),
    orderBy: { updatedAt: 'desc' },
    include: { _count: { select: { pages: { where: contentPagesWhere }, deployments: true } } },
  });
  return projects.map((project) => ({
    ...project,
    viewerRole: effectiveWikiRole(env.TENANCY, access.memberships.get(project.organizationId), access.platformRole),
  }));
};

/** Wikis the user reaches only as an outside contributor: the `resolveProjectViewer` rule
 *  (shared tenancy, public, published, not taken down, outside contributions on) on wikis
 *  they hold no role in. Only what a contributor sees of a project. */
export const listContributorProjects = async (userId: string) => {
  if (env.TENANCY !== 'shared') return [];
  const access = await wikiAccess(userId);
  if (platformWikiGrant(env.TENANCY, access.platformRole)) return [];
  const projects = await prisma.project.findMany({
    where: {
      accessMode: 'PUBLIC',
      takedownAt: null,
      deployments: { some: { status: 'READY' } },
      organizationId: { notIn: [...access.memberships.keys()] },
    },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    select: { id: true, name: true, slug: true, icon: true, description: true, config: true, accessMode: true, takedownAt: true },
  });
  return projects
    .filter((project) => acceptsOutsideContributions(env.TENANCY, { ...project, published: true }))
    .map(({ id, name, slug, icon, description }) => ({ id, name, slug, icon, description, viewerRole: 'contributor' as const }));
};

export const createProject = async (userId: string, body: CreateProjectBody) => {
  const slug = await uniqueProjectSlug(body.name);
  return prisma.$transaction(async (tx) => {
    // Each site is its own workspace: mint a dedicated organization and make the
    // creator its owner. That org is the site's member boundary (per-site
    // members/roles). Slug is left null to avoid the global org-slug unique.
    const org = await tx.organization.create({ data: { name: body.name } });
    await assignDefaultUsagePlan(tx, org.id);
    await tx.member.create({ data: { organizationId: org.id, userId, role: MemberRole.OWNER } });
    const project = await tx.project.create({
      data: {
        organizationId: org.id,
        name: body.name,
        slug,
        ...(body.description ? { description: body.description } : {}),
        ...(body.icon ? { icon: body.icon } : {}),
        config: projectConfigWithAddons(
          { theme: starterThemeConfig() },
          addonDefinitions.map((definition) => ({ key: definition.id, enabled: definition.defaultEnabled, config: definition.defaultConfig })),
        ) as Prisma.InputJsonValue,
      },
    });
    const defaultAddons = defaultProjectAddonProvisioning(project.id, userId);
    await tx.projectAddon.createMany({
      data: defaultAddons.addons.map((addon) => ({ ...addon, config: addon.config as Prisma.InputJsonValue })),
    });
    await tx.projectAddonAuditEvent.createMany({
      data: defaultAddons.auditEvents.map((event) => ({ ...event, nextConfig: event.nextConfig as Prisma.InputJsonValue })),
    });
    // Every project starts with a single default language that owns its page tree.
    await tx.language.create({
      data: { projectId: project.id, code: 'en', label: 'English', direction: 'LTR', isDefault: true, position: 0 },
    });
    await tx.branch.create({ data: { projectId: project.id, name: 'main', isDefault: true } });
    return project;
  });
};

export const getProject = async (organizationId: string, id: string) => {
  const project = await prisma.project.findFirst({
    where: { id, organizationId },
    include: {
      _count: { select: { pages: { where: contentPagesWhere }, deployments: true, domains: true } },
      languages: { orderBy: [{ position: 'asc' }], include: { projectTranslations: { where: { projectId: id }, take: 1 } } },
    },
  });
  if (!project) {
    throw notFound('project', { id });
  }
  return {
    ...project,
    languages: project.languages.map(({ projectTranslations, ...language }) => ({
      ...language,
      translation: projectTranslations[0] ?? null,
    })),
  };
};

/** Deep-merge an incoming config patch into the existing config, section by section.
 *  Object sections are merged one level deep; arrays (redirects/variables) replace. */
const mergeConfig = (existing: Record<string, unknown>, incoming: ProjectConfigUpdate): Record<string, unknown> => {
  const merged: Record<string, unknown> = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (Array.isArray(value)) {
      merged[key] = value;
    } else if (isPlainObject(value)) {
      const prev = merged[key];
      merged[key] = { ...(isPlainObject(prev) ? prev : {}), ...value };
    } else {
      merged[key] = value;
    }
  }
  return merged;
};

export const updateProject = async (organizationId: string, id: string, body: UpdateProjectBody) => {
  const project = await assertProjectInOrg(organizationId, id);
  const newSlug = body.slug !== undefined && body.slug !== project.slug ? body.slug : undefined;
  if (newSlug !== undefined) {
    if (env.TENANCY === 'shared' && isReservedWikiSlug(newSlug)) {
      throw badRequest('That deployment name is reserved.', { slug: newSlug, reason: 'reserved_slug' });
    }
    if (await wikiSlugUnavailable(newSlug, env.TENANCY, id)) {
      throw conflict('That deployment name is already in use.', { slug: newSlug });
    }
  }
  // Shared tenancy serves wikis at `/<slug>`; the old slug keeps redirecting.
  const previousSlugs =
    newSlug !== undefined && env.TENANCY === 'shared'
      ? nextPreviousSlugs((project.config as { previousSlugs?: unknown } | null)?.previousSlugs, project.slug, newSlug)
      : undefined;

  const projectData = {
    ...(body.name === undefined ? {} : { name: body.name }),
    ...(body.slug === undefined ? {} : { slug: body.slug }),
    ...(body.description === undefined ? {} : { description: body.description }),
    ...(body.icon === undefined ? {} : { icon: body.icon }),
  };

  const config = body.config;
  if (config === undefined && previousSlugs === undefined) {
    return prisma.project.update({ where: { id }, data: projectData });
  }

  return prisma.$transaction(async (tx) => {
    if (Object.keys(projectData).length > 0) {
      await tx.project.update({ where: { id }, data: projectData });
    }
    await mutateProjectConfig(tx, organizationId, id, (current) => ({
      ...(config === undefined ? current : mergeConfig(current, config)),
      ...(previousSlugs === undefined ? {} : { previousSlugs }),
    }));
    const updated = await tx.project.findFirst({ where: { id, organizationId } });
    if (!updated) throw notFound('project', { id });
    return updated;
  });
};

export const deleteProject = async (organizationId: string, id: string) => {
  await assertProjectInOrg(organizationId, id);
  try {
    await eraseProjectOrganization(organizationId, id);
  } catch (error) {
    if (error instanceof TenantUsageDeletionPendingError) {
      throw conflict('Usage ingestion is still draining. Retry project deletion.', { reason: 'usage_ingestion_pending' });
    }
    if (error instanceof TenantErasureProjectNotFoundError) throw notFound('project', { id });
    throw error;
  }
  return { id };
};
