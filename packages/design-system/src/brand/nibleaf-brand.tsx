import type { ComponentProps } from 'react';
import { cn } from '../lib/utils';
import { useBrand } from './brand-context';

/** The built-in mark: a Z on an ink tile, or bare in `currentColor`. */
function BuiltInMark({ className, title, variant = 'tile', ...props }: ComponentProps<'svg'> & { title: string; variant?: 'tile' | 'bare' }) {
  return (
    <svg
      aria-label={title}
      className={cn(variant === 'tile' && 'overflow-hidden rounded-[22%]', className)}
      role="img"
      viewBox="0 0 512 512"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      {variant === 'tile' ? <rect fill="#181612" height="512" rx="104" width="512" /> : null}
      <path
        d="M152 148H360L152 364H360"
        fill="none"
        stroke={variant === 'tile' ? '#FBF7EE' : 'currentColor'}
        strokeLinecap="square"
        strokeLinejoin="miter"
        strokeWidth="72"
      />
    </svg>
  );
}

/** The instance mark: its custom image when the brand has one, otherwise the built-in mark. Defaults to the provided brand. */
export function BrandMark({ name, src, className, variant, decorative }: BrandMarkProps) {
  const brand = useBrand();
  const label = name ?? brand.name;
  const image = src === undefined ? brand.markUrl : src;
  return image ? (
    <img alt={decorative ? '' : label} aria-hidden={decorative} className={cn('object-contain', className)} src={image} />
  ) : (
    <BuiltInMark aria-hidden={decorative} className={className} title={label} variant={variant} />
  );
}

/** `decorative`: hide the mark from assistive tech when adjacent text already names the brand. */
export interface BrandMarkProps {
  name?: string;
  src?: string | null;
  className?: string;
  variant?: 'tile' | 'bare';
  decorative?: boolean;
}

/** The instance name set as a wordmark, always in its Latin form. Defaults to the provided brand. */
export function BrandWordmark({ name, className, ...props }: ComponentProps<'span'> & { name?: string }) {
  const brand = useBrand();
  const label = name ?? brand.name;
  return (
    <span
      aria-label={label}
      className={cn('inline-block select-none font-extrabold leading-none tracking-normal', className)}
      dir="ltr"
      role="img"
      {...props}
    >
      {label}
    </span>
  );
}
