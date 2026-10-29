import { describe, expect, it } from 'vitest';
import { rewriteSiteInput, rewriteSiteOutput } from './custom-domain-rewrite';

describe('custom-domain router rewrites', () => {
  const projectId = 'project-123';

  it('maps public custom-domain paths to the internal published-site route', () => {
    expect(rewriteSiteInput(new URL('https://docs.example.com/'), projectId).href).toBe('https://docs.example.com/sites/project-123');
    expect(rewriteSiteInput(new URL('https://docs.example.com/guides/start?lang=ar'), projectId).href).toBe(
      'https://docs.example.com/sites/project-123/guides/start?lang=ar',
    );
  });

  it('does not double-prefix an internal route', () => {
    expect(rewriteSiteInput(new URL('https://docs.example.com/sites/project-123/welcome'), projectId).pathname).toBe('/sites/project-123/welcome');
  });

  it('maps internal router hrefs back to clean public paths', () => {
    expect(rewriteSiteOutput(new URL('https://docs.example.com/sites/project-123'), projectId).pathname).toBe('/');
    expect(rewriteSiteOutput(new URL('https://docs.example.com/sites/project-123/welcome?lang=en'), projectId).href).toBe(
      'https://docs.example.com/welcome?lang=en',
    );
  });

  it('maps only paths under a /<slug> base and restores that base on output', () => {
    const url = (path: string) => new URL(`https://wiki.example.com${path}`);
    expect(rewriteSiteInput(url('/handbook'), projectId, '/handbook').pathname).toBe('/sites/project-123');
    expect(rewriteSiteInput(url('/handbook/guides/start?lang=ar'), projectId, '/handbook').href).toBe(
      'https://wiki.example.com/sites/project-123/guides/start?lang=ar',
    );
    expect(rewriteSiteInput(url('/handbook-2/start'), projectId, '/handbook').pathname).toBe('/handbook-2/start');
    expect(rewriteSiteInput(url('/app/sites'), projectId, '/handbook').pathname).toBe('/app/sites');
    expect(rewriteSiteOutput(url('/sites/project-123'), projectId, '/handbook').pathname).toBe('/handbook');
    expect(rewriteSiteOutput(url('/sites/project-123/welcome?lang=en'), projectId, '/handbook').href).toBe(
      'https://wiki.example.com/handbook/welcome?lang=en',
    );
  });
});
