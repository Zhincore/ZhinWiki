import { createFileRoute } from '@tanstack/react-router';
import { TermsPage } from '@/components/terms-page';
import { brandedTitle } from '@/lib/brand';

export const Route = createFileRoute('/terms')({
  head: ({ matches }) => ({ meta: [{ title: brandedTitle(matches, 'Terms of Service') }] }),
  component: TermsPage,
});
