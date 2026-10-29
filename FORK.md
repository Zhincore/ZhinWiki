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
| Platform `editor` | No wiki rights | Member rights on every wiki |
| Account deletion | Erases wikis where the user is the sole member | Refused (`SOLE_WIKI_OWNER`) while the user is a wiki's sole member |

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

## Platform roles

`user.role`, separate from per-wiki member roles:

- `user` (default): no platform rights.
- `admin`: wiki creation in shared mode, plus the operator console. No
  rights inside wikis it is not a member of.
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

Upstream files carrying fork edits: `packages/auth/src/keys.server.ts`,
`packages/auth/src/account-deletion.ts`, `packages/shared/src/rbac.ts`,
`packages/design-system/src/brand/`.

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
