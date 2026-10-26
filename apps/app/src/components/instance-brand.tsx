import { BrandMark, type BrandMarkProps } from '@nibleaf/design-system/brand';
import { useBrand } from '@/lib/brand';

/** This instance's mark (custom image or built-in). */
export function InstanceMark(props: Omit<BrandMarkProps, 'name' | 'src'>) {
  const brand = useBrand();
  return <BrandMark {...props} name={brand.name} src={brand.markUrl} />;
}

/** This instance's product name as text. */
export function InstanceName({ className }: { className?: string }) {
  return <span className={className}>{useBrand().name}</span>;
}
