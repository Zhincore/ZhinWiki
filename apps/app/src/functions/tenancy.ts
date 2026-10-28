import { keys } from '@nibleaf/auth/keys.server';
import { createServerFn } from '@tanstack/react-start';

export const getTenancyFn = createServerFn({ method: 'GET' }).handler(() => keys().TENANCY);
