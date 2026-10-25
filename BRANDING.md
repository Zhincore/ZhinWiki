# Branding and naming

This repository is a fork of [Nibleaf](https://github.com/lord007tn/nibleaf).
Nibleaf's code is AGPL-3.0, but its name and logo are trademarks
([their trademark policy](https://github.com/lord007tn/nibleaf/blob/main/TRADEMARK.md)): the fork may not ship under them. The fork ships as
**ZhinDocs**. The rules below keep the rebrand small, so upstream changes keep
merging cleanly.

Instances can rename themselves at runtime (`APP_NAME` and the other `BRAND_*`
variables, see `.env.example`); ZhinDocs is only the built-in default.

## Branches

| Branch     | Branding | Contents |
| ---------- | -------- | -------- |
| `upstream` | Nibleaf  | Upstream `main` plus features that could be shared back. |
| `main`     | ZhinDocs | `upstream` plus the rebrand and fork-only features. |

- Sync upstream into `upstream` (remote `nibleaf`), then merge `upstream`
  into `main`. Always merge, never rebase; `git rerere` replays resolutions.
- Shareable work branches off `upstream`; fork-only work branches off `main`.

## What gets which name

| Kind | Name | Why |
| ---- | ---- | --- |
| Anything a user sees: UI, emails, page titles, docs, README, logo, domains | ZhinDocs, from the brand config | Trademark: the fork must not present itself as Nibleaf. |
| Existing internal identifiers: `@nibleaf/*` packages, env vars, Docker image, database and table names, cookies, file names | `nibleaf` (unchanged) | Not user-facing. Renaming touches hundreds of files, conflicts on every upstream merge, and breaks existing installs. |
| New fork-only internal identifiers | `nibbledocs` (`@nibbledocs/*`, `NIBBLEDOCS_*`) | Marks fork-only code at a glance. |

Never rename an existing `nibleaf` identifier just to rebrand.

## Attribution and notices

- `TRADEMARK.md` stays Nibleaf's policy, unchanged on both branches. The fork
  claims no trademark on ZhinDocs; "Nibleaf" is used only to say this is a fork.
- No Nibleaf logo anywhere users see it on `main` (favicons, app, emails,
  default docs theme): their policy forbids using or modifying it.

- Keep `LICENSE` and the upstream copyright in `NOTICE`; the fork's own
  copyright line sits below it.
- AGPL-3.0 §13: users interact over the network, so the UI must link to this
  fork's source.
- Footer: `© ‹year› ZhinDocs · Open source under AGPL-3.0 · Source · A fork of Nibleaf`.
  "A fork of Nibleaf" is wording the trademark policy explicitly allows.
- Upstream's marketing and comparison pages are dropped on `main`, not rebranded.
