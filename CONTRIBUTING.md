# Contributing to ZhinWiki

Thanks for your interest in improving ZhinWiki — the open-source, self-hostable
documentation platform. This guide covers how to get a local environment running
and the conventions we follow.

## Licensing of contributions

ZhinWiki is licensed under the **GNU Affero General Public License v3.0 only**
(`AGPL-3.0-only`; see [LICENSE](LICENSE)). By submitting a contribution (a pull
request, patch, or any other change), you agree that it is licensed under the
same `AGPL-3.0-only` terms as the project and certify that you have the right to
submit it. ZhinWiki does not require a separate contributor license agreement or
Developer Certificate of Origin sign-off.

## Development setup

Requirements: **Node ≥ 22.13**, **pnpm ≥ 10**, and **Docker** (for Postgres, the
cache, and S3-compatible storage).

```bash
git clone https://github.com/Zhincore/ZhinWiki.git
cd ZhinWiki
cp .env.example .env

pnpm install
pnpm db:generate

# Bring up the datastores (Postgres, Dragonfly, maxio):
docker compose -f docker-compose.dev.yml up -d

# Apply migrations and seed a local demo account (demo@nibleaf.test):
pnpm db:deploy
pnpm db:seed

# Run the app, API, and worker in watch mode:
pnpm dev
```

- Dashboard: http://localhost:4310
- API + OpenAPI docs: http://localhost:4311/docs

The demo account uses the same email-code sign-in as the product. With no email
provider configured, open the local worker's job dashboard at
http://localhost:4312/jobs and read the code in the latest email job's data.
The seed creates the workspace and published starter idempotently.

For a production-style installation, use the pinned-image path in the
[self-hosted quickstart](docs/getting-started/self-hosted.mdx)
instead of the development stack above.

## Before you open a PR

Run the same checks CI runs and make sure they pass:

```bash
pnpm format      # biome format --write . (auto-fix formatting)
pnpm typecheck   # turbo run typecheck
pnpm lint        # biome check .
pnpm test        # vitest across the workspace
```

Documentation lives under [`docs/`](docs/README.md), with reader navigation in
`docs/docs.json`. Run `pnpm docs:check` after changing a page or the navigation.
The [documentation contribution guide](docs/contributing/documentation.mdx)
covers content types, product-truth checks, visual review, and publication to
the canonical site.

## Conventions

- **Monorepo** (pnpm + turbo). Apps live in `apps/*`, shared libraries in
  `packages/*`, all scoped `@nibleaf/*`.
- **Content is Markdown end-to-end.** `Page.content` is a Markdown string that
  feeds search, the table of contents, excerpts, and the live site. The editor
  round-trips Markdown — never persist ProseMirror/TipTap JSON.
- **i18n is first-class.** New user-facing strings must be added to *both* the
  English and Arabic Paraglide catalogs (`packages/i18n/messages/*.json`), and
  the UI must work in RTL. Use logical CSS properties (`ms-*`/`me-*`, `start`/`end`).
- **Packages declare `sideEffects`** in `package.json` so client bundles drop
  unused exports. A module that does work at import time (globals, env checks,
  registrations) must be listed there, and must be imported directly from its
  own path: a side-effect-free barrel that re-exports it is dropped when none
  of its exports are used.
- **Commits**: short, imperative, scoped (e.g. `editor: fix slash menu in RTL`).
- **Tests**: add or update tests for behavior changes. Pure logic lives in
  `packages/*` and is the easiest to cover.

## Reporting bugs & requesting features

Use the GitHub issue templates. For support and community questions, see
[SUPPORT.md](SUPPORT.md).

## Releases

`CHANGELOG.md` is the reviewed record of changes; keep `## Unreleased` current.
PR titles must be conventional (`type(scope): subject`, checked by CI) because
the GitHub release notes are generated from commit history.

A release is a PR titled `chore(release): prepare vX.Y.Z` into `main` that:

1. Renames `## Unreleased` in `CHANGELOG.md` to `## vX.Y.Z` (with `### Highlights`
   and, when needed, `### Upgrade actions`) and adds an empty `## Unreleased`
   above it.
2. Bumps the image pin in both release assets: `NIBLEAF_VERSION:-vX.Y.Z` in
   `docker-compose.prod.yml` and `NIBLEAF_VERSION=vX.Y.Z` in
   `.env.production.example`. Update the same version where the docs and
   README quote it.
3. Passes `pnpm release:check`, which verifies that both pins match and that
   the Docker and release workflows keep their contract.

Pushing the tag `vX.Y.Z` to the merge commit runs
`.github/workflows/release.yml`: it rejects a tag whose pins do not match,
builds and publishes the GHCR image, generates the GitHub release notes with
`changelogithub` (`pnpm release:notes`, commits since the previous tag), and
attaches `docker-compose.prod.yml` and `env.production.example` as release
assets. Published version tags are immutable; a re-run never overwrites them.
