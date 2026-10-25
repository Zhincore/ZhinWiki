# Branding and naming

This repository is a fork of [Nibleaf](https://github.com/lord007tn/nibleaf).
Nibleaf's code is AGPL-3.0, but its name and logo are trademarks
([their trademark policy](https://github.com/lord007tn/nibleaf/blob/main/TRADEMARK.md)): the fork may not ship under them. The rules
below keep the rebrand small, so upstream changes keep merging cleanly.

`‹Brand›` is a placeholder until the user-facing name is chosen.

## Branches

| Branch     | Branding | Contents |
| ---------- | -------- | -------- |
| `upstream` | Nibleaf  | Upstream `main` plus features that could be shared back. |
| `main`     | ‹Brand›  | `upstream` plus the rebrand and fork-only features. |

- Sync upstream into `upstream` (remote `nibleaf`), then merge `upstream`
  into `main`. Always merge, never rebase; `git rerere` replays resolutions.
- Shareable work branches off `upstream`; fork-only work branches off `main`.

## What gets which name

| Kind | Name | Why |
| ---- | ---- | --- |
| Anything a user sees: UI, emails, page titles, docs, README, logo, domains | ‹Brand›, from the brand config | Trademark: the fork must not present itself as Nibleaf. |
| Existing internal identifiers: `@nibleaf/*` packages, env vars, Docker image, database and table names, cookies, file names | `nibleaf` (unchanged) | Not user-facing. Renaming touches hundreds of files, conflicts on every upstream merge, and breaks existing installs. |
| New fork-only internal identifiers | `nibbledocs` (`@nibbledocs/*`, `NIBBLEDOCS_*`) | Marks fork-only code at a glance. |

Never rename an existing `nibleaf` identifier just to rebrand.

## Attribution and notices

- `TRADEMARK.md` on `main` is the fork's own short note: ‹Brand› marks belong
  to ‹owner›; "Nibleaf" and its logo are the Nibleaf project's, used only to
  say this is a fork, linking their policy. `upstream` keeps Nibleaf's file.
- No Nibleaf logo anywhere users see it on `main` (favicons, app, emails,
  default docs theme): their policy forbids using or modifying it.

- Keep `LICENSE` and the upstream copyright in `NOTICE`; add the fork's own
  copyright line below it.
- AGPL-3.0 §13: users interact over the network, so the UI must link to this
  fork's source.
- Footer: `© ‹year› ‹Brand› · Open source under AGPL-3.0 · Source · A fork of Nibleaf`.
  "A fork of Nibleaf" is wording the trademark policy explicitly allows.
- Upstream's marketing and comparison pages are dropped on `main`, not rebranded.
