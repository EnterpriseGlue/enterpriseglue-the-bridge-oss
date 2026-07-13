import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { AuditLog } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuditLog.js';
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

  it('does not disable global platform mappings during tenant-scoped retirement', async () => {
    vi.spyOn(legacyMappingCoverageService, 'getRetirementReadiness').mockResolvedValue({ ready: true, activeLegacyMappingCount: 0, verifiedReplacementCount: 0, blockers: [] });
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
});
