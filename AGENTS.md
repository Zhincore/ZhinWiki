# AGENTS.md

Guidance for coding agents (and humans) working on this repository, a fork
of Nibleaf. Setup and general conventions are in
[CONTRIBUTING.md](CONTRIBUTING.md); naming rules in [BRANDING.md](BRANDING.md);
fork-only behaviour in [FORK.md](FORK.md).

## Branches and PRs

- `upstream`: Nibleaf-branded, upstream `main` plus changes that could be
  shared back. `main`: `upstream` plus the rebrand and fork-only work.
- Shareable change → branch off `upstream`, PR into `upstream`. Fork-only
  change (branding, fork features) → branch off `main`, PR into `main`.
- `upstream` is merged into `main` (merge, never rebase). Both are merge-only.
- One feature per PR; brief PR descriptions and commit messages.
- Never reference upstream PRs or issues (`owner/repo#n`, links) in fork
  commits, PRs, or comments.

## Checks

Run before opening a PR (CI runs the same):

```bash
pnpm typecheck
pnpm test              # script tests + every package
pnpm lint              # biome
pnpm check:dead-code   # knip
pnpm docs:check        # when docs/ changes
pnpm release:check     # when compose, release, or env templates change
```

Target a package with `pnpm turbo run typecheck test --filter @nibleaf/<pkg>`.
Run `pnpm db:generate` once in a fresh checkout.

## Conventions

- **i18n:** every user-facing string goes into all 12 catalogs in
  `packages/i18n/messages/*.json` and `packages/i18n/src/message-ids.ts`.
  English first; RTL must work (logical CSS properties).
- **Runtime config:** instance settings (brand, URLs, homepage) are read from
  env at runtime, never baked into the image at build time.
- **Workspace packages** declare `sideEffects` in `package.json`; modules with
  import-time effects must be listed there (see CONTRIBUTING.md).
- **No dead code:** remove code orphaned by a change.
- **Privacy:** prefer privacy-preserving defaults with small, compatible
  changes over redesigns.
- **Comments:** few, describing what the current code does.
- **Docs:** pages under `docs/` have an Arabic pair under `docs/ar/` and are
  listed in `docs/docs.json`.
- `docker-compose.prod.yml` and `.env.production.example` are release assets;
  keep them consistent (`pnpm release:check`).
