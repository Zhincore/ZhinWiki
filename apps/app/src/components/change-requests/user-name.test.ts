import { describe, expect, it } from 'vitest';
import { displayName } from './user-name';

describe('displayName', () => {
  it('falls back for a missing user or a blank name', () => {
    expect(displayName(null, 'Someone')).toBe('Someone');
    expect(displayName({ name: '' }, 'Someone')).toBe('Someone');
    expect(displayName({ name: '  ' }, 'Someone')).toBe('Someone');
  });

  it('shows a trimmed name', () => {
    expect(displayName({ name: ' Ada ' }, 'Someone')).toBe('Ada');
  });
});
