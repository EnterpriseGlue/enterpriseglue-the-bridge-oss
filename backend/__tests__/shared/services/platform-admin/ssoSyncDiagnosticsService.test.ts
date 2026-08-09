import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { SsoNormalizedIdentity, SsoSyncEvent, SsoSyncRun } from '@enterpriseglue/shared/db/entities/index.js';
import { setSsoSyncDiagnosticsClockForTest, ssoSyncDiagnosticsService } from '@enterpriseglue/shared/services/platform-admin/SsoSyncDiagnosticsService.js';
import { ssoProviderIdentityCheckService } from '@enterpriseglue/shared/services/platform-admin/SsoProviderIdentityCheckService.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));
vi.mock('@enterpriseglue/shared/services/platform-admin/SsoProviderIdentityCheckService.js', () => ({ ssoProviderIdentityCheckService: { checkIdentity: vi.fn() } }));

describe('ssoSyncDiagnosticsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSsoSyncDiagnosticsClockForTest(() => 1_000);
  });

  it('records a provider-neutral sync run lifecycle without persisting sensitive details', async () => {
    const insertRun = vi.fn(); const updateRun = vi.fn(); const insertEvent = vi.fn();
    vi.mocked(getDataSource).mockResolvedValue({ getRepository: (entity: unknown) => entity === SsoSyncRun ? { insert: insertRun, update: updateRun } : { insert: insertEvent } } as never);
    const runId = await ssoSyncDiagnosticsService.startRun({ providerId: 'oidc-main', trigger: 'login', details: { accessToken: 'secret-token', source: 'direct_oidc' } });
    await ssoSyncDiagnosticsService.completeRun(runId, { providerId: 'oidc-main', groupMembershipsCreated: 2, details: { source: 'direct_oidc' } });
    expect(insertRun).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'oidc-main', trigger: 'login' }));
    expect(insertEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'identity_provider_sync_started', details: expect.stringContaining('[redacted]') }));
    expect(updateRun).toHaveBeenCalledWith({ id: runId }, expect.objectContaining({ status: 'success', groupMembershipsCreated: 2 }));
  });

  it('records direct-provider identity status checks', async () => {
    const insertRun = vi.fn(); const updateIdentity = vi.fn(); const insertEvent = vi.fn(); const updateRun = vi.fn();
    const qb: any = { where: vi.fn(), orderBy: vi.fn(), addOrderBy: vi.fn(), take: vi.fn(), andWhere: vi.fn(), getMany: vi.fn().mockResolvedValue([{ id: 'identity-1', tenantId: null, providerId: 'oidc-main', providerSubject: 'subject-1', subjectClaim: 'sub', userId: 'user-1', providerStatus: 'active', email: 'old@example.test', displayName: null, firstName: null, lastName: null }]) };
    Object.values(qb).filter((value) => typeof value === 'function' && value !== qb.getMany).forEach((fn: any) => fn.mockReturnValue(qb));
    vi.mocked(getDataSource).mockResolvedValue({ getRepository: (entity: unknown) => {
      if (entity === SsoSyncRun) return { insert: insertRun, update: updateRun };
      if (entity === SsoNormalizedIdentity) return { createQueryBuilder: vi.fn(() => qb), update: updateIdentity };
      if (entity === SsoSyncEvent) return { insert: insertEvent };
      return {};
    } } as never);
    vi.mocked(ssoProviderIdentityCheckService.checkIdentity).mockResolvedValue({ status: 'active', reason: 'Provider identity is active', checkedAt: 2_000, profile: { email: 'new@example.test' } });
    const result = await ssoSyncDiagnosticsService.runProviderIdentityCheck({ providerId: 'oidc-main', trigger: 'manual' });
    expect(result).toMatchObject({ scannedIdentities: 1, checkedIdentities: 1, activeIdentities: 1 });
    expect(updateIdentity).toHaveBeenCalledWith({ id: 'identity-1' }, expect.objectContaining({ providerStatus: 'active', email: 'new@example.test' }));
    expect(insertEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'identity_provider_health_check.identity_active' }));
  });

  it('stores only stable public diagnostics for unexpected identity failures', async () => {
    const updateRun = vi.fn();
    const insertEvent = vi.fn();
    vi.mocked(getDataSource).mockResolvedValue({
      getRepository: (entity: unknown) => entity === SsoSyncRun ? { update: updateRun } : { insert: insertEvent },
    } as never);
    const canary = 'file:///run/secrets/idp Bearer secret-value https://directory.internal';

    await ssoSyncDiagnosticsService.failRun('run-1', new Error(canary), {
      providerId: 'oidc-main',
      details: { kind: 'config_bundle_identity_replay' },
    });

    expect(updateRun).toHaveBeenCalledWith({ id: 'run-1' }, expect.objectContaining({
      errorCode: 'IdentityProviderSyncError',
      errorMessage: 'Identity provider synchronization failed; inspect protected server logs',
    }));
    expect(insertEvent).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Identity provider synchronization failed; inspect protected server logs',
    }));
    expect(JSON.stringify([updateRun.mock.calls, insertEvent.mock.calls])).not.toContain(canary);
    expect(JSON.stringify([updateRun.mock.calls, insertEvent.mock.calls])).not.toContain('secret-value');
  });
});
