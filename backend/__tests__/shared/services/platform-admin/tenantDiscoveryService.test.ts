import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { config } from '@enterpriseglue/shared/config/index.js';
import { TenantDiscoveryService } from '@enterpriseglue/shared/services/platform-admin/TenantDiscoveryService.js';

const getDataSource = vi.hoisted(() => vi.fn());

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource }));

describe('TenantDiscoveryService', () => {
  const originalMode = config.tenancyMode;
  const originalFrontendUrl = config.frontendUrl;

  beforeEach(() => {
    vi.clearAllMocks();
    (config as any).tenancyMode = 'pooled';
    (config as any).frontendUrl = 'https://app.enterpriseglue.test';
  });

  afterEach(() => {
    (config as any).tenancyMode = originalMode;
    (config as any).frontendUrl = originalFrontendUrl;
  });

  it('returns the canonical login route for one verified active domain match without issuing a session', async () => {
    const tenants = {
      findByDiscoveryDomain: vi.fn().mockResolvedValue([{ id: 'tenant-a', slug: 'acme', status: 'active' }]),
      listForUser: vi.fn(),
    };
    const send = vi.fn();
    const service = new TenantDiscoveryService(tenants as any, send);

    await expect(service.request('Person@Acme.example')).resolves.toEqual({
      status: 'resolved',
      tenantSlug: 'acme',
      loginPath: '/t/acme/login',
    });
    expect(getDataSource).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('uses the same public fallback for zero and multiple domain matches', async () => {
    const userRepo = { findOneBy: vi.fn().mockResolvedValue(null) };
    getDataSource.mockResolvedValue({ getRepository: () => userRepo });
    const send = vi.fn();
    const tasks: Array<() => Promise<void>> = [];
    const schedule = (task: () => Promise<void>) => { tasks.push(task); };
    const zero = new TenantDiscoveryService({
      findByDiscoveryDomain: vi.fn().mockResolvedValue([]), listForUser: vi.fn(),
    } as any, send, schedule);
    const multiple = new TenantDiscoveryService({
      findByDiscoveryDomain: vi.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }]), listForUser: vi.fn(),
    } as any, send, schedule);

    const zeroResult = await zero.request('person@unknown.example');
    const multipleResult = await multiple.request('person@shared.example');

    expect(zeroResult).toEqual(multipleResult);
    expect(zeroResult).toMatchObject({ status: 'verification_sent' });
    expect(getDataSource).not.toHaveBeenCalled();
    await Promise.all(tasks.map((task) => task()));
    expect(send).not.toHaveBeenCalled();
  });

  it('stores only a token hash and sends a single-use membership discovery link for an existing user', async () => {
    const challengeRepo = {
      findOneBy: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({ affected: 1 }),
      upsert: vi.fn().mockResolvedValue(undefined),
    };
    const userRepo = { findOneBy: vi.fn().mockResolvedValue({ id: 'user-1', email: 'person@shared.example', firstName: 'Person', isActive: true }) };
    getDataSource.mockResolvedValue({
      getRepository: (entity: { name: string }) => entity.name === 'User' ? userRepo : challengeRepo,
    });
    const tenants = {
      findByDiscoveryDomain: vi.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }]),
      listForUser: vi.fn().mockResolvedValue([{ tenantId: 'a', tenantSlug: 'alpha', tenantName: 'Alpha', tenantStatus: 'active', role: 'member' }]),
    };
    const send = vi.fn().mockResolvedValue({ success: true });
    let scheduledTask: (() => Promise<void>) | undefined;
    const service = new TenantDiscoveryService(tenants as any, send, (task) => { scheduledTask = task; });

    await expect(service.request('person@shared.example')).resolves.toMatchObject({ status: 'verification_sent' });
    expect(send).not.toHaveBeenCalled();
    await scheduledTask!();

    expect(challengeRepo.upsert).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      consumedAt: null,
    }), { conflictPaths: ['userId'] });
    const sentUrl = new URL(send.mock.calls[0][0].discoveryUrl);
    const rawToken = new URLSearchParams(sentUrl.hash.slice(1)).get('discovery_token');
    expect(rawToken).toBeTruthy();
    expect(sentUrl.search).toBe('');
    expect(createHash('sha256').update(rawToken!).digest('hex')).toBe(challengeRepo.upsert.mock.calls[0][0].tokenHash);
    expect(JSON.stringify(challengeRepo.upsert.mock.calls[0][0])).not.toContain(rawToken!);
  });

  it('consumes a valid token once and returns only active memberships', async () => {
    const challengeRepo = {
      findOneBy: vi.fn().mockResolvedValue({ id: 'challenge-1', userId: 'user-1', expiresAt: Date.now() + 60_000, consumedAt: null }),
      update: vi.fn().mockResolvedValue({ affected: 1 }),
    };
    const userRepo = { findOneBy: vi.fn().mockResolvedValue({ id: 'user-1', isActive: true }) };
    getDataSource.mockResolvedValue({
      getRepository: (entity: { name: string }) => entity.name === 'User' ? userRepo : challengeRepo,
    });
    const tenants = {
      findByDiscoveryDomain: vi.fn(),
      listForUser: vi.fn().mockResolvedValue([
        { tenantId: 'a', tenantSlug: 'alpha', tenantName: 'Alpha', tenantStatus: 'active', role: 'member' },
        { tenantId: 'b', tenantSlug: 'bravo', tenantName: 'Bravo', tenantStatus: 'suspended', role: 'admin' },
      ]),
    };
    const service = new TenantDiscoveryService(tenants as any, vi.fn());

    await expect(service.exchange('opaque-token-value-that-is-long-enough')).resolves.toEqual([
      expect.objectContaining({ tenantSlug: 'alpha', tenantStatus: 'active' }),
    ]);
    expect(challengeRepo.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'challenge-1' }),
      expect.objectContaining({ consumedAt: expect.any(Number) }),
    );

    challengeRepo.update.mockResolvedValueOnce({ affected: 0 });
    await expect(service.exchange('opaque-token-value-that-is-long-enough')).rejects.toThrow('Invalid or expired organization discovery token');
  });

  it('rejects expired discovery tokens', async () => {
    const challengeRepo = { findOneBy: vi.fn().mockResolvedValue({ id: 'expired', userId: 'user-1', expiresAt: Date.now() - 1, consumedAt: null }) };
    getDataSource.mockResolvedValue({ getRepository: () => challengeRepo });
    const service = new TenantDiscoveryService({ findByDiscoveryDomain: vi.fn(), listForUser: vi.fn() } as any, vi.fn());

    await expect(service.exchange('expired-token-value-that-is-long-enough')).rejects.toThrow('Invalid or expired organization discovery token');
  });
});
