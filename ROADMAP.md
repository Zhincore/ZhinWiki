# Roadmap

Direction: a GitBook-style community wiki, shared tenancy by default,
privacy-first. Items are unordered and may be dropped. Fork-only
behaviour is described in [FORK.md](FORK.md); released changes are in
[CHANGELOG.md](CHANGELOG.md).

## Planned

- Git-connected wikis: mirror a change request as a Git branch / pull
  request on the connected repository.
- Change-request discussion: a comment thread per change request so
  contributors and members can talk without exposing page-level member
  notes.
- Notification when the main branch changes under an open change request
  (imports, merges).

## Considering

- Reusable content snippets (GitBook includes are inlined on import today).
- Image proxy for third-party images in change requests and published
  sites (privacy), with optional resizing.
- Published-site snapshots for faster cold loads.
- Simplifying the multi-tenant-only parts of the admin panel.
- Software vs. instance attribution (badge, export generator, Git commits).
- Back-translation check of the i18n catalogs.

## Known limitations

- The sign-in code rate limit of the auth library is kept per API process,
  so it scales with the number of replicas. The instance-wide limits
  (per address and per IP, shared through Dragonfly) apply regardless.
- Hybrid search needs Qdrant and an embeddings provider; page text is sent
  to that provider. The default `legacy` runtime stays on the host.
