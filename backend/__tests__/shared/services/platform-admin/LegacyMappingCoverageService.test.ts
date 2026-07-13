import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { AuditLog } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuditLog.js';
import { IdentityEntitlementMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityEntitlementMapping.js';
import { IdentityProvider } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvider.js';
import { RbacRoleAssignment } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRoleAssignment.js';
import { SsoAssignmentMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/SsoAssignmentMapping.js';
import { SsoClaimsMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/SsoClaimsMapping.js';
import { SsoGroupMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/SsoGroupMapping.js';
import { legacyMappingCoverageService } from '@enterpriseglue/shared/services/platform-admin/LegacyMappingCoverageService.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));

describe('LegacyMappingCoverageService', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('fails retirement readiness when a candidate has not been verified', async () => {
    vi.spyOn(legacyMappingCoverageService, 'getCoverage').mockResolvedValue([{
      id: 'legacy-1', family: 'engine_assignment', status: 'replacement_candidate', reason: 'candidate exists', candidateIdentityMappingIds: ['replacement-1'], verification: null,
    }]);

    await expect(legacyMappingCoverageService.getRetirementReadiness('tenant-a')).resolves.toEqual({
      ready: false,
      activeLegacyMappingCount: 1,
      verifiedReplacementCount: 0,
      blockers: [{ id: 'legacy-1', family: 'engine_assignment', reason: 'A current replacement candidate exists but has not been verified.' }],
    });
  });

  it('recognizes an exact legacy email-domain mapping with an equivalent provider-neutral attribute grant', async () => {
    const getRepository = vi.fn((entity) => {
      if (entity === SsoClaimsMapping) return { find: vi.fn().mockResolvedValue([{ id: 'legacy-domain', providerId: null, claimType: 'email_domain', claimKey: 'email', claimValue: '*@enterpriseglue.ai', claimOperator: 'equals', targetRole: 'admin', isActive: true }]) };
      if (entity === SsoGroupMapping || entity === SsoAssignmentMapping) return { find: vi.fn().mockResolvedValue([]) };
      if (entity === IdentityEntitlementMapping) return { find: vi.fn().mockResolvedValue([{ id: 'replacement-domain', tenantId: null, providerId: 'provider-1', targetGroupId: 'group-1', entitlementType: 'attribute', externalId: 'email_domain:enterpriseglue.ai', matchOperator: 'exact', isActive: true }]) };
      if (entity === IdentityProvider) return { find: vi.fn().mockResolvedValue([{ id: 'provider-1', configurationJson: '{}' }]) };
      if (entity === RbacRoleAssignment) return { find: vi.fn().mockResolvedValue([{ principalType: 'group', principalId: 'group-1', roleId: 'system.platform.admin', scopeType: 'platform' }]) };
      if (entity === AuditLog) return { find: vi.fn().mockResolvedValue([]) };
      throw new Error(`Unexpected repository: ${(entity as any).name}`);
    });
    (getDataSource as unknown as Mock).mockResolvedValue({ getRepository });

    await expect(legacyMappingCoverageService.getCoverage()).resolves.toEqual([expect.objectContaining({
      id: 'legacy-domain',
      status: 'replacement_candidate',
      candidateIdentityMappingIds: ['replacement-domain'],
    })]);
  });

  it('prefers an explicit conversion lineage record over another shape-equivalent mapping', async () => {
    const auditFind = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        action: 'authz.legacy_mapping_conversion.create',
        details: JSON.stringify({ family: 'group', legacyMappingId: 'legacy-group', identityMappingId: 'recorded-replacement' }),
      }]);
    const getRepository = vi.fn((entity) => {
      if (entity === SsoClaimsMapping || entity === SsoAssignmentMapping) return { find: vi.fn().mockResolvedValue([]) };
      if (entity === SsoGroupMapping) return { find: vi.fn().mockResolvedValue([{ id: 'legacy-group', tenantId: null, providerId: null, claimType: 'group', claimKey: 'groups', claimValue: 'ops', claimOperator: 'equals', targetGroupId: 'group-1', isActive: true }]) };
      if (entity === IdentityEntitlementMapping) return { find: vi.fn().mockResolvedValue([
        { id: 'recorded-replacement', tenantId: null, providerId: 'provider-1', targetGroupId: 'group-1', entitlementType: 'group', externalId: 'ops', matchOperator: 'exact', isActive: true },
        { id: 'unrelated-replacement', tenantId: null, providerId: 'provider-2', targetGroupId: 'group-1', entitlementType: 'group', externalId: 'ops', matchOperator: 'exact', isActive: true },
      ]) };
      if (entity === IdentityProvider) return { find: vi.fn().mockResolvedValue([{ id: 'provider-1', configurationJson: '{}' }, { id: 'provider-2', configurationJson: '{}' }]) };
      if (entity === RbacRoleAssignment) return { find: vi.fn().mockResolvedValue([]) };
      if (entity === AuditLog) return { find: auditFind };
      throw new Error(`Unexpected repository: ${(entity as any).name}`);
    });
    (getDataSource as unknown as Mock).mockResolvedValue({ getRepository });

    await expect(legacyMappingCoverageService.getCoverage()).resolves.toEqual([expect.objectContaining({
      id: 'legacy-group',
      status: 'replacement_candidate',
      candidateIdentityMappingIds: ['recorded-replacement'],
    })]);
  });

  it('recognizes an exact custom mapping only when the replacement provider allowlists that attribute', async () => {
    const legacy = { id: 'legacy-clearance', providerId: null, claimType: 'custom', claimKey: 'clearance', claimValue: 'secret', claimOperator: 'equals', targetRole: 'admin', isActive: true };
    const baseRepositories = (providerConfigurationJson: string) => (entity: unknown) => {
      if (entity === SsoClaimsMapping) return { find: vi.fn().mockResolvedValue([legacy]) };
      if (entity === SsoGroupMapping || entity === SsoAssignmentMapping) return { find: vi.fn().mockResolvedValue([]) };
      if (entity === IdentityEntitlementMapping) return { find: vi.fn().mockResolvedValue([{ id: 'replacement-custom', tenantId: null, providerId: 'provider-1', targetGroupId: 'group-1', entitlementType: 'attribute', externalId: 'attribute:clearance:secret', matchOperator: 'exact', isActive: true }]) };
      if (entity === IdentityProvider) return { find: vi.fn().mockResolvedValue([{ id: 'provider-1', configurationJson: providerConfigurationJson }]) };
      if (entity === RbacRoleAssignment) return { find: vi.fn().mockResolvedValue([{ principalType: 'group', principalId: 'group-1', roleId: 'system.platform.admin', scopeType: 'platform' }]) };
      if (entity === AuditLog) return { find: vi.fn().mockResolvedValue([]) };
      throw new Error(`Unexpected repository: ${(entity as any).name}`);
    };

    (getDataSource as unknown as Mock).mockResolvedValue({ getRepository: vi.fn(baseRepositories(JSON.stringify({ authorizationAttributeKeys: ['clearance'] }))) });
    await expect(legacyMappingCoverageService.getCoverage()).resolves.toEqual([expect.objectContaining({ status: 'replacement_candidate', candidateIdentityMappingIds: ['replacement-custom'] })]);

    (getDataSource as unknown as Mock).mockResolvedValue({ getRepository: vi.fn(baseRepositories('{}')) });
    await expect(legacyMappingCoverageService.getCoverage()).resolves.toEqual([expect.objectContaining({
      status: 'manual_redesign_required',
      reason: expect.stringContaining('allowlist'),
      candidateIdentityMappingIds: [],
    })]);
  });

  it('does not disable global platform mappings during tenant-scoped retirement', async () => {
    vi.spyOn(legacyMappingCoverageService, 'getRetirementReadiness').mockResolvedValue({ ready: true, activeLegacyMappingCount: 0, verifiedReplacementCount: 0, blockers: [] });
    vi.spyOn(legacyMappingCoverageService, 'getCoverage').mockResolvedValue([]);
    const platformUpdate = vi.fn();
    const groupUpdate = vi.fn().mockResolvedValue({ affected: 2 });
    const engineUpdate = vi.fn().mockResolvedValue({ affected: 3 });
    const auditInsert = vi.fn().mockResolvedValue(undefined);
    const getRepository = vi.fn((entity) => {
      if (entity === SsoClaimsMapping) return { update: platformUpdate };
      if (entity === SsoGroupMapping) return { update: groupUpdate };
      if (entity === SsoAssignmentMapping) return { update: engineUpdate };
      if (entity === AuditLog) return { insert: auditInsert };
      throw new Error(`Unexpected repository: ${(entity as any).name}`);
    });
    (getDataSource as unknown as Mock).mockResolvedValue({ transaction: async (callback: any) => callback({ getRepository }) });

    await expect(legacyMappingCoverageService.retireLegacyMappings('tenant-a', 'admin-1')).resolves.toEqual({ platformRoleMappingsDisabled: 0, groupMappingsDisabled: 2, engineAssignmentMappingsDisabled: 3 });
    expect(platformUpdate).not.toHaveBeenCalled();
    expect(groupUpdate).toHaveBeenCalledOnce();
    expect(engineUpdate).toHaveBeenCalledOnce();
    expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-a', userId: 'admin-1', action: 'authz.legacy_mapping_retirement.disable' }));
  });

  it('rejects tenant-scoped retirement when global platform mappings remain in scope', async () => {
    vi.spyOn(legacyMappingCoverageService, 'getRetirementReadiness').mockResolvedValue({ ready: true, activeLegacyMappingCount: 1, verifiedReplacementCount: 1, blockers: [] });
    vi.spyOn(legacyMappingCoverageService, 'getCoverage').mockResolvedValue([{ id: 'platform-legacy', family: 'platform_role', status: 'replacement_candidate', reason: 'verified', candidateIdentityMappingIds: ['replacement-1'], verification: { candidateIdentityMappingId: 'replacement-1', verifiedById: 'admin-1', verifiedAt: 1, note: 'verified' } }]);

    await expect(legacyMappingCoverageService.retireLegacyMappings('tenant-a', 'admin-1')).rejects.toThrow('Globally scoped platform-role mappings must be retired from global platform scope');
  });

  it('disables global platform mappings only from global retirement scope', async () => {
    vi.spyOn(legacyMappingCoverageService, 'getRetirementReadiness').mockResolvedValue({ ready: true, activeLegacyMappingCount: 1, verifiedReplacementCount: 1, blockers: [] });
    const platformUpdate = vi.fn().mockResolvedValue({ affected: 1 });
    const groupUpdate = vi.fn().mockResolvedValue({ affected: 0 });
    const engineUpdate = vi.fn().mockResolvedValue({ affected: 0 });
    const auditInsert = vi.fn().mockResolvedValue(undefined);
    const getRepository = vi.fn((entity) => {
      if (entity === SsoClaimsMapping) return { update: platformUpdate };
      if (entity === SsoGroupMapping) return { update: groupUpdate };
      if (entity === SsoAssignmentMapping) return { update: engineUpdate };
      if (entity === AuditLog) return { insert: auditInsert };
      throw new Error(`Unexpected repository: ${(entity as any).name}`);
    });
    (getDataSource as unknown as Mock).mockResolvedValue({ transaction: async (callback: any) => callback({ getRepository }) });

    await expect(legacyMappingCoverageService.retireLegacyMappings(null, 'global-admin')).resolves.toEqual({ platformRoleMappingsDisabled: 1, groupMappingsDisabled: 0, engineAssignmentMappingsDisabled: 0 });
    expect(platformUpdate).toHaveBeenCalledOnce();
    expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({ tenantId: null, userId: 'global-admin' }));
  });
});
