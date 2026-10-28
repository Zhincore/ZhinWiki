import { brandAccentCss } from '@nibleaf/shared/brand';
import { useBrand } from './brand-context';

/** `<style>` applying the provided brand's dashboard accent; nothing when the brand keeps the built-in one. */
export function BrandAccentStyle() {
  const { accentColor } = useBrand();
  const css = accentColor ? brandAccentCss(accentColor) : '';
  return css ? <style>{css}</style> : null;
}
