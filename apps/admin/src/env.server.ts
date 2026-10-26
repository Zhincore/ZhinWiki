import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const serverEnv = createEnv({
  server: {
    PORT: z.coerce.number().int().positive().default(4315),
    NITRO_PORT: z.coerce.number().int().positive().optional(),
    APP_URL: z.url({ protocol: /^https?$/ }).default('http://localhost:4310'),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
