# How ZhinWiki differs from Nibleaf

Behaviour that exists only in this fork. Naming and branch rules:
[BRANDING.md](BRANDING.md); PR rules: [AGENTS.md](AGENTS.md); operator docs:
[`docs/`](docs/README.md).

## Summary

- **Tenancy modes**: `TENANCY=shared|independent`, platform `editor` role,
  contributors ([#63](https://github.com/Zhincore/ZhinWiki/pull/63),
  [#64](https://github.com/Zhincore/ZhinWiki/pull/64),
  [#65](https://github.com/Zhincore/ZhinWiki/pull/65),
  [#67](https://github.com/Zhincore/ZhinWiki/pull/67)).
- **Wiki slug paths**: published wikis at `/<slug>` in shared mode
  ([#69](https://github.com/Zhincore/ZhinWiki/pull/69)).
- **Change requests**: docs versions dropped, `main` read-only, edits merged
  through change requests ([#70](https://github.com/Zhincore/ZhinWiki/pull/70),
  [#71](https://github.com/Zhincore/ZhinWiki/pull/71)); reviews, merge gate,
  outside contributors, notifications
  ([#79](https://github.com/Zhincore/ZhinWiki/pull/79)).
- **Runtime branding**: `APP_NAME`, `BRAND_*` from env, ZhinWiki default
  ([#10](https://github.com/Zhincore/ZhinWiki/pull/10),
  [#11](https://github.com/Zhincore/ZhinWiki/pull/11),
  [#12](https://github.com/Zhincore/ZhinWiki/pull/12),
  [#27](https://github.com/Zhincore/ZhinWiki/pull/27),
  [#48](https://github.com/Zhincore/ZhinWiki/pull/48),
  [#57](https://github.com/Zhincore/ZhinWiki/pull/57),
  [#58](https://github.com/Zhincore/ZhinWiki/pull/58)).
- **Homepage**: `HOMEPAGE` picks welcome page, app, or one wiki
  ([#13](https://github.com/Zhincore/ZhinWiki/pull/13)).
- **No marketing or Cloud**: welcome, terms and privacy pages replace the
  marketing site; Cloud wording and the Plan tab are gone
  ([#19](https://github.com/Zhincore/ZhinWiki/pull/19),
  [#20](https://github.com/Zhincore/ZhinWiki/pull/20),
  [#41](https://github.com/Zhincore/ZhinWiki/pull/41),
  [#59](https://github.com/Zhincore/ZhinWiki/pull/59),
  [#60](https://github.com/Zhincore/ZhinWiki/pull/60)).
- **Releases**: own GHCR image and release assets, no one-line installer
  ([#33](https://github.com/Zhincore/ZhinWiki/pull/33)).
- **Upstream syncs**: v0.2.0 ([#73](https://github.com/Zhincore/ZhinWiki/pull/73),
  [#74](https://github.com/Zhincore/ZhinWiki/pull/74)).

## Tenancy modes

`TENANCY` (read at boot; an invalid value stops server and app). Each wiki
owns one organization, as upstream.

| | `independent` | `shared` |
| --- | --- | --- |
| Sign-up | Workspace + starter wiki | Account only |
| Who creates wikis | Any signed-in user | Platform admins |
| Platform `admin` | No wiki rights beyond memberships | Wiki-admin on every wiki |
| Platform `editor` | Nothing | Member on every wiki |
| Account deletion | Erases wikis where the user is sole member | Refused (`SOLE_WIKI_OWNER`) while sole member |
| Published wiki URL | `/sites/<id>` | `/<slug>`; `/sites/<id>` 301s there |

- Defaults: code, `.env.example`, `docker-compose.yml` → `independent` (demo
  seed needs it); `.env.production.example`, `docker-compose.prod.yml`,
  `docker-compose.coolify.yml` → `shared`.
- Switching modes is not retroactive.
- Enforced on the server (`canCreateWiki` in `packages/shared/src/rbac.ts`,
  `canCreateProject` guard, better-auth org creation gate); the UI only hides
  create actions.
- Wiki creator becomes owner; dashboard-created wikis start empty. Up to 100
  members per wiki (better-auth `membershipLimit`).
- **Contributors** (shared): role `user` without membership; read public
  wikis, join by invitation. There is no contributor member role: any
  membership exposes drafts, change requests and private sites. They may open
  change requests on wikis that accept outside contributions (see below).

## Platform roles

`user.role` (comma-separated for several; highest grant wins), separate from
wiki member roles: `user` (default), `admin`
(operator console; wiki rights per table above, never ownership transfer),
`editor` (per table above; not an admin-panel role, cannot create wikis).
Effective wiki role = max(membership, platform grant) (`effectiveWikiRole`);
cross-wiki lists use `accessibleProjectsWhere`
(`apps/server/src/actions/projects.ts`).

```bash
# admin, Docker image
docker compose exec server pnpm --filter @nibleaf/server exec tsx src/scripts/grant-admin.ts you@example.com
# admin, source checkout
pnpm --filter @nibleaf/server with-env tsx src/scripts/grant-admin.ts you@example.com
# revoke: append "user"
```

`editor` is SQL only: `UPDATE "user" SET role = 'editor' WHERE email = '…';`.
Without an admin, nobody can create wikis in shared mode.

## Wiki slug paths

Shared mode only (`WIKI_SLUG_PATHS`, `apps/app/src/server.ts`).

- A valid unreserved first segment resolves via
  `GET /api/public/sites/resolve?slug=` (cached 30 s, misses too: renames and
  new wikis route within 30 s) and is served as that wiki. A previous slug 301s
  to the current one; public `/sites/<id>/*` 301s to `/<slug>/*`.
- Order: legal redirects → `/<slug>` → `HOMEPAGE=site` → `/sites/<id>`. The
  home wiki's slug and `/sites/<home id>` 301 to `/`.
- Previous slugs: `project.config.previousSlugs` (newest first, max 10), set
  only by slug updates; another wiki cannot take one
  (`packages/auth/src/wiki-slugs.ts`).
- Reserved slugs: `DASHBOARD_ROOT_SEGMENTS` ∪ `APP_OWNED_ROOT_SEGMENTS`
  (`packages/shared/src/wiki-paths.ts`); a test fails when a new top-level
  route is missing. Existing clashes are logged at API boot and stay at
  `/sites/<id>`.

## Change requests

No docs versions: only the default branch (`main`) is published. Every other
branch stores one change request (CR), reviewed and merged back.

- Status `DRAFT | IN_REVIEW | MERGED | ARCHIVED`; per-project `number`. The
  record outlives its branch.
- Invariant: one CR per non-default branch. `createBranch` creates both;
  deleting a branch archives its CR. Import replacement branches (`import-*`)
  have none; Mintlify versions import as draft CRs; the migration turned
  existing branches into draft CRs.
- `main` is read-only: page writes answer 409 `pages:main_read_only`, and
  `pages:branch_read_only` on merged/archived CRs or import branches. System
  writers (import, Git sync, merge, starter) bypass this. Settings, themes,
  languages and domains stay editable on `main`.
- Merge (`apps/server/src/actions/change-request-merge.ts`): per page, against
  the fork-time base. Conflicts (`BOTH_CHANGED`, `DELETED_IN_BRANCH`,
  `DELETED_ON_MAIN`) → 409 with `conflicts`; `force: [pageId…]` lets the CR
  win on those pages. CRs without a fork base (migrated) replace `main`
  wholesale; wholesale replacement is refused while tracked CRs are open.
- API: `/projects/:projectId/change-requests` (list, create, get, patch,
  `/:number/merge`, `/:number/pages/:pageId/diff`), member role;
  `/reviewer-candidates`, `/:number/reviewers`, `/:number/reviews` member-only.
- Reviews (`change-request-reviews.ts`): a reviewer's latest approval or
  changes-requested since being added is their verdict; page writes make older
  approvals stale. Reviewers need review rights (membership or platform
  grant). Merge answers 409 `change_requests:review_required` until approvals
  reach `config.changeRequests.requiredApprovals` (default 1, 0 disables) and
  nobody requests changes. Self-approval counts; review writes take the merge
  lock.
- Outside contributors: `requireProjectViewer` admits non-members when
  `acceptsOutsideContributions` (`rbac.ts`: shared tenancy, published, public,
  not taken down, `config.changeRequests.outsideContributions` not `false`).
  Only project get, languages, page list/get/writes (own open CR) and CR
  list/create/get/diff/patch (own) use it; max 5 open CRs (429
  `change_requests:open_limit`). The published page shows **Suggest changes**
  (`contributeUrl`). No API keys, so no MCP. Known gap: their content loads
  remote images in members' sessions.
- Notifications (`change-request-notifications.ts`): in-app plus email for
  review requests, verdicts and merges (never the actor or suspended users);
  workspace toggles `change_request_review_requested`,
  `change_request_reviewed`, `change_request_merged`.
- UI: **Edit** on `main` opens a CR; `?cr=<n>` binds the editor; list at
  `/app/projects/:id/changes`, CR at `/changes/:n`.
- Public output (`buildSnapshot`, publish, served snapshots) reads only `main`;
  exports and the MCP `versions` resource still list CR branches.

## Branding

- Default brand ZhinWiki (`packages/shared/src/brand.ts`); `APP_NAME` and
  `BRAND_*` override at runtime. See [Brand your instance](docs/self-hosting/branding.mdx).
- `HOMEPAGE` (`apps/app/src/lib/homepage.ts`): welcome page, app, or one
  published site.

## Upgrading from v0.1.0

See [backups and upgrades](docs/self-hosting/backups-upgrades.mdx#from-v010):
`TENANCY` default, change request and invitation migrations, duplicate-account
check, `OPENROUTER_API_KEY`, `erasure` queue. The upstream two-step BullMQ
upgrade does not apply: ZhinWiki v0.1.0 already runs BullMQ 6.

## Where fork code lives

- Tenancy: `packages/auth/src/tenancy.ts`,
  `apps/server/src/middlewares/guard/can-create-project.ts`,
  `apps/app/src/functions/tenancy.ts`, `apps/app/src/hooks/use-tenancy.ts`,
  `apps/app/src/components/app/empty-wikis.tsx`.
- Brand: `packages/shared/src/brand.ts`, `apps/app/src/lib/brand.ts`,
  `apps/app/src/components/welcome-page.tsx`.
- Change requests:
  `apps/server/src/actions/change-request{s,-merge,-reviews,-notifications}.ts`,
  `apps/app/src/components/project-settings/change-requests-section.tsx`,
  `apps/server/src/modules/app/change-requests/`,
  `apps/app/src/components/change-requests/`, `apps/app/src/lib/block-diff.ts`,
  `apps/app/src/routes/app/projects/$projectId/changes.*.tsx`.
- Upstream files with fork edits: `packages/auth/src/keys.server.ts`,
  `packages/auth/src/account-deletion.ts`, `packages/shared/src/rbac.ts`,
  `packages/design-system/src/brand/`, `apps/server/src/actions/branches.ts`,
  `packages/shared/src/site.ts`, `apps/server/src/middlewares/guard/index.ts`
  (`requireProjectViewer`), `apps/server/src/actions/sites.ts`
  (`contributeUrl`).

## Merging upstream: watch for

- `packages/auth/src/server.ts`: `organization()` options and the
  `user.create.after` hook go through `tenancy.ts`.
- New org-creation paths (server, MCP, worker) respect `canCreateWiki`.
- New permission checks use `effectiveWikiRole`; new cross-wiki lists use
  `accessibleProjectsWhere`.
- Create gates: `__root.tsx` loader, dashboard, `sites.tsx`, site switcher.
- `account-deletion.ts` error codes; `schema.prisma` `User.role` comment;
  `projects` route guard list.
- New env vars: `.env.example`, `.env.production.example`, compose
  `x-service-env`; keep `TENANCY` defaults; run `pnpm release:check`.
- i18n: all 12 catalogs and `message-ids.ts`; no "Nibleaf" in user copy.
- Dropped pages, tests, Cloud wording and upstream release guides stay out.
- Handlers behind `requireProjectViewer` check `isContextContributor()`
  before writing.
- New page writers or branch creators keep the CR invariant (`createBranch`);
  non-default branches never reach public output.
