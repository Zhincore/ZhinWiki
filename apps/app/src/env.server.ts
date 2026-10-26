import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

/** Absolute http(s) origin the browser is sent to. */
const publicUrl = z.url({ protocol: /^https?$/ });

export const serverEnv = createEnv({
  server: {
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4310),
    NITRO_PORT: z.coerce.number().int().positive().optional(),
    APP_URL: publicUrl.default('http://localhost:4310'),
    ADMIN_URL: publicUrl.default('http://localhost:4315'),
    SITE_BASE_DOMAIN: z.string().optional(),
    TRUSTED_PROXY_HOPS: z.coerce.number().int().nonnegative().default(0),
    INTERNAL_API_SECRET: z.string().optional(),
    CUSTOM_DOMAIN_EDGE_SECRET: z.string().optional(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
