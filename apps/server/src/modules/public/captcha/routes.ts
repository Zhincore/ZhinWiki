import { errorResponses } from '@/errors/utils';
import { createRouteConfig } from '@/lib/hono/route-config';

const passthrough = (_: unknown, next: () => Promise<void>) => next();

const captchaRoutes = {
  challenge: createRouteConfig({
    guard: passthrough,
    tags: ['public'],
    description: 'ALTCHA proof-of-work challenge for unauthenticated email sends.',
    responses: { 200: { description: 'ok' }, ...errorResponses },
  }),
};

export default captchaRoutes;
