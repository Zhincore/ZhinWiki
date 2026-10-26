import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_URL_META, readAppUrl } from './public-urls';

const loadAppUrl = async () => (await import('./public-urls')).appUrl();

describe('appUrl on the server', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllEnvs());

  it('reads APP_URL at runtime', async () => {
    vi.stubEnv('APP_URL', 'https://docs.example.org');
    expect(await loadAppUrl()).toBe('https://docs.example.org');
  });

  it('defaults to the local dashboard origin', async () => {
    vi.stubEnv('APP_URL', '');
    expect(await loadAppUrl()).toBe('http://localhost:4310');
  });

  it.each(['javascript:alert(1)', 'docs.example.org'])('rejects APP_URL=%s at boot', async (value) => {
    vi.stubEnv('APP_URL', value);
    await expect(loadAppUrl()).rejects.toThrow();
  });
});

describe('readAppUrl', () => {
  const documentWith = (meta: Record<string, string>) =>
    ({
      querySelector: (selector: string) => {
        const name = /^meta\[name="([^"]+)"\]$/.exec(selector)?.[1];
        return name && name in meta ? { content: meta[name] } : null;
      },
    }) as Pick<Document, 'querySelector'>;

  it('reads the meta tag the root document rendered', () => {
    expect(readAppUrl(documentWith({ [APP_URL_META]: 'https://docs.example.org' }))).toBe('https://docs.example.org');
  });

  it('fails loudly instead of guessing when the document has no URL', () => {
    expect(() => readAppUrl(documentWith({}))).toThrow('missing its app URL meta tag');
  });
});
