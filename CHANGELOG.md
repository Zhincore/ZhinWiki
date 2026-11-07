# Changelog

This file records source changes. A merged entry does not prove that a
published self-host image contains it. The committed self-host
manifest remains the authority for the latest published artifact.

## Unreleased

## v0.2.0

ZhinWiki release; changes since ZhinWiki v0.1.0.

### Highlights

ZhinWiki v0.2.0 runs one shared community by default, where platform admins create wikis and anyone signed in can suggest changes through reviewed change requests. Sign-up gets a self-hosted bot check, shared rate limits and GitHub or Discord sign-in, and readers can search across all public wikis.

### Upgrade actions

Back up first: the migrations below are forward-only. The full list is in
[backups and upgrades](docs/self-hosting/backups-upgrades.mdx#from-v010).

- **Replace the Compose file and env template** with this release's copies and
  keep `.env`. New variables: `TENANCY` (now `shared` in the templates; set
  `independent` to keep v0.1.0 behaviour), `CAPTCHA_PROVIDER` (default
  `altcha`), `CAPTCHA_HMAC_KEY`, `TURNSTILE_SITE_KEY`/`TURNSTILE_SECRET_KEY`,
  `GITHUB_CLIENT_*`, `DISCORD_CLIENT_*`, `OTP_SEND_LIMIT_PER_EMAIL` (5/h),
  `OTP_SEND_LIMIT_PER_IP` (20/h).
- **Check `TRUSTED_PROXY_HOPS`.** Code-email limits are per client IP. Behind a
  public edge such as Cloudflare, a wrong value puts every visitor into one
  20-per-hour bucket.
- **Migrations run on start:** `change_requests` (every non-default branch
  becomes a draft change request; `main` becomes read-only in the editor),
  `invitation_created_at`, `import_run_error_code`, `change_request_reviews`,
  `drop_search_version_filter` (strips the old search setting) and
  `page_search_document` (cross-wiki full-text table). The worker fills
  `page_search_document` for live deployments at boot; no reindex needed.
- **Duplicate linked accounts.** Better Auth 1.7.14 refuses sign-in when two
  `account` rows share a provider and account ID; run the check in the upgrade
  guide before upgrading.
- **`OPENROUTER_API_KEY`** replaces `OPENAI_API_KEY`. If you set
  `WORKER_QUEUES`, add `erasure`.
- **Docs versions are gone.** Only `main` is published; version-prefixed site
  URLs (`/<site>/<version>/…`) now return 404. Static and Markdown export ZIPs
  use `<lang>/<path>` instead of `<version>/<lang>/<path>`. The MCP
  `versions:read` scope and `list_versions` tool are removed.
- **Publish on merge is now the default.** A wiki that never set the option
  publishes on every merged change request; turn it off per wiki under
  Settings → Change requests to keep manual publishing.
- The upstream two-step BullMQ upgrade does not apply: v0.1.0 already runs
  BullMQ 6.

### Added

- Tenancy modes: `TENANCY=shared|independent`, platform `editor` role and
  outside contributors ([#63](https://github.com/Zhincore/ZhinWiki/pull/63), [#64](https://github.com/Zhincore/ZhinWiki/pull/64), [#65](https://github.com/Zhincore/ZhinWiki/pull/65), [#67](https://github.com/Zhincore/ZhinWiki/pull/67), [#78](https://github.com/Zhincore/ZhinWiki/pull/78)).
- Published wikis at `/<slug>` in shared mode ([#69](https://github.com/Zhincore/ZhinWiki/pull/69)).
- Change requests: per-page merge, read-only `main`, reviews and merge gate,
  contributor image uploads, publish on merge, history and revert
  ([#70](https://github.com/Zhincore/ZhinWiki/pull/70), [#71](https://github.com/Zhincore/ZhinWiki/pull/71), [#79](https://github.com/Zhincore/ZhinWiki/pull/79), [#80](https://github.com/Zhincore/ZhinWiki/pull/80), [#85](https://github.com/Zhincore/ZhinWiki/pull/85), [#86](https://github.com/Zhincore/ZhinWiki/pull/86), [#88](https://github.com/Zhincore/ZhinWiki/pull/88), [#92](https://github.com/Zhincore/ZhinWiki/pull/92)).
- MCP `list_pages` can list a change request's pages ([#94](https://github.com/Zhincore/ZhinWiki/pull/94)).
- Sign-up hardening: ALTCHA or Turnstile bot check on code emails, per-address
  and per-IP limits shared through Dragonfly, GitHub and Discord sign-in
  ([#87](https://github.com/Zhincore/ZhinWiki/pull/87)).
- Public wikis open to contributors in the dashboard sites list ([#91](https://github.com/Zhincore/ZhinWiki/pull/91)).
- Cross-wiki search (`scope=all`) backed by a Postgres full-text table
  ([#98](https://github.com/Zhincore/ZhinWiki/pull/98), [#99](https://github.com/Zhincore/ZhinWiki/pull/99)).
- Account deletion archives the user's open change requests ([#97](https://github.com/Zhincore/ZhinWiki/pull/97)).
- Change-request actions and "Approve and merge" in the editor's top bar
  ([#105](https://github.com/Zhincore/ZhinWiki/pull/105)).
- Account settings link in the sidebar menu and a display-name prompt on first
  sign-in; the sidebar falls back to your own email until a name is set
  ([#106](https://github.com/Zhincore/ZhinWiki/pull/106)).

### Changed

- Publish on merge is on by default; the Publish button stays available in
  site settings ([#105](https://github.com/Zhincore/ZhinWiki/pull/105)).
- Docs versions removed ([#93](https://github.com/Zhincore/ZhinWiki/pull/93)).
- Plan tab and Cloud wording removed ([#59](https://github.com/Zhincore/ZhinWiki/pull/59), [#60](https://github.com/Zhincore/ZhinWiki/pull/60)); fork docs and rebrand
  ([#66](https://github.com/Zhincore/ZhinWiki/pull/66), [#76](https://github.com/Zhincore/ZhinWiki/pull/76), [#95](https://github.com/Zhincore/ZhinWiki/pull/95), [#96](https://github.com/Zhincore/ZhinWiki/pull/96), [#102](https://github.com/Zhincore/ZhinWiki/pull/102)).
- The privacy page describes self-service account deletion and what happens to
  contributions ([#97](https://github.com/Zhincore/ZhinWiki/pull/97), [#102](https://github.com/Zhincore/ZhinWiki/pull/102)).
- Upstream Nibleaf v0.2.0 and later fixes merged ([#74](https://github.com/Zhincore/ZhinWiki/pull/74), [#84](https://github.com/Zhincore/ZhinWiki/pull/84), [#90](https://github.com/Zhincore/ZhinWiki/pull/90));
  see the Nibleaf section below.

### Fixed

- Background import failures are translated and GitBook starts are capped
  atomically ([#77](https://github.com/Zhincore/ZhinWiki/pull/77)).
- The back arrow and a new close button in site settings return to the editor
  instead of leaving it ([#107](https://github.com/Zhincore/ZhinWiki/pull/107)).
- Better Auth's own sign-in and code-email limits are keyed on the resolved
  client IP instead of one bucket shared by every client behind a proxy chain
  ([#103](https://github.com/Zhincore/ZhinWiki/pull/103)).

## Nibleaf v0.2.0 (upstream)

Upstream release notes, merged with the upstream sync. Its upgrade actions
target Nibleaf v0.1.2; ZhinWiki users follow the section above.

### Highlights

v0.2.0 adds optional hybrid search with grounded AI answers, a GitBook importer, project add-ons, portable documentation themes, usage metering, project integrations, and a read-only MCP endpoint, and published sites now move between pages without a full reload. Upgrading from v0.1.2 takes two steps because of the move to BullMQ 6, so follow the [upgrade guide](https://docs.nibleaf.com/self-hosting/upgrade-v0-2) instead of only changing the image tag. Dependency scanning still reports three Medium advisories, in `glob`, `minimatch`, and `deepmerge`, which the image includes through its email packages.

### Upgrade actions

These apply when you upgrade a self-hosted v0.1.2 installation. New installations
need none of them. The
[upgrade guide](https://docs.nibleaf.com/self-hosting/upgrade-v0-2) has the full
procedure.

- **Upgrade in two hops.** Changing only the image tag does not work. BullMQ 6
  refuses the repeat definitions left by v0.1.2: the log shows `Unknown recurring
  configuration`, scheduling is refused, and the API and worker do not become ready.
  Migrate the schedules from the staged image first (#123, #147).
- **Take a tested backup.** Eight Prisma migrations run on start and are
  forward-only. Going back means restoring the pre-upgrade backup. Rolling back the
  schedules alone is not enough.
- **Check for duplicate linked accounts.** Better Auth now refuses a sign-in when two
  `account` rows share a provider and account ID. The check in the upgrade guide must
  return no rows (#249).
- **Replace the Compose file** with the release's verified copy, keeping `.env`, the
  Compose project name, and the volume names. Changing only the version misses the
  new `MCP_*` and `INTEGRATION_*` settings.
- **Add `INTEGRATION_CREDENTIAL_ENCRYPTION_KEY`** to `.env`, as a base64-encoded
  32-byte key, before using integrations. Do not change it once integrations are in
  use.
- **Confirm a sign-in path.** Sign-in uses email codes, or Google when configured.
  The worker health check returns 503 while required email delivery has no provider.
  Configure Postmark or SMTP, or set `EMAIL_DELIVERY_REQUIRED=false` on an instance
  that signs in through Google.
- **Move AI to OpenRouter.** AI writing assist and search read `OPENROUTER_API_KEY`.
  `OPENAI_API_KEY` is no longer used (#100). The release Compose file passes the new
  key to the services (#241).
- **Add `erasure` to `WORKER_QUEUES` if you set it.** Deleting a project now also
  erases its stored files through a new `erasure` queue. An allowlist without it
  leaves those files in place. This applies only to projects deleted after the upgrade
  (#248).

### Added

- A GitBook Git Sync importer, thanks to @Zhincore, that keeps sidebar sections and
  URLs, maps GitBook blocks onto Nibleaf components, and copies images into project
  storage (#235).
- Published sites move between pages without a full reload, thanks to @Zhincore, with
  focus, announcements and page views handled for each navigation (#237).
- Pages with subpages collapse in the published sidebar, with only the branch holding
  the current page open, and Harbor and Signal show a visible scrollbar. Readers
  without JavaScript still see every page (#262).
- The admin funnel shows first manual publishes and day 1 to 7 publishing retention
  (#244).
- The installer refuses to run over an existing installation, checks the Docker
  architecture, and requires a sign-in path (#241).
- Tenant-safe hybrid search over Qdrant with optional grounded AI answers, project
  search configuration, and privacy-safe index diagnostics (#98, #106).
- Project add-ons with entitlement-aware availability, consent controls, reader
  actions, publish checks, revisions, and audit history (#103).
- Harbor, Manuscript, and Signal documentation themes with safe template exchange
  and runnable Git exports (#96, #101, #104).
- Provider-neutral usage metering with exact quantities, advisory entitlements,
  reconciliation, export, deletion, and degraded states (#105).
- Optional ClickHouse product analytics (#97).
- A project integrations engine with encrypted credentials, confirmations, audit,
  and key rotation (#107).
- An authenticated, project-bound HTTP MCP endpoint with least-privilege read
  adapters, audit, API-key expiry, host validation, and rate limiting (#108).
- An English and Arabic guide library, plus Markdown delivery for public pages
  (#142).

### Changed

- Moved to Prisma 7, Vite 8, TypeScript 7, BullMQ 6, and stable TanStack Start (#90,
  #91, #92, #123, #188).
- AI features now use OpenRouter (#100).
- The release image installs a separate production dependency graph (#198).
- Services receive termination signals directly, so they shut down gracefully (#173).
- Worker readiness now checks its queue connections (#202).
- Project routes wait for access and show a clear not-found state, and member
  administration controls follow the member's role (#168).
- Mobile navigation reaches sign-in and product pages, and privacy choices moved to
  an explicit footer dialog (#176).
- Removed the View Markdown and Copy Markdown buttons from the public reader (#175).
- Self-hosting documentation now covers the upgrade, the `amd64` requirement, the
  sign-in prerequisite, and backups that work from an installer directory.
- Upgraded Better Auth to 1.7.14, with an additive migration for the `invitation.createdAt`
  column its schema check requires. Builds of `main` on 1.7.0 to 1.7.2 could not
  complete Google sign-in; no published release was affected (#249).

### Fixed

- **AI:** When an AI provider fails, drafting shows a translated error in the editor
  instead of offline placeholder text, and AI controls no longer appear on instances
  without a provider (#259, #260).
- **Projects:** Deleting a project also erases its stored files (#248), and a project
  has no icon unless one is picked (#263).
- **Exports:** GitHub alert callouts render without the literal marker (#257).
- **Published sites:** Public asset routes serve only a project's assets (#250), and
  custom domains keep the right paths and canonical origins (#246).
- **CLI:** `inspect` checks a path that gets the real Markdown 404, and publishing uses
  npm trusted publishing (#242).
- **Editor and publishing:** Saving a page no longer corrupts an image placed directly
  before an MDX block tag or paragraph (#236, thanks @Zhincore). Pages already saved
  in the corrupted form need a manual fix or a re-import. Saves are serialized so
  rapid or blank edits are not lost, and a publish uses the latest draft (#194).
  Python `import` lines survive the visual editor (#212).
- **Published reader:** Invalid site URLs return 404 instead of 500 (#239). Rate-limited
  requests keep their 429, and Try again reloads the route (#216). Server rendering
  works when public and container ports differ (#198). Articles stay visible during
  hydration (#209), accessible names are localized (#207), and reader links use clean
  canonical URLs (#174). Transient failures no longer look like an unpublished site
  (#212).
- **Search and answers:** Pages that begin at `##` and definitions held in headings are
  retrievable (#212, #213). Answers keep complementary evidence (#214, #215),
  weak dense matches are filtered before fusion (#218), custom-domain search works
  (#137), and index diagnostics recover during first-time indexing (#213).
- **Imports:** Mintlify sync is atomic with navigation-exact replacements (#129, #131).
  Cross-language imports no longer duplicate pages (#148), literal code and fenced MDX
  examples are preserved (#167, #169), and Ghost fallback warnings are kept (#199).
- **Exports:** PDF export uses bounded memory on image-heavy sites (#220), Arabic PDFs
  are readable (#198), cross-language links resolve (#221), and attachment downloads
  and localized file sizes are correct (#211).
- **Sign-in and administration:** A failed email enqueue returns an error instead of
  claiming a code was sent, expired codes are not delivered, and those errors are
  localized (#202, #205). Email templates render correctly (#128), and the admin
  panel renders and keeps its session on a shared auth origin (#124, #145).
- **Arabic and RTL:** Fixed the command palette crash, direction handling, select
  labels, and digit display across the dashboard (#136, #137), and labelled settings
  controls for assistive technology (#139).
- **Projects:** Deleting a project and analytics writes no longer fail on a database
  lock result (#170).
- **Math:** Sanitization no longer strips KaTeX layout and accessibility metadata
  (#197).

### Security

- Patched runtime dependency advisories and upgraded the MCP server SDK with input
  limits (#258, #261).
- Moved `next`, `vite`, `vitest`, `body-parser`, `fast-uri`, `qs`, and `toml` to
  patched versions (#268).
- Removed the unused Better Auth organization deletion endpoint, so workspace removal
  uses the full erasure workflow (#245).
- Tightened remote image downloads in the importers (#243).
- Disabled an unused Better Auth invitation endpoint, so invitations keep following
  Nibleaf's rules (#249).
- Updated the runtime image's zlib, Expat, Chromium, and bundled pnpm (#203, #217,
  #219).
- Patched the MDX frontmatter TOML parser for GHSA-82x6-q7mm-w9cf and
  GHSA-v5mp-jgw5-2x6j (#146), and applied compatible updates for vulnerable transitive
  dependencies (#197).
- The release image no longer carries development tools or accepts private local
  environment and QA files during `COPY` (#198).

### Known limitations

- The published image supports `linux/amd64` only.
- `docker-compose.prod.yml` includes neither Qdrant nor ClickHouse. Hybrid search needs
  the optional overlay, and AI features need a provider key that you supply.
- The MCP endpoint is off by default and its adapters are read-only.
- Usage metering does not enable billing or payments, and entitlements remain
  advisory.
- Dependency scanning still reports three Medium advisories, in `glob`, `minimatch`,
  and `deepmerge`. The image includes them through its email packages. Nibleaf does
  not import them directly, and removing them needs upstream changes.
