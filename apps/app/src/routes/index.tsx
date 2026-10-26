import { createFileRoute } from '@tanstack/react-router';
import { WelcomePage } from '@/components/welcome-page';
import { getSessionFn } from '@/functions/session';
import { brandedTitle } from '@/lib/brand';

export const Route = createFileRoute('/')({
  loader: async () => ({ signedIn: Boolean(await getSessionFn()) }),
  head: ({ matches }) => ({ meta: [{ title: brandedTitle(matches, 'Welcome') }] }),
  component: Welcome,
});

function Welcome() {
  const { signedIn } = Route.useLoaderData();
  return <WelcomePage signedIn={signedIn} />;
}
