import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import { getData } from './client-helpers';

export const useGetPublicMeta = (options?: { enabled?: boolean }) =>
  useQuery({
    queryKey: ['public', 'meta'],
    enabled: options?.enabled ?? true,
    queryFn: async () => getData(await api.public.meta.$get(), 'public instance metadata'),
    staleTime: 5 * 60 * 1000,
  });

export const useGetInvitationInfo = (invitationId: string) =>
  useQuery({
    queryKey: ['public', 'invitations', invitationId],
    queryFn: async () => getData(await api.public.invitations[':id'].$get({ param: { id: invitationId } }), 'invitation'),
  });

/** Whether a `/<slug>` path names a wiki (current or previous slug) under shared tenancy. */
export const useWikiSlugInUse = (slug: string, options: { enabled: boolean }) =>
  useQuery({
    queryKey: ['public', 'sites', 'resolve', slug],
    enabled: options.enabled,
    queryFn: async () => (await api.public.sites.resolve.$get({ query: { slug } })).ok,
    staleTime: 60 * 1000,
  });
