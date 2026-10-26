import { instanceBrand } from '@nibleaf/shared/brand/server';
import { createServerFn } from '@tanstack/react-start';

export const getBrandFn = createServerFn({ method: 'GET' }).handler(() => instanceBrand());
