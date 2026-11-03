-- Docs versions are gone: drop the retired search version-filter toggle so the
-- strict search configuration schema keeps accepting stored settings.
UPDATE "project"
SET "config" = "config" #- '{search,versionFilterEnabled}'
WHERE jsonb_typeof("config"->'search') = 'object'
  AND "config"->'search' ? 'versionFilterEnabled';
