import type { Tenancy } from '@nibleaf/shared/rbac';
import { rootRouteId, useLoaderData } from '@tanstack/react-router';

/** The instance tenancy the root route loaded from runtime env. */
export const useTenancy = (): Tenancy => useLoaderData({ from: rootRouteId }).tenancy;
