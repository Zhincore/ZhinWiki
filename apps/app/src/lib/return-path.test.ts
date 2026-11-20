import { describe, expect, it } from 'vitest';
import { safeReturnPath } from './return-path';

describe('safeReturnPath', () => {
  it('keeps a same-origin path with its query', () => {
    expect(safeReturnPath('/app/projects/p1/editor?page=abc')).toBe('/app/projects/p1/editor?page=abc');
  });

  it.each(['https://evil.example/app', '//evil.example', '/\\evil.example', 'app', '', '/app\nLocation: x', 42, undefined])('drops %j', (value) => {
    expect(safeReturnPath(value)).toBeUndefined();
  });
});
