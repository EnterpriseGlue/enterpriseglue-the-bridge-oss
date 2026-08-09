import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProjectEngineTargetsPanel } from '@src/features/platform-admin/pages/access-control/ProjectEngineTargetsPanel';

vi.mock('@src/features/platform-admin/hooks/useAdminApi', () => ({
  useUserSearch: (query: string) => ({
    data: query.length >= 2 ? [{ id: 'user-1', email: 'operator@example.com', firstName: 'Engine', lastName: 'Operator' }] : [],
    isFetching: false,
  }),
}));

const externalTarget: React.ComponentProps<typeof ProjectEngineTargetsPanel>['targets'][number] = {
  id: 'target-1', tenantId: 'tenant-1', projectId: 'project-1', projectName: 'Payments',
  engineId: 'engine-1', engineName: 'Production engine', engineBaseUrl: null,
  environment: null, status: 'active', source: 'external', sourceRef: 'external:target-1',
  ownershipMode: 'manual', sourceHash: null, lastAppliedAt: null, driftStatus: null,
  externalSystemId: 'system-1', externalProjectId: 'external-project-1', externalEngineId: 'external-engine-1', externalTargetId: 'external-target-1',
  allowManualDeploy: false, allowCiDeploy: true, allowApiDeploy: true, allowImport: false,
  createdById: null, approvedById: null, approvalStatus: 'approved', approvedAt: 1,
  policyTags: ['production'], diagnostics: { source: 'external_registration_api' }, lastSeenAt: 1,
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

function menuItem(label: string): HTMLElement | null {
  const node = screen.queryAllByText(label).find((candidate) => candidate.closest('.cds--overflow-menu-options__option'));
  return node?.closest('button') || node?.closest('[role="menuitem"]') || node || null;
}

describe('ProjectEngineTargetsPanel', () => {
  it('keeps external targets visible but blocks local edit and archive actions', async () => {
    renderPanel();

    expect(screen.getByText('Payments')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Payments' }));
    await waitFor(() => expect(menuItem('Edit')).toBeTruthy());
    expect(menuItem('Edit')).toBeDisabled();
    expect(menuItem('Archive')).toBeDisabled();
    expect(menuItem('Edit')).toHaveAttribute('title', 'Source-owned targets are managed by their external source');
  });

  it('allows a config-warning target to be reconciled through the reviewed local controls', async () => {
    const props = renderPanel({
      targets: [{ ...externalTarget, source: 'config', ownershipMode: 'config_warn', driftStatus: 'drifted' }],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Payments' }));
    await waitFor(() => expect(menuItem('Edit')).toBeTruthy());
    fireEvent.click(menuItem('Edit')!);
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Payments' }));
    await waitFor(() => expect(menuItem('Archive')).toBeTruthy());
    fireEvent.click(menuItem('Archive')!);
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Archive project target' })).getByRole('button', { name: /Archive/ }));

    expect(props.onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'target-1', ownershipMode: 'config_warn' }));
    expect(props.onArchive).toHaveBeenCalledWith('target-1');
  });

  it('sends the explicit project target and requested mode to eligibility evaluation', () => {
    const props = renderPanel();

    fireEvent.change(screen.getByLabelText('User'), { target: { value: 'operator' } });
    fireEvent.click(screen.getByRole('button', { name: /Engine Operator/ }));
    fireEvent.click(document.getElementById('target-evaluate-project')!);
    fireEvent.click(screen.getByRole('option', { name: 'Payments' }));
    fireEvent.click(document.getElementById('target-evaluate-engine')!);
    fireEvent.click(screen.getByRole('option', { name: 'Production engine' }));
    fireEvent.click(screen.getByRole('button', { name: 'Check deployment access' }));

    expect(props.onEvaluate).toHaveBeenCalledWith({ userId: 'user-1', projectId: 'project-1', engineId: 'engine-1', mode: 'manual' });
  });
});
