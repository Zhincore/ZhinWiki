import { defaultLanguage, publicLanguages, type SiteSnapshot } from '@nibleaf/shared/site';
import { searchConfigurationSchema } from '@nibleaf/validators';
import { z } from 'zod';

const configRecordSchema = z.record(z.string(), z.unknown()).catch({});

export const resolvePublishedSearchRequest = (config: unknown, requested: { language?: string; limit?: number }) => {
  const parsed = searchConfigurationSchema.safeParse(configRecordSchema.parse(config).search);
  const configuration = parsed.success ? parsed.data : searchConfigurationSchema.parse({});
  return {
    configuration,
    // Selector visibility is presentation-only. The active page context is
    // still server-validated below the action boundary and must survive when a
    // selector is hidden, otherwise localized pages fall back to the project
    // defaults.
    language: requested.language,
    limit: Math.min(requested.limit ?? configuration.maxResults, configuration.maxResults),
  };
};

/** Resolve the caller-supplied active page context against the immutable
 * published snapshot. Both keyword and answer actions use this boundary so a
 * hidden selector cannot change tenant/language scope. */
export const resolvePublishedSearchContext = (snapshot: SiteSnapshot, requested: { language?: string; limit?: number }) => {
  const request = resolvePublishedSearchRequest(snapshot.project.config, requested);
  const language =
    publicLanguages(snapshot.project.languages).find((candidate) => candidate.code === request.language)?.code ??
    defaultLanguage(snapshot.project).code;
  return { configuration: request.configuration, language, limit: request.limit };
};

/**
 * Keyword search is global across the published multilingual corpus unless an
 * API caller explicitly asks for one language. The explicit form remains for
 * backwards-compatible integrations; the reader UI deliberately omits it.
 */
export const resolvePublishedSearchLanguages = (snapshot: SiteSnapshot, requestedLanguage?: string): string[] => {
  if (requestedLanguage) {
    return [resolvePublishedSearchContext(snapshot, { language: requestedLanguage }).language];
  }
  return publicLanguages(snapshot.project.languages).map((language) => language.code);
};
