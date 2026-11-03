import { useT } from '@nibleaf/i18n/react';

/** A user's name, or `fallback` when the user is gone or their name is blank. */
export const displayName = (user: { name: string } | null | undefined, fallback: string) => user?.name.trim() || fallback;

/** `displayName` with the localized unknown-author fallback. */
export const useUserName = () => {
  const t = useT();
  return (user: { name: string } | null | undefined) => displayName(user, t('changeRequest.unknownAuthor'));
};
