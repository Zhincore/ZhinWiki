import { useMutation, useQuery } from '@tanstack/react-query';
import { answerSiteFn, searchSiteFn, searchWikisFn } from '@/functions/site-search';
import { queryKeys } from './query-keys';

const requireSiteId = (siteId: string | undefined) => {
  if (!siteId) throw new Error('Site ID is required');
  return siteId;
};

export const useSiteSearch = (siteId: string | undefined, query: string, language?: string, limit?: number, enabled = true) =>
  useQuery({
    queryKey: queryKeys.site.search(siteId ?? '', query, language, limit),
    enabled: Boolean(enabled && siteId && query.trim()),
    queryFn: () =>
      searchSiteFn({
        data: {
          projectId: requireSiteId(siteId),
          query,
          ...(language ? { language } : {}),
          ...(limit ? { limit } : {}),
        },
      }),
  });

export const useSearchWikis = (siteId: string | undefined, query: string, enabled = true) =>
  useQuery({
    queryKey: queryKeys.site.searchWikis(siteId ?? '', query),
    enabled: Boolean(enabled && siteId && query.trim()),
    queryFn: () => searchWikisFn({ data: { projectId: requireSiteId(siteId), query } }),
  });

export const useAnswerSite = () =>
  useMutation({
    mutationFn: (input: { projectId: string; query: string; language?: string }) => answerSiteFn({ data: input }),
  });
