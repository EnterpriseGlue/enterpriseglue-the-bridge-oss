import { describe, expect, it } from 'vitest';
import { formatDeploymentEligibility, formatProjectEngineTargetDiagnostics, formatProjectEngineTargetExternalRefs, formatProjectEngineTargetModes, isSourceOwnedProjectTarget } from '@src/features/platform-admin/pages/access-control/projectEngineTargetPresentation';
import type { ProjectEngineTarget } from '@src/features/platform-admin/hooks/useAuthzApi';

const target: ProjectEngineTarget = {
  id: 'target-1', projectId: 'project-1', projectName: 'Payments', engineId: 'engine-1', engineName: 'Production', engineBaseUrl: null,
  environment: null, status: 'active', source: 'external', sourceRef: 'external:target-1', ownershipMode: 'manual', sourceHash: null, lastAppliedAt: null, driftStatus: null,
  externalSystemId: 'system-1', externalProjectId: 'external-project-1', externalEngineId: 'external-engine-1', externalTargetId: 'external-target-1',
  allowManualDeploy: false, allowCiDeploy: true, allowApiDeploy: true, allowImport: false, createdById: null, approvedById: null, approvalStatus: 'approved', approvedAt: null,
  policyTags: ['production'], diagnostics: { owner: 'platform', nested: { safe: true } }, lastSeenAt: null, createdAt: 1, updatedAt: 1,
};

describe('projectEngineTargetPresentation', () => {
  it('keeps source-owned targets immutable while allowing config-warning rows to be reconciled locally', () => {
    expect(isSourceOwnedProjectTarget(target)).toBe(true);
    expect(isSourceOwnedProjectTarget({ ...target, source: 'config', ownershipMode: 'config_locked' })).toBe(true);
    expect(isSourceOwnedProjectTarget({ ...target, source: 'config', ownershipMode: 'config_warn' })).toBe(false);
  });

  it('renders compact deployment mode, external reference, diagnostic, and eligibility summaries', () => {
    expect(formatProjectEngineTargetModes(target)).toBe('CI, API');
    expect(formatProjectEngineTargetExternalRefs(target)).toBe('system=system-1, project=external-project-1, engine=external-engine-1, target=external-target-1');
    expect(formatProjectEngineTargetDiagnostics(target)).toBe('Policies: production | owner: platform, nested: {"safe":true}');
    expect(formatDeploymentEligibility({
      allowed: false, decision: 'deny', mode: 'manual', projectId: 'project-1', engineId: 'engine-1', checks: [], reasons: ['target_archived'],
    })).toBe('target_archived');
  });
});
