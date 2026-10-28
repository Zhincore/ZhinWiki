import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { createEnv } from '@t3-oss/env-core';
import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { nitro } from 'nitro/vite';
import { defineConfig, loadEnv } from 'vite';
import { z } from 'zod';
import { bundleAnalysisPlugin } from './scripts/bundle-analysis-plugin.ts';
import { PUBLIC_FILE_CACHE } from './src/lib/cache-control.ts';

// Baseline browser hardening for every dashboard and published-site
// response. The custom server entry adds the per-response nonce-based CSP to
// HTML after TanStack Start has created its streaming response.
const SECURITY_HEADERS = {
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
};

// Unhashed files from public/ get a short shared lifetime. Rules name exact
// files so a published-site page under the same prefix keeps its own policy.
// Hashed /assets/** get Nitro's `public, max-age=31536000, immutable`; every
// other response gets its policy from src/server.ts or the API.
const PUBLIC_DIR = fileURLToPath(new URL('./public', import.meta.url));
const PUBLIC_FILE_RULES = Object.fromEntries(
  readdirSync(PUBLIC_DIR, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => [
      `/${relative(PUBLIC_DIR, join(entry.parentPath, entry.name)).replaceAll('\\', '/')}`,
      { headers: { 'cache-control': PUBLIC_FILE_CACHE } },
    ]),
);

export default defineConfig(({ mode }) => {
  const configEnv = createEnv({
    server: { VITE_API_URL: z.url().default('http://localhost:4311') },
    runtimeEnv: loadEnv(mode, process.cwd(), ''),
    emptyStringAsUndefined: true,
  });
  const apiTarget = configEnv.VITE_API_URL;
  return {
    // Keep the manual i18n groups in the browser bundle. Nitro's generated
    // service namespace must stay in one SSR chunk: Rolldown otherwise splits
    // the TanStack Start entry across a cycle and leaves an invalid
    // `ssr_exports` re-export that fails only when the production server starts.
    environments: {
      client: {
        build: {
          rolldownOptions: {
            output: {
              codeSplitting: {
                groups: [
                  {
                    name: 'public-site-i18n',
                    test: (id) => /\/packages\/i18n\/src\/paraglide\/messages\/site_/.test(id.replaceAll('\\', '/')),
                  },
                  {
                    name: 'standalone-i18n',
                    test: (id) =>
                      /\/packages\/i18n\/src\/paraglide\/messages\/(?:common_loading|error_(?:backhome|badge|title|tryagain|unexpected)|notfound_(?:backhome|badge|body|title))\.js$/.test(
                        id.replaceAll('\\', '/'),
                      ),
                  },
                ],
              },
            },
          },
        },
      },
      ssr: {
        build: {
          rolldownOptions: {
            output: { codeSplitting: false },
          },
        },
      },
    },
    resolve: { tsconfigPaths: true },
    server: {
      port: 4310,
      // Vite's static middleware claims unknown dotted paths before Nitro in
      // development. Route imported media directly to the API at that layer.
      proxy: { '/api/public/assets': { target: apiTarget, changeOrigin: true } },
    },
    plugins: [
      paraglideVitePlugin({
        project: '../../packages/i18n/project.inlang',
        outdir: '../../packages/i18n/src/paraglide',
        emitTsDeclarations: true,
        // site.ts and standalone.ts intentionally import per-message modules
        // for public-site tree shaking. Pin this in development too: Paraglide
        // otherwise defaults to locale modules and deletes those imports.
        outputStructure: 'message-modules',
        strategy: ['cookie', 'preferredLanguage', 'baseLocale'],
        cookieName: 'NIBLEAF_LOCALE',
      }),
      bundleAnalysisPlugin(),
      tailwindcss(),
      // Same-origin /api proxy: the browser only talks to the dashboard origin, so
      // better-auth session cookies stay first-party. All /api/** → the Nibleaf API.
      // Custom-domain serving is handled in src/server.ts (request URL rewrite).
      nitro({
        routeRules: {
          '/**': { headers: SECURITY_HEADERS },
          ...PUBLIC_FILE_RULES,
          // Nitro otherwise treats dotted asset keys as app/static paths before
          // the broad API proxy, leaving imported images as published-site 404s.
          '/api/public/assets/**': { proxy: `${apiTarget}/api/public/assets/**` },
          '/api/**': { proxy: `${apiTarget}/api/**` },
        },
      }),
      tanstackStart(),
      viteReact({ compiler: true }),
    ],
  };
});
