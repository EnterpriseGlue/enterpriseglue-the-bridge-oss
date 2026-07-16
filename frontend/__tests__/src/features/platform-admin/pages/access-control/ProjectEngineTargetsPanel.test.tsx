import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProjectEngineTargetsPanel } from '@src/features/platform-admin/pages/access-control/ProjectEngineTargetsPanel';

const externalTarget: React.ComponentProps<typeof ProjectEngineTargetsPanel>['targets'][number] = {
  id: 'target-1', tenantId: 'tenant-1', projectId: 'project-1', projectName: 'Payments',
  engineId: 'engine-1', engineName: 'Production engine', engineBaseUrl: null,
  environment: null, status: 'active', source: 'external', sourceRef: 'external:target-1',
  ownershipMode: 'manual', sourceHash: null, lastAppliedAt: null, driftStatus: null,
  externalSystemId: 'system-1', externalProjectId: 'external-project-1', externalEngineId: 'external-engine-1', externalTargetId: 'external-target-1',
  allowManualDeploy: false, allowCiDeploy: true, allowApiDeploy: true, allowImport: false,
  createdById: null, approvedById: null, approvalStatus: 'approved', approvedAt: 1,
  policyTags: ['production'], diagnostics: { source: 'external' }, lastSeenAt: 1,
  createdAt: 1, updatedAt: 1,
};

const allowedDecision = {
  actionId: 'platform.project-engine-targets.manage', permissionId: 'platform:project-engine-targets:manage',
  resourceType: 'project_engine_target' as const, resourceId: null, allowed: true, state: 'allowed' as const, reason: 'Allowed',
};

function renderPanel(overrides: Partial<React.ComponentProps<typeof ProjectEngineTargetsPanel>> = {}) {
  const props: React.ComponentProps<typeof ProjectEngineTargetsPanel> = {
    targets: [externalTarget], loading: false, pending: false, syncSummary: null, eligibilityResult: null,
    onCreate: vi.fn(), onEdit: vi.fn(), onArchive: vi.fn(), onSyncLegacy: vi.fn(), onEvaluate: vi.fn(),
    canManage: true, canEvaluate: true,
    externalProjectTargetApiUpsertDecision: allowedDecision,
    externalProjectTargetApiDecommissionDecision: allowedDecision,
    ...overrides,
  };
  render(<ProjectEngineTargetsPanel {...props} />);
  return props;
}

describe('ProjectEngineTargetsPanel', () => {
  it('keeps external targets visible but blocks local edit and archive actions', () => {
    renderPanel();

    expect(screen.getByText('Payments')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Archive' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Edit' })).toHaveAttribute('title', 'Source-owned targets are managed by their external source');
  });

  it('sends the explicit project target and requested mode to eligibility evaluation', () => {
    const props = renderPanel();

    fireEvent.change(screen.getByLabelText('User ID'), { target: { value: ' user-1 ' } });
    fireEvent.change(screen.getByLabelText('Project ID'), { target: { value: ' project-1 ' } });
    fireEvent.change(screen.getByLabelText('Engine ID'), { target: { value: ' engine-1 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Evaluate Eligibility' }));

    expect(props.onEvaluate).toHaveBeenCalledWith({ userId: 'user-1', projectId: 'project-1', engineId: 'engine-1', mode: 'manual' });
  });
});
