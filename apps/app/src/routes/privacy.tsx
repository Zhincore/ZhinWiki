import { createFileRoute } from '@tanstack/react-router';
import { PrivacyPage } from '@/components/privacy-page';
import { brandedTitle } from '@/lib/brand';

export const Route = createFileRoute('/privacy')({
  head: ({ matches }) => ({ meta: [{ title: brandedTitle(matches, 'Privacy Policy') }] }),
  component: PrivacyPage,
});
