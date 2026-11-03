import { describe, expect, it } from 'vitest';
import {
  MAX_REDIRECT_CHAIN_LENGTH,
  MAX_REDIRECT_RULES,
  normalizeRedirectPath,
  resolveRedirectTarget,
  validateRedirectGraph,
  validateSnapshotRedirects,
} from './redirects';
import type { SiteSnapshot, SnapshotPage } from './site';

const routes = [
  { path: 'current', canonicalPath: 'current', languageCode: 'en' },
  { path: 'guides', canonicalPath: 'guides/start', languageCode: 'en' },
  { path: 'guides/start', canonicalPath: 'guides/start', languageCode: 'en' },
];

describe('validateRedirectGraph', () => {
  it('normalizes a direct rule and permits a bounded HTTP(S) external target', () => {
    expect(validateRedirectGraph([{ from: '/old///', to: '/current/' }], { routes, defaultLanguage: 'en' })).toEqual({
      redirects: [{ from: '/old', to: '/current' }],
      issues: [],
    });
    expect(validateRedirectGraph([{ from: '/old', to: 'https://example.com/docs?q=1#top' }]).redirects).toEqual([
      { from: '/old', to: 'https://example.com/docs?q=1#top' },
    ]);
  });

  it('flattens internal chains and composes configured query/fragment intent', () => {
    const graph = validateRedirectGraph(
      [
        { from: '/old', to: '/renamed?campaign=launch' },
        { from: '/renamed', to: '/guides#install' },
      ],
      { routes, defaultLanguage: 'en' },
    );
    expect(graph.issues).toEqual([]);
    expect(graph.redirects).toEqual([
      { from: '/old', to: '/guides/start?campaign=launch#install' },
      { from: '/renamed', to: '/guides/start#install' },
    ]);
    expect(resolveRedirectTarget(graph.redirects, '/old/')).toBe('/guides/start?campaign=launch#install');
  });

  it('reports duplicate/conflicting sources, self redirects, and a multi-node cycle with the path sequence', () => {
    const result = validateRedirectGraph([
      { from: '/same', to: '/one' },
      { from: 'same/', to: '/two' },
      { from: '/self', to: '/self?x=1' },
      { from: '/a', to: '/b' },
      { from: '/b', to: '/c' },
      { from: '/c', to: '/a' },
    ]);
    expect(result.redirects).toEqual([]);
    expect(result.issues.map((entry) => entry.code)).toEqual(expect.arrayContaining(['duplicate-source', 'self-redirect', 'cycle']));
    expect(result.issues.find((entry) => entry.code === 'cycle')?.sequence).toEqual(['/a', '/b', '/c', '/a']);
  });

  it('rejects chains over the limit and accepts every generated acyclic chain up to the limit', () => {
    for (let length = 1; length <= MAX_REDIRECT_CHAIN_LENGTH; length += 1) {
      const chain = Array.from({ length }, (_, index) => ({ from: `/p${index}`, to: index === length - 1 ? '/current' : `/p${index + 1}` }));
      const result = validateRedirectGraph(chain, { routes, defaultLanguage: 'en' });
      expect(result.issues, `length ${length}`).toEqual([]);
      expect(result.redirects[0]).toEqual({ from: '/p0', to: '/current' });
    }
    const excessive = Array.from({ length: MAX_REDIRECT_CHAIN_LENGTH + 1 }, (_, index) => ({
      from: `/long${index}`,
      to: index === MAX_REDIRECT_CHAIN_LENGTH ? '/current' : `/long${index + 1}`,
    }));
    expect(validateRedirectGraph(excessive, { routes, defaultLanguage: 'en' }).issues.some((entry) => entry.code === 'chain-too-long')).toBe(true);
  });

  it('rejects legacy configurations over the rule-count limit', () => {
    const redirects = Array.from({ length: MAX_REDIRECT_RULES + 1 }, (_, index) => ({ from: `/old-${index}`, to: '/current' }));
    expect(validateRedirectGraph(redirects, { routes, defaultLanguage: 'en' }).issues).toEqual([expect.objectContaining({ code: 'too-many-rules' })]);
  });

  it('rejects malformed paths and URLs', () => {
    const values = [
      { from: '/a?x=1', to: '/current' },
      { from: '/a/../b', to: '/current' },
      { from: '/a', to: 'javascript:alert(1)' },
      { from: '/b', to: '//evil.example/path' },
      { from: '/c', to: 'https://user:pass@example.com/' },
      { from: '/d', to: '/bad%2Fpath' },
    ];
    const result = validateRedirectGraph(values);
    expect(result.redirects).toEqual([]);
    expect(result.issues).toHaveLength(values.length);
    expect(() => normalizeRedirectPath('/caf%C3%A9/')).not.toThrow();
    expect(normalizeRedirectPath('/cafe\u0301/')).toBe('café');
  });

  it('rejects missing/disabled-locale destinations and source collisions', () => {
    const result = validateRedirectGraph(
      [
        { from: '/current', to: '/missing' },
        { from: '/old', to: '/current?lang=fr' },
        { from: '/changelog', to: '/current' },
      ],
      { routes, defaultLanguage: 'en', enabledLanguages: ['en'], reservedPaths: ['changelog'] },
    );
    expect(result.issues.map((entry) => entry.code)).toEqual(expect.arrayContaining(['source-collision', 'destination-not-found', 'invalid-locale']));
  });
});

const page = (input: Partial<SnapshotPage> & Pick<SnapshotPage, 'id' | 'path' | 'languageCode'>): SnapshotPage => ({
  id: input.id,
  parentId: input.parentId ?? null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  languageCode: input.languageCode,
  kind: input.kind ?? 'PAGE',
  title: input.title ?? input.id,
  slug: input.slug ?? input.path.split('/').at(-1) ?? '',
  path: input.path,
  icon: null,
  description: null,
  content: '',
  config: null,
  translationKey: null,
  position: input.position ?? 0,
  hidden: input.hidden ?? false,
});

const snapshot = (redirects: Array<{ from: string; to: string }>): SiteSnapshot => ({
  project: {
    id: 'project',
    name: 'Docs',
    slug: 'docs',
    description: null,
    icon: null,
    config: { redirects },
    languages: [
      { code: 'en', label: 'English', direction: 'LTR', isDefault: true, enabled: true, config: null },
      { code: 'ar', label: 'Arabic', direction: 'RTL', isDefault: false, enabled: true, config: null },
      { code: 'fr', label: 'French', direction: 'LTR', isDefault: false, enabled: false, config: null },
    ],
  },
  pages: [
    page({ id: 'group', path: 'getting-started', languageCode: 'en', kind: 'GROUP', position: 0 }),
    page({ id: 'intro', path: 'getting-started/intro', languageCode: 'en', parentId: 'group', position: 0 }),
    page({ id: 'secret', path: 'secret', languageCode: 'en', hidden: true }),
    page({ id: 'ar-intro', path: 'البدء/مقدمة', languageCode: 'ar' }),
    page({ id: 'fr-page', path: 'bonjour', languageCode: 'fr' }),
    page({ id: 'guide', path: 'guide', languageCode: 'en' }),
  ],
  generatedAt: '2026-01-01T00:00:00.000Z',
});

describe('validateSnapshotRedirects', () => {
  it('canonicalizes group aliases into direct snapshot redirects', () => {
    const result = validateSnapshotRedirects(
      snapshot([
        { from: '/legacy', to: '/getting-started' },
        { from: '/old-guide', to: '/guide#usage' },
        { from: '/قديم', to: '/البدء/مقدمة?lang=ar' },
      ]),
    );
    expect(result.issues).toEqual([]);
    expect((result.snapshot.project.config as { redirects: unknown }).redirects).toEqual([
      { from: '/legacy', to: '/getting-started/intro' },
      { from: '/old-guide', to: '/guide#usage' },
      { from: '/قديم', to: '/البدء/مقدمة?lang=ar' },
    ]);
  });

  it('blocks hidden/deleted and disabled-locale destinations plus published route collisions', () => {
    const input = snapshot([
      { from: '/getting-started/intro', to: '/guide' },
      { from: '/hidden', to: '/secret' },
      { from: '/disabled', to: '/bonjour?lang=fr' },
      { from: '/deleted', to: '/no-longer-published' },
    ]);
    const result = validateSnapshotRedirects(input);
    expect(result.issues.map((entry) => entry.code)).toEqual(expect.arrayContaining(['source-collision', 'destination-not-found', 'invalid-locale']));
    expect(result.snapshot).toBe(input);
  });

  it('detects reserved route collisions even without redirect sources', () => {
    const input = snapshot([]);
    input.pages.push(
      page({ id: 'reserved-page', path: 'changelog', languageCode: 'en' }),
      page({ id: 'duplicate-guide', path: 'guide', languageCode: 'en' }),
    );
    const result = validateSnapshotRedirects(input);
    expect(result.issues.filter((entry) => entry.code === 'route-collision').map((entry) => entry.sequence[0])).toEqual(
      expect.arrayContaining(['/changelog', '/guide']),
    );
  });
});
