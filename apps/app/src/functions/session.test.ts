import { describe, expect, it, vi } from 'vitest';

vi.mock('@nibleaf/auth/server', () => ({ auth: { api: { getSession: vi.fn() } } }));

import { isSupportSession } from './session';

describe('isSupportSession', () => {
  it.each([
    [{ session: { impersonatedBy: 'operator-1' } }, true],
    [{ session: { impersonatedBy: null } }, false],
    [{ session: {} }, false],
    [null, false],
  ])('%j -> %s', (session, expected) => {
    expect(isSupportSession(session)).toBe(expected);
  });
});
