# How ZhinWiki differs from Nibleaf

Developer notes on behaviour that exists only in this fork. Naming and branch
rules are in [BRANDING.md](BRANDING.md), PR rules in
[AGENTS.md](AGENTS.md); operator docs live under [`docs/`](docs/README.md).

## Tenancy modes

`TENANCY` (env, read at boot; an invalid value stops the server and app)
selects how accounts and wikis relate. Each wiki owns its organization (one
team per wiki), as upstream.

- `independent`: each wiki stands alone (upstream behaviour).
- `shared`: all wikis share one community: accounts, global editors, and
  contributors browsing public wikis.

| | `independent` | `shared` (fork default for production) |
| --- | --- | --- |
| Sign-up | Creates a workspace and a starter wiki | Creates an account only |
| Who creates wikis | Any signed-in user | Platform admins only |
| Platform `admin` | No wiki rights beyond memberships | Wiki-admin rights on every wiki |
| Platform `editor` | No wiki rights | Member rights on every wiki |
| Account deletion | Erases wikis where the user is the sole member | Refused (`SOLE_WIKI_OWNER`) while the user is a wiki's sole member |
| Published wiki URL | `/sites/<id>` | `/<slug>` on the app origin; `/sites/<id>` 301s there |

- Code default, `.env.example` and `docker-compose.yml` stay `independent`
  (the demo seed needs it). `.env.production.example`, `docker-compose.prod.yml`
  and `docker-compose.coolify.yml` default to `shared`.
- Switching modes is not retroactive: existing workspaces, memberships and
  invitations keep working.
- Server enforcement: `canCreateWiki` (`packages/shared/src/rbac.ts`), the
  `canCreateProject` guard, and better-auth's organization creation gate.
  The UI only hides create actions.
- The creator of a wiki becomes its owner; dashboard-created wikis start
  empty in both modes.
- A wiki holds up to 100 members (better-auth's `membershipLimit` default).

## Wiki slug paths

Shared tenancy only (`WIKI_SLUG_PATHS` in `apps/app/src/server.ts`).

- Edge: the first path segment, when it is a valid unreserved slug, resolves
  through `GET /api/public/sites/resolve?slug=` (published wikis, current or previous slug;
  404 in independent mode), cached 30 s including misses, so a rename or a new
  wiki can take up to 30 s to route. A hit is rewritten to `/sites/<id>/*`
  with `x-nibleaf-site-origin: <origin>/<slug>`; a previous slug 301s to the
  current one. Public GETs of `/sites/<id>/*` 301 to `/<slug>/*`.
- Order on the app origin: legal redirects → `/<slug>` → `HOMEPAGE=site`
  rewrite → `/sites/<id>`. The home wiki's own slug and `/sites/<home id>`
  301 to `/`.
- Client: one base path per document (`siteBasePath`: `''`, `/<slug>`,
  `/sites/<id>`), carried by the `nibleaf-site-base` meta for the router
  rewrite. A shared-tenancy home wiki routes clicks client-side only for
  top-level segments its navigation owns; others load as documents so the
  server decides.
- Previous slugs: `project.config.previousSlugs` (newest first, at most 10),
  written only by the slug update, never through the config API, and stripped
  from snapshots and site shells. While remembered, another wiki cannot take
  the slug (`wikiSlugUnavailable` in `packages/auth/src/wiki-slugs.ts`).
- Reserved slugs: `DASHBOARD_ROOT_SEGMENTS` ∪ `APP_OWNED_ROOT_SEGMENTS`
  (`packages/shared/src/wiki-paths.ts`), which also build `isDashboardPath`
  and `isAppOwnedPath`; a test fails when a new top-level route is missing.
  Existing clashes are logged at API boot and stay at `/sites/<id>`.

## Platform roles

`user.role`, separate from per-wiki member roles:

- `user` (default): no platform rights.
- `admin`: the operator console; in shared mode also wiki creation and
  wiki-admin rights on every wiki (ownership transfer stays with the owner);
  in independent mode no rights inside wikis it is not a member of.
- `editor`: in shared mode, member rights on every wiki; in independent
  mode, nothing. The effective wiki role is the higher of the membership role
  and the platform grant (`effectiveWikiRole` in
  `packages/shared/src/rbac.ts`). Not an admin-panel role, and cannot create
  wikis. The site list and dashboard analytics cover every wiki the user
  reaches this way (`accessibleProjectsWhere` in
  `apps/server/src/actions/projects.ts`).

Granting (also in [configuration](docs/self-hosting/configuration.mdx)):

```bash
# admin, Docker image (with-env is a dev-only script)
docker compose exec server pnpm --filter @nibleaf/server exec tsx src/scripts/grant-admin.ts you@example.com
# admin, source checkout
pnpm --filter @nibleaf/server with-env tsx src/scripts/grant-admin.ts you@example.com
# revoke: append "user" to either command
```

```sql
UPDATE "user" SET role = 'admin'  WHERE email = 'you@example.com';
UPDATE "user" SET role = 'editor' WHERE email = 'you@example.com';
```

`grant-admin.ts` accepts only `admin` and `user`; `editor` is SQL only. If
the last admin is gone, nobody can create wikis until one is granted again.

## Contributors

In shared mode, a signed-in account with platform role `user` and no
membership is a contributor. Contributors read public published wikis and
join a wiki only by invitation; the dashboard shows them a text empty state
(no wiki directory yet). There is no contributor member role: any membership
row passes the member guards and exposes drafts, branches and private sites.
Future change requests need their own guards instead of widening membership.

## Change requests

The fork drops docs versions. Only the default branch (`main`) is published;
every other branch is the storage of one change request (CR), an isolated copy
of `main` that is reviewed and merged back.

- `ChangeRequest`: per-project `number` (max + 1, retried on a unique clash),
  title, description, author, status `DRAFT | IN_REVIEW | MERGED | ARCHIVED`,
  `branchId` (nulled when the branch is merged or deleted; the record stays),
  merger, and `mergeRecord` (before/after of the pages the merge wrote).
- Invariant: each non-default branch has exactly one CR. `createBranch`
  creates both; deleting a branch archives its CR. Import replacement branches
  (`import-*`, `createImportReplacementBranch`) are internal and get none;
  Mintlify versions import as draft CRs. The migration turned existing
  non-default branches into draft CRs.
- Fork links: CR pages carry `sourcePageId` (their `main` page, `SetNull`) and
  `forkFingerprint` = `<content hash>.<parent hash>.<position hash>` of that
  page at fork time. Content: kind, title, slug, icon, description, content,
  config, hidden, translationKey. Parent as a `main` id.
- Fork base: `ChangeRequest.forkBase` maps every `main` page copied at fork
  time to `{ hash, copyId }` (content hash, CR copy). A copy's parent is
  compared by its fork-time `main` id from this map, so main deleting a parent
  does not count as the CR moving its children. Null means untracked
  (migrated branches, empty Mintlify version imports); cleared on merge.
- Merge (`planMerge` in `apps/server/src/actions/change-request-merge.ts`),
  one transaction:
  - Edited page: written onto the same `main` row (comments, reader grants
    and Git file state stay). Content edited on both sides → conflict
    `BOTH_CHANGED`; tree changes are last-write-wins, taken from the CR only
    where the CR moved the page.
  - New CR page: moved onto `main` with its id; slug suffixed on a sibling
    clash.
  - Page deleted in the CR (in the fork base, no copy left): deleted on
    `main`, or `DELETED_IN_BRANCH` if its `main` content changed since the
    fork. Kept children move to the nearest surviving ancestor; CR pages under
    a parent deleted on `main` likewise.
  - A move on each side that would close a parent loop keeps `main`'s parent
    for the page the CR moved.
  - Page deleted on `main` but edited in the CR: `DELETED_ON_MAIN`.
  - `main` pages created after the fork are kept.
  - Conflicts → 409 with `{ conflicts: [{ pageId, title, path, languageId,
    reason }] }`; `force: [pageId…]` lets the CR win on those pages only and
    answers 409 again if any other conflict exists.
  - Untracked CRs (null fork base) replace `main` wholesale (legacy
    behaviour); the merge record pairs pages by language and path.
  - Replacing `main` wholesale (untracked merge, import over the wiki) is
    refused (409) while tracked CRs with a branch are open: new `main` ids
    would orphan their fork links.
  - Merges take a per-project advisory lock and lock `main`'s rows.
- API: `/projects/:projectId/change-requests` (list `?status=`, create, get
  with changed pages, patch title/description/status, `/:number/merge`,
  `/:number/pages/:pageId/diff`), member role. Branch routes still work and
  keep the invariant.
- Main is read-only for page edits: the page routes (create, update, delete,
  reorder) call `assertPagesEditable` and answer 409 `pages:main_read_only`
  for a write to a `main` page or under one. System writers (import, Git sync,
  merge, starter) call the page actions directly. MCP has no page writers;
  AI drafts return text only. Project settings, chrome, themes, languages and
  domains stay editable on `main`.
- UI: editor on `main` is read-only with **Edit** (opens a CR) and a CR menu;
  `?cr=<n>` binds it to an open CR. CR list `/app/projects/:id/changes`, CR
  page `/changes/:n` (Overview, `?tab=changes`). Block diff:
  `apps/app/src/lib/block-diff.ts` (mdast top-level blocks aligned with
  `diff`), lazy-loaded so it stays out of public-site chunks.
- `buildSnapshot` and both publish paths read only the default branch;
  `defaultVersionOnly` also strips other versions from older snapshots when
  served, rolled back to or indexed. Exports and the MCP `versions` resource
  are authenticated and still list CR branches.

## Branding and runtime config

- Built-in brand is ZhinWiki (`DEFAULT_BRAND`, `packages/shared/src/brand.ts`).
  `APP_NAME` and `BRAND_*` override it at runtime; nothing brand-specific is
  baked into the image. Operator guide:
  [Brand your instance](docs/self-hosting/branding.mdx).
- `HOMEPAGE` picks what the app root serves (`apps/app/src/lib/homepage.ts`):
  the welcome page, the app, or one published site. Shareable, so it also
  lives on `upstream`.
- Upstream's marketing site, blog, Cloud/billing wording and Plan tab are
  removed; generic welcome, terms and privacy pages replace them.

## Where fork code lives

Fork-only files:

- Tenancy: `packages/auth/src/tenancy.ts`,
  `apps/server/src/middlewares/guard/can-create-project.ts`,
  `apps/app/src/functions/tenancy.ts`, `apps/app/src/hooks/use-tenancy.ts`,
  `apps/app/src/components/app/empty-wikis.tsx`.
- Brand: `packages/shared/src/brand.ts`, `apps/app/src/lib/brand.ts`,
  `apps/app/src/components/welcome-page.tsx`.
- Change requests: `apps/server/src/actions/change-requests.ts`,
  `apps/server/src/actions/change-request-merge.ts`,
  `apps/server/src/modules/app/change-requests/`,
  `apps/app/src/components/change-requests/`, `apps/app/src/lib/block-diff.ts`,
  `apps/app/src/routes/app/projects/$projectId/changes.*.tsx`.

Upstream files carrying fork edits: `packages/auth/src/keys.server.ts`,
`packages/auth/src/account-deletion.ts`, `packages/shared/src/rbac.ts`,
`packages/design-system/src/brand/`, `apps/server/src/actions/branches.ts`,
`packages/shared/src/site.ts` (`buildSnapshot`).

Tenancy and platform roles are fork-only: they live on `main` (see
[branches](BRANDING.md#branches)).

## Merging upstream: watch for

- `packages/auth/src/server.ts`: `organization()` options and the
  `user.create.after` hook must keep going through `tenancy.ts`.
- New org-creation paths (server actions, MCP, worker): must respect
  `canCreateWiki`.
- New permission checks: must resolve the role through `effectiveWikiRole`
  (as `apps/server/src/actions/projects.ts` does), not the raw membership
  role, or editors lose access. New cross-wiki lists: scope them with
  `accessibleProjectsWhere`.
- `apps/app/src/routes/__root.tsx` loader (`tenancy`), the dashboard,
  `sites.tsx` and the site switcher (create gates).
- `account-deletion.ts` and its error codes.
- `schema.prisma` `User.role` comment, `projects` route guard list.
- Env: new variables go into `.env.example`, `.env.production.example` and
  the compose `x-service-env` blocks; keep `TENANCY` defaults as above and run
  `pnpm release:check`.
- i18n: new strings in all 12 catalogs and `message-ids.ts`; rename
  "Nibleaf" in user-facing copy.
- Dropped upstream pages, tests and Cloud wording must not come back.
- New page writers or branch creators: keep the CR invariant and fork links
  (`createBranch`); new readers of non-default branches must not reach
  public output.
