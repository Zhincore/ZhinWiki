import { env } from '@/env';

export const GITHUB_URL = env.VITE_GITHUB_URL;
// Star counts are fetched live (with an in-memory cache) via getGithubStarsFn().
// in lib/marketing-seo.ts — no hardcoded constant.

export { siteHref } from './site-paths';
