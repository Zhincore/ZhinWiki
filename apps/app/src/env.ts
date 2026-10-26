import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const env = createEnv({
  clientPrefix: 'VITE_',
  client: {
    VITE_GITHUB_URL: z.url().default('https://github.com/lord007tn/nibleaf'),
  },
  runtimeEnv: {
    VITE_GITHUB_URL: import.meta.env.VITE_GITHUB_URL,
  },
  emptyStringAsUndefined: true,
});
