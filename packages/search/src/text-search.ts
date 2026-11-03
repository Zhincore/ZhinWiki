/** Postgres text search configurations by base language code; every one ships with Postgres 17. */
const TEXT_SEARCH_CONFIGS = {
  ar: 'arabic',
  ca: 'catalan',
  da: 'danish',
  de: 'german',
  el: 'greek',
  en: 'english',
  es: 'spanish',
  eu: 'basque',
  fi: 'finnish',
  fr: 'french',
  ga: 'irish',
  hi: 'hindi',
  hu: 'hungarian',
  hy: 'armenian',
  id: 'indonesian',
  it: 'italian',
  lt: 'lithuanian',
  nb: 'norwegian',
  ne: 'nepali',
  nl: 'dutch',
  nn: 'norwegian',
  no: 'norwegian',
  pt: 'portuguese',
  ro: 'romanian',
  ru: 'russian',
  sr: 'serbian',
  sv: 'swedish',
  ta: 'tamil',
  tr: 'turkish',
  yi: 'yiddish',
} as const;

export type TextSearchConfig = (typeof TEXT_SEARCH_CONFIGS)[keyof typeof TEXT_SEARCH_CONFIGS] | 'simple';

/** Every configuration `textSearchConfig` can return. */
export const textSearchConfigs: readonly TextSearchConfig[] = [...new Set<TextSearchConfig>([...Object.values(TEXT_SEARCH_CONFIGS), 'simple'])];

/** Postgres text search configuration for a page language (`pt-BR` → portuguese); `simple` when none fits. */
export const textSearchConfig = (languageCode: string): TextSearchConfig => {
  const base = languageCode.toLowerCase().split(/[-_]/)[0] ?? '';
  return TEXT_SEARCH_CONFIGS[base as keyof typeof TEXT_SEARCH_CONFIGS] ?? 'simple';
};
