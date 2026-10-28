# How ZhinWiki differs from Nibleaf

Developer notes on behaviour that exists only in this fork. Naming and
branch rules are in [BRANDING.md](BRANDING.md); operator docs live under
[`docs/`](docs/README.md).

## Tenancy modes

`TENANCY` (env, read at boot; an invalid value stops the server and app)
selects how accounts and wikis relate. Each wiki owns its organization (one
team per wiki), as upstream.

| | `multi` (upstream behaviour) | `single` (fork default for production) |
| --- | --- | --- |
| Sign-up | Creates a workspace and a starter wiki | Creates an account only |
| Who creates wikis | Any signed-in user | Platform admins only |
| Account deletion | Erases wikis where the user is the sole member | Refused (`SOLE_WIKI_OWNER`) while the user is a wiki's sole member |

- Code default and `.env.example` stay `multi` (dev seed needs it).
  `.env.production.example`, `docker-compose.prod.yml` and
  `docker-compose.coolify.yml` default to `single`.
- Switching modes is not retroactive: existing workspaces, memberships and
  invitations keep working.
- Server enforcement: `canCreateWiki` (`packages/shared/src/rbac.ts`), the
  `canCreateProject` guard, and better-auth's organization creation gate.
  The UI only hides create actions.
- The creator of a wiki becomes its owner; dashboard-created wikis start
  empty in both modes.
- Contributors without a membership see a text empty state on the
  dashboard; there is no wiki directory yet.

## Platform roles

`user.role`, set by SQL (`admin` also by the `grant-admin` script; see
[configuration](docs/self-hosting/configuration.mdx)):

- `admin`: wiki creation in single mode, plus the operator console.
- `editor`: member rights on every wiki. The effective wiki role is the
  higher of the membership role and the platform grant
  (`effectiveWikiRole` in `packages/shared/src/rbac.ts`). Not an admin-panel
  role, and cannot create wikis.

The dashboard lists only wikis the user is a member of, so an `editor` opens
other wikis by URL.
