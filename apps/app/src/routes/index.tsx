import { createFileRoute } from '@tanstack/react-router';
import { WelcomePage } from '@/components/welcome-page';
import { getSessionFn } from '@/functions/session';
import { getWikiDirectoryFn } from '@/functions/wiki-directory';
import { brandedTitle } from '@/lib/brand';

export const Route = createFileRoute('/')({
  loader: async () => {
    const [session, wikis] = await Promise.all([getSessionFn(), getWikiDirectoryFn()]);
    return { signedIn: Boolean(session), wikis };
  },
  head: ({ matches }) => ({ meta: [{ title: brandedTitle(matches, 'Welcome') }] }),
  component: Welcome,
});

function Welcome() {
  const { signedIn, wikis } = Route.useLoaderData();
  return <WelcomePage signedIn={signedIn} wikis={wikis} />;
}
