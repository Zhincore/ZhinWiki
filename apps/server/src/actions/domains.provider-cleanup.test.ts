import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  enabled: vi.fn(),
  deleteCustomHostname: vi.fn(),
  deleteCustomHostnameRoute: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('@nibleaf/database', () => ({ prisma: {} }));
vi.mock('@nibleaf/logger', () => ({ logger: { error: mocks.loggerError } }));
vi.mock('@/env', () => ({ env: {} }));
vi.mock('@/lib/cloudflare-saas', () => ({
  cloudflareSaasEnabled: mocks.enabled,
  createCustomHostname: vi.fn(),
  createCustomHostnameRoute: vi.fn(),
  customHostnameRecords: vi.fn(),
  customHostnameState: vi.fn(),
  deleteCustomHostname: mocks.deleteCustomHostname,
  deleteCustomHostnameRoute: mocks.deleteCustomHostnameRoute,
  getCustomHostname: vi.fn(),
  retryCustomHostname: vi.fn(),
}));
vi.mock('./projects', () => ({ assertProjectInOrg: vi.fn() }));

import { removeProviderDomains } from './domains';

const saas = (id: string, routeId?: string) => ({
  provider: 'CLOUDFLARE_SAAS',
  providerHostnameId: id,
  providerData: routeId ? { nibleafWorkerRouteId: routeId } : null,
});

describe('removeProviderDomains', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enabled.mockReturnValue(true);
    mocks.deleteCustomHostname.mockResolvedValue(undefined);
    mocks.deleteCustomHostnameRoute.mockResolvedValue(undefined);
  });

  it('deletes each Cloudflare hostname and its worker route', async () => {
    await removeProviderDomains([saas('cf-1', 'route-1'), saas('cf-2')]);

    expect(mocks.deleteCustomHostnameRoute).toHaveBeenCalledTimes(1);
    expect(mocks.deleteCustomHostnameRoute).toHaveBeenCalledWith('route-1');
    expect(mocks.deleteCustomHostname).toHaveBeenCalledWith('cf-1');
    expect(mocks.deleteCustomHostname).toHaveBeenCalledWith('cf-2');
  });

  it('logs a failure without rejecting and still removes the other hostnames', async () => {
    mocks.deleteCustomHostname.mockRejectedValueOnce(new Error('cloudflare unavailable')).mockResolvedValue(undefined);

    await expect(removeProviderDomains([saas('cf-1'), saas('cf-2')])).resolves.toBeUndefined();

    expect(mocks.deleteCustomHostname).toHaveBeenCalledTimes(2);
    expect(mocks.loggerError).toHaveBeenCalledTimes(1);
    expect(mocks.loggerError).toHaveBeenCalledWith(expect.objectContaining({ hostnameId: 'cf-1' }), expect.any(String));
  });

  it('ignores other providers and does nothing when Cloudflare is not selected', async () => {
    await removeProviderDomains([{ provider: 'INGRESS', providerHostnameId: 'x', providerData: null }]);
    mocks.enabled.mockReturnValue(false);
    await removeProviderDomains([saas('cf-1')]);

    expect(mocks.deleteCustomHostname).not.toHaveBeenCalled();
  });
});
