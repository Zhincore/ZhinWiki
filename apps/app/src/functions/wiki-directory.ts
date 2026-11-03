import { keys } from '@nibleaf/auth/keys.server';
import { createServerFn } from '@tanstack/react-start';
import { getData } from '@/hooks/api/client-helpers';
import { api } from '@/services/api';

/** Public, published wikis for the instance homepage; null outside shared tenancy or when the API fails. */
export const getWikiDirectoryFn = createServerFn({ method: 'GET' }).handler(async () => {
  if (keys().TENANCY !== 'shared') return null;
  try {
    return await getData(await api.public.sites.directory.$get(), 'wiki directory');
  } catch {
    return null;
  }
});
