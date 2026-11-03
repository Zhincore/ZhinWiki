import { Input } from '@nibleaf/design-system/components/ui/input';
import { useLocale } from '@nibleaf/i18n/react';
import { useMemo, useState } from 'react';
import type { getWikiDirectoryFn } from '@/functions/wiki-directory';

/** A wiki listed on the instance homepage. */
export type WikiDirectoryEntry = NonNullable<Awaited<ReturnType<typeof getWikiDirectoryFn>>>[number];

function WikiMark({ wiki }: { wiki: WikiDirectoryEntry }) {
  if (wiki.logo) {
    return <img alt="" className="size-9 shrink-0 rounded-md object-contain" loading="lazy" referrerPolicy="no-referrer" src={wiki.logo} />;
  }
  return (
    <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted font-semibold text-lg">
      {wiki.icon ?? wiki.name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

/** Filterable grid of the instance's public wikis. */
export function WikiDirectory({ wikis }: { wikis: WikiDirectoryEntry[] }) {
  const { locale, t } = useLocale();
  const [query, setQuery] = useState('');
  const shown = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase(locale);
    if (!needle) return wikis;
    return wikis.filter((wiki) => `${wiki.name}\n${wiki.description ?? ''}`.toLocaleLowerCase(locale).includes(needle));
  }, [wikis, query, locale]);

  return (
    <section aria-labelledby="wiki-directory-heading" className="mt-14 w-full max-w-5xl text-start">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold text-xl tracking-tight" id="wiki-directory-heading">
          {t('welcome.directory.heading')}
        </h2>
        {wikis.length > 0 ? (
          <Input
            aria-label={t('welcome.directory.filter')}
            className="w-full sm:w-64"
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('welcome.directory.filter')}
            type="search"
            value={query}
          />
        ) : null}
      </div>
      {shown.length > 0 ? (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((wiki) => (
            <li key={wiki.id}>
              <a
                className="flex h-full items-start gap-3 rounded-lg border bg-card p-4 transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                href={wiki.url}
              >
                <WikiMark wiki={wiki} />
                <span className="min-w-0">
                  <span className="block truncate font-medium" dir="auto">
                    {wiki.name}
                  </span>
                  {wiki.description ? (
                    <span className="mt-1 line-clamp-2 block text-muted-foreground text-sm" dir="auto">
                      {wiki.description}
                    </span>
                  ) : null}
                </span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 rounded-lg border border-dashed p-6 text-center text-muted-foreground text-sm">
          {t(wikis.length > 0 ? 'welcome.directory.noMatch' : 'welcome.directory.empty')}
        </p>
      )}
    </section>
  );
}
