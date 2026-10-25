import { BrandMark } from '@nibleaf/design-system/brand';
import { useBrand } from '@/lib/brand';

/** This instance's mark (custom image or built-in). */
export function InstanceMark({ className, variant }: { className?: string; variant?: 'tile' | 'bare' }) {
  const brand = useBrand();
  return <BrandMark className={className} name={brand.name} src={brand.markUrl} variant={variant} />;
}

/** This instance's product name as text. */
export function InstanceName({ className }: { className?: string }) {
  return <span className={className}>{useBrand().name}</span>;
}
