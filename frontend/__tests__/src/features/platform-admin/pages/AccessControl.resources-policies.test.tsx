import { describe, it, expect, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  AuthzGroup,
  AuthzGroupMembership,
  ExternalEngineRegistration,
  PermissionCatalogEntry,
  RoleAssignment,
  RoleSummary,
  SsoAssignmentMapping,
} from './AccessControlTestUtils';

const {
  default: AccessControl,
  buildPrincipalSummaries,
  buildResourceSummaries,
  buildEngineSetSelector,
  filterPermissions,
  filterRoles,
  findStaleSsoAssignments,
  getAssignableRolesForPrincipal,
  getPermissionImplications,
  getPermissionRisk,
  getSsoAssignmentDiagnostics,
  getSsoAssignmentMappingWarning,
  getSsoAssignmentTargetSummary,
  getSsoTargetRoleOptions,
} = await import('@src/features/platform-admin/pages/AccessControl');
import {
  resetAccessControlMocks,
  ssoAssignmentTestState,
  evaluateAccessState,
  authState,
  createRole,
  createPermission,
  createGroup,
  updateGroup,
  archiveGroup,
  addGroupMembership,
  removeGroupMembership,
  updateRole,
  archiveRole,
  assignRole,
  removeAssignment,
  createEngineSet,
  updateEngineSet,
  archiveEngineSet,
  previewEngineSetSelector,
  materializeEngineSet,
  createProjectEngineTarget,
  updateProjectEngineTarget,
  archiveProjectEngineTarget,
  syncLegacyProjectEngineTargets,
  evaluateDeploymentEligibility,
  createPolicy,
  updatePolicy,
  deletePolicy,
  createApiClient,
  rotateApiClient,
  revokeApiClient,
  createServiceAccount,
  rotateServiceAccount,
  revokeServiceAccount,
  createExternalSystem,
  updateExternalSystem,
  archiveExternalSystem,
  decommissionExternalEngine,
  reactivateExternalEngine,
  reconcileExternalEngine,
  createSsoPlatformMapping,
  updateSsoPlatformMapping,
  testSsoPlatformMapping,
  createSsoGroupMapping,
  testSsoGroupMapping,
  updateSsoAssignment,
  runSsoSyncDiagnostics,
  previewEngineAccessTransitionCleanup,
  applyEngineAccessTransitionCleanup,
} from './AccessControlTestUtils';

describe('AccessControl resources and policies', () => {
  beforeEach(resetAccessControlMocks);

  it('renders By Principal access chains including inherited group assignments', () => {
    render(<AccessControl />);

    fireEvent.click(screen.getByRole('tab', { name: /By Principal/i }));

    expect(screen.getByText('Principals')).toBeInTheDocument();
    expect(screen.getAllByText('Engine registration').length).toBeGreaterThan(0);
    expect(screen.getAllByText('CI deployer').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: /View principal 00000000-0000-4000-8000-000000000010/i }));

    expect(screen.getByRole('heading', { name: /User: 00000000-0000-4000-8000-000000000010/i })).toBeInTheDocument();
    expect(screen.getByText(/via group Operations \(manual membership\)/)).toBeInTheDocument();
    expect(screen.getByText('Group membership')).toBeInTheDocument();
    expect(screen.getAllByText('Engine Operator').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/authz.role_assignment.create/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: /View principal 00000000-0000-4000-8000-000000000011/i }));

    expect(screen.getByRole('heading', { name: /User: 00000000-0000-4000-8000-000000000011/i })).toBeInTheDocument();
    expect(screen.getByText(/SSO group mapping: group:groups Wildcard compatibility SSO Operators/)).toBeInTheDocument();
    expect(screen.getAllByText(/authz.sso_group_membership.create/).length).toBeGreaterThan(0);
  });

  it('renders By Resource access chains and related project targets', () => {
    render(<AccessControl />);

    fireEvent.click(screen.getByRole('tab', { name: /By Resource/i }));

    expect(screen.getByText('Resources')).toBeInTheDocument();
    expect(screen.getAllByText('External Engine').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: /View resource External Engine/i }));

    expect(screen.getByRole('heading', { name: /Engine: External Engine/i })).toBeInTheDocument();
    expect(screen.getByText('User: 00000000-0000-4000-8000-000000000001')).toBeInTheDocument();
    expect(screen.getByText('Group: Operations')).toBeInTheDocument();
    expect(screen.getAllByText('Custom Operator').length).toBeGreaterThan(0);
    expect(screen.getByText(/SSO engine mapping: group:groups Wildcard compatibility Ops/)).toBeInTheDocument();
    expect(screen.getAllByText(/authz.sso_assignment.create/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Payments').length).toBeGreaterThan(0);
    expect(screen.getByText('manual ci')).toBeInTheDocument();
    expect(screen.getByText('Applicable policies')).toBeInTheDocument();
    expect(screen.getAllByText('Block production deploys outside hours').length).toBeGreaterThan(0);
    expect(screen.getByText(/Matches selected Engine resource type/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Open audit event authz.sso_assignment.create/i }));
    expect(screen.getByRole('tab', { name: /^Audit$/i })).toHaveAttribute('aria-selected', 'true');
    expect(document.getElementById('authz-audit-resource-type-filter')).toHaveValue('role_assignment');
    expect(document.getElementById('authz-audit-resource-id-filter')).toHaveValue('assignment-sso-1');
  }, 60000);

  it('renders authorization audit events with filters', () => {
    render(<AccessControl />);

    fireEvent.click(screen.getByRole('tab', { name: /^Audit$/i }));

    expect(screen.getByText('platform.authz.roles.read')).toBeInTheDocument();
    expect(screen.getByText('engine.instances.mutate')).toBeInTheDocument();
    expect(screen.getByText('Missing permission engine:process:modify')).toBeInTheDocument();
    expect(screen.getByText('policy-1')).toBeInTheDocument();
    expect(screen.getByText('roles, sources')).toBeInTheDocument();
    expect(screen.getAllByText('engine:engine-1').length).toBeGreaterThan(0);
    expect(screen.getByText('127.0.0.1 | vitest')).toBeInTheDocument();

    const userFilter = document.getElementById('authz-audit-user-filter') as HTMLInputElement;
    fireEvent.change(userFilter, { target: { value: '00000000-0000-4000-8000-000000000021' } });
    expect(userFilter).toHaveValue('00000000-0000-4000-8000-000000000021');

    fireEvent.click(screen.getByRole('button', { name: /^Clear$/i }));
    expect(userFilter).toHaveValue('');
  });

  it('renders Engine Sets with materialization lineage and management actions', async () => {
    render(<AccessControl />);

    fireEvent.click(screen.getByRole('tab', { name: /^Engine Sets$/i }));

    expect(screen.getAllByText('Production Engines').length).toBeGreaterThan(0);
    expect(screen.getByText('Labels (all): environment=prod')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Details/i }));
    expect(screen.getAllByText('External Engine').length).toBeGreaterThan(0);
    expect(screen.getByText('label: environment=prod')).toBeInTheDocument();
    expect(screen.getByText('Production Engines assignment usage')).toBeInTheDocument();
    expect(screen.getAllByText('Group: Operations').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Engine Operator').length).toBeGreaterThan(0);
    expect(screen.getByText('Production Engines authorization audit')).toBeInTheDocument();
    expect(screen.getAllByText('engine.deploy.create').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Allowed by Engine Set assignment').length).toBeGreaterThan(0);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Materialize/i }));
    });

    expect(materializeEngineSet).toHaveBeenCalledWith('engine-set-1');
    expect(screen.getByText('Engine Set materialized')).toBeInTheDocument();
  });

  it('requires acknowledgement before creating broad Engine Sets', async () => {
    render(<AccessControl />);

    fireEvent.click(screen.getByRole('tab', { name: /^Engine Sets$/i }));
    fireEvent.click(screen.getByRole('button', { name: /Create Engine Set/i }));
    fireEvent.change(screen.getByLabelText('Engine Set name'), { target: { value: 'All Engines' } });

    const engineSetModal = screen.getByRole('heading', { name: /^Create Engine Set$/i }).closest('.cds--modal-container') as HTMLElement;
    fireEvent.click(within(engineSetModal).getByRole('combobox', { name: /Selector/i }));
    const allEnginesOption = screen.getAllByText('All engines')
      .find((element) => element.classList.contains('cds--list-box__menu-item__option')) as HTMLElement;
    fireEvent.click(allEnginesOption);

    expect(screen.getByText('Broad Engine Set selector')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Create$/i }).find((button) => button.hasAttribute('disabled'))).toBeDefined();

    fireEvent.click(screen.getByLabelText('I understand this selector can grant access across a broad set of engines.'));

    const createButton = screen.getAllByRole('button', { name: /^Create$/i }).find((button) => !button.hasAttribute('disabled'));
    expect(createButton).toBeDefined();
    await userEvent.click(createButton!);

    expect(createEngineSet).toHaveBeenCalledWith(expect.objectContaining({
      name: 'All Engines',
      description: null,
      selector: { mode: 'all' },
      riskAcknowledged: true,
    }));
  }, 60000);

  it('renders project-engine targets with manage, sync, and eligibility actions', async () => {
    render(<AccessControl />);

    fireEvent.click(screen.getByRole('tab', { name: /^Project Targets$/i }));

    const projectTargetsPanel = screen.getByLabelText('Project target API diagnostics').parentElement as HTMLElement;
    const projectTargets = within(projectTargetsPanel);

    expect(projectTargets.getByText('Project target API diagnostics')).toBeInTheDocument();
    expect(projectTargets.getByText('External API target registration blocked')).toBeInTheDocument();
    expect(projectTargets.getByText('External API target decommission blocked')).toBeInTheDocument();
    expect(projectTargets.getAllByText('Payments').length).toBeGreaterThan(0);
    expect(projectTargets.getByText('Manual, CI')).toBeInTheDocument();
    expect(projectTargets.getByText(/Policies: prod/)).toBeInTheDocument();
    const hasArchiveAction = (row: HTMLTableRowElement | null): row is HTMLTableRowElement =>
      row !== null && within(row).queryByRole('button', { name: /Archive/i }) !== null;

    const manualRow = projectTargets
      .getAllByText('Payments')
      .map((element) => element.closest('tr'))
      .find(hasArchiveAction)!;
    fireEvent.click(within(manualRow).getByRole('button', { name: /Archive/i }));
    await waitFor(() => expect(archiveProjectEngineTarget).toHaveBeenCalledWith('target-1'));

    const sourceOwnedRow = projectTargets
      .getAllByText('Inventory')
      .map((element) => element.closest('tr'))
      .find(hasArchiveAction)!;
    expect(within(sourceOwnedRow).getByRole('button', { name: /Edit/i })).toBeDisabled();
    expect(within(sourceOwnedRow).getByRole('button', { name: /Archive/i })).toBeDisabled();

    fireEvent.change(projectTargets.getByLabelText('Project ID to sync'), { target: { value: 'project-1' } });
    fireEvent.click(projectTargets.getByRole('button', { name: /Sync Legacy Targets/i }));
    await waitFor(() => expect(syncLegacyProjectEngineTargets).toHaveBeenCalledWith({ projectId: 'project-1' }));
    await waitFor(() => expect(projectTargets.getByText('Legacy project targets synced')).toBeInTheDocument());

    fireEvent.change(document.getElementById('target-evaluate-user-id')!, { target: { value: 'user-1' } });
    fireEvent.change(document.getElementById('target-evaluate-project-id')!, { target: { value: 'project-1' } });
    fireEvent.change(document.getElementById('target-evaluate-engine-id')!, { target: { value: 'engine-1' } });
    fireEvent.click(projectTargets.getByRole('button', { name: /Evaluate Eligibility/i }));

    await waitFor(() => expect(evaluateDeploymentEligibility).toHaveBeenCalledWith({
      userId: 'user-1',
      projectId: 'project-1',
      engineId: 'engine-1',
      mode: 'manual',
    }));
    await waitFor(() => expect(projectTargets.getByText('Deployment eligibility denied')).toBeInTheDocument());
    expect(projectTargets.getByText('Missing engine deploy permission')).toBeInTheDocument();
  });

  it('creates manual project-engine targets from Access Control', async () => {
    render(<AccessControl />);

    fireEvent.click(screen.getByRole('tab', { name: /^Project Targets$/i }));
    fireEvent.click(screen.getByRole('button', { name: /Create Target/i }));

    fireEvent.change(document.getElementById('project-target-project-id')!, { target: { value: 'project-new' } });
    fireEvent.change(document.getElementById('project-target-engine-id')!, { target: { value: 'engine-new' } });
    fireEvent.click(screen.getByLabelText('API deploy'));
    fireEvent.change(document.getElementById('project-target-external-project-id')!, { target: { value: 'cmdb-project-new' } });
    fireEvent.change(document.getElementById('project-target-policy-tags')!, { target: { value: 'prod, sox' } });

    const projectTargetModal = screen.getByRole('heading', { name: /^Create Project Target$/i }).closest('.cds--modal-container') as HTMLElement;
    const createButton = within(projectTargetModal).getByRole('button', { name: /^Create$/i });
    expect(createButton).toBeDefined();
    await userEvent.click(createButton!);

    await waitFor(() => expect(createProjectEngineTarget).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-new',
      engineId: 'engine-new',
      source: 'manual',
      allowManualDeploy: true,
      allowApiDeploy: true,
      externalProjectId: 'cmdb-project-new',
      policyTags: ['prod', 'sox'],
    })));
  }, 60000);

  it('renders authorization policies with manage actions', async () => {
    render(<AccessControl />);

    fireEvent.click(screen.getByRole('tab', { name: /^Policies$/i }));

    expect(screen.getByText('Block production deploys outside hours')).toBeInTheDocument();
    expect(screen.getAllByText('engine:deploy').length).toBeGreaterThan(0);
    expect(screen.getByText('timeWindow')).toBeInTheDocument();

    const policyRow = screen.getByText('Block production deploys outside hours').closest('tr')!;
    fireEvent.click(within(policyRow).getByRole('button', { name: /Disable/i }));
    await waitFor(() => expect(updatePolicy).toHaveBeenCalledWith({ id: 'policy-1', isActive: false }));

    fireEvent.click(within(policyRow).getByRole('button', { name: /Delete/i }));
    await waitFor(() => expect(deletePolicy).toHaveBeenCalledWith('policy-1'));
  });

  it('creates authorization policies from Access Control', async () => {
    render(<AccessControl />);

    fireEvent.click(screen.getByRole('tab', { name: /^Policies$/i }));
    fireEvent.click(screen.getByRole('button', { name: /Add Policy/i }));

    fireEvent.change(screen.getByLabelText('Policy name'), { target: { value: 'Require production approvals' } });
    fireEvent.change(document.getElementById('policy-description')!, { target: { value: 'Blocks production without an approval tag.' } });
    fireEvent.change(document.getElementById('policy-action')!, { target: { value: 'engine:deploy' } });
    fireEvent.change(document.getElementById('policy-conditions')!, {
      target: {
        value: JSON.stringify({
          resourceAttribute: {
            key: 'policyTags',
            operator: 'in',
            value: 'prod',
          },
        }, null, 2),
      },
    });

    const createButton = screen.getAllByRole('button', { name: /^Create$/i }).find((button) => !button.hasAttribute('disabled'));
    expect(createButton).toBeDefined();
    fireEvent.click(createButton!);

    await waitFor(() => expect(createPolicy).toHaveBeenCalledWith({
      name: 'Require production approvals',
      description: 'Blocks production without an approval tag.',
      effect: 'deny',
      priority: 100,
      resourceType: undefined,
      action: 'engine:deploy',
      conditions: {
        resourceAttribute: {
          key: 'policyTags',
          operator: 'in',
          value: 'prod',
        },
      },
    }));
  }, 60000);

  it('renders effective access query controls', () => {
    render(<AccessControl />);

    fireEvent.click(screen.getByRole('tab', { name: /Effective Access/i }));

    expect(document.querySelector('#effective-user-id')).toBeInTheDocument();
    expect(document.querySelector('#effective-permission')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Evaluate/i })).toBeDisabled();
  });

  it('renders effective access SSO Engine Set lineage', () => {
    evaluateAccessState.data = {
      allowed: true,
      decision: 'allow',
      reason: 'Allowed by SSO Engine Set assignment',
      baseAllowed: true,
      baseReason: 'role-assignment:system.engine.operator',
      sources: [{
        type: 'role-assignment',
        assignmentId: 'assignment-sso-1',
        roleId: 'system.engine.operator',
        principalType: 'user',
        principalId: 'user-1',
        source: 'sso',
        sourceMappingId: 'mapping-prod-operators',
        sourceRef: 'mapping-prod-operators',
        scopeType: 'engine_set',
        scopeId: 'engine-set-prod',
        engineSetId: 'engine-set-prod',
        engineSetKey: 'sso-prod-operators',
        engineSetName: 'SSO Prod Operators',
        selectorFingerprint: 'selector-fingerprint-1',
        materializationId: 'materialization-1',
        matchedEngineId: 'engine-1',
        engineRegistration: {
          engineId: 'engine-1',
          engineName: 'Payments Prod',
          externalId: 'cluster-a/prod',
          registrationId: 'registration-1',
          registrationSource: 'external_api',
          externalSystemId: 'system-1',
          lifecycleStatus: 'active',
          apiClientId: 'api-client-1',
          lastExternalSyncAt: 1300,
          lastRegisteredAt: 1250,
          externalUpdatedAt: 1200,
        },
        matchedBy: { mode: 'labels', labels: { environment: 'prod' } },
        lineage: { source: 'sso', sourceRef: 'mapping-prod-operators' },
        ssoMapping: {
          id: 'mapping-prod-operators',
          providerId: null,
          claimType: 'group',
          claimKey: 'groups',
          claimValue: 'Prod Operators',
          claimOperator: 'equals',
          targetSelectorType: 'engine_label',
        },
      }],
    };

    render(<AccessControl />);

    fireEvent.click(screen.getByRole('tab', { name: /Effective Access/i }));

    expect(screen.getByText('Authorization sources')).toBeInTheDocument();
    expect(screen.getByText('system.engine.operator')).toBeInTheDocument();
    expect(screen.getByText('user:user-1')).toBeInTheDocument();
    expect(screen.getByText('Engine Set: SSO Prod Operators')).toBeInTheDocument();
    expect(screen.getByText(/SSO mapping: group groups equals Prod Operators/)).toBeInTheDocument();
    expect(screen.getByText(/Engine registration: external_api externalId=cluster-a\/prod system=system-1 lifecycle=active/)).toBeInTheDocument();
    expect(screen.getByText(/Matched by: mode: labels/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Open audit event authz.sso_assignment.create/i }));
    expect(document.getElementById('authz-audit-resource-type-filter')).toHaveValue('role_assignment');
    expect(document.getElementById('authz-audit-resource-id-filter')).toHaveValue('assignment-sso-1');
  });

  it('renders effective access SSO group lineage', () => {
    evaluateAccessState.data = {
      allowed: true,
      decision: 'allow',
      reason: 'Allowed by group role assignment',
      baseAllowed: true,
      baseReason: 'role-assignment:custom.engine.operator',
      sources: [{
        type: 'role-assignment',
        assignmentId: 'assignment-1',
        roleId: 'custom.engine.operator',
        principalType: 'group',
        principalId: 'group-operators',
        source: 'manual',
        sourceMappingId: null,
        sourceRef: null,
        scopeType: 'engine',
        scopeId: 'engine-1',
        groupId: 'group-operators',
        groupKey: 'operators',
        groupName: 'Operators',
        groupMembership: {
          id: 'membership-sso-operators',
          source: 'sso',
          sourceRef: 'sso-group-mapping-operators',
          expiresAt: null,
        },
        ssoGroupMapping: {
          id: 'sso-group-mapping-operators',
          providerId: null,
          claimType: 'group',
          claimKey: 'groups',
          claimValue: 'Operators',
          claimOperator: 'contains',
          targetGroupId: 'group-operators',
          syncMode: 'authoritative',
        },
      }],
    };

    render(<AccessControl />);

    fireEvent.click(screen.getByRole('tab', { name: /Effective Access/i }));

    expect(screen.getByText('group:Operators')).toBeInTheDocument();
    expect(screen.getByText(/Group membership: sso/)).toBeInTheDocument();
    expect(screen.getByText(/SSO group: group groups contains Operators/)).toBeInTheDocument();
  });

  it('renders machine identity authorization audit references', () => {
    render(<AccessControl />);

    fireEvent.click(screen.getByRole('tab', { name: /External Registration/i }));

    expect(screen.getByText('Machine identity diagnostics')).toBeInTheDocument();
    expect(screen.getByText('1 active API client')).toBeInTheDocument();
    expect(screen.getByText('1 active service account')).toBeInTheDocument();
    expect(screen.getByText('1 broad registration scope')).toBeInTheDocument();
    expect(screen.getByText('1 deployment execution scope')).toBeInTheDocument();
    expect(screen.getByText('External API registration allowed')).toBeInTheDocument();
    expect(screen.getByText('External API decommission allowed')).toBeInTheDocument();
    expect(screen.getByText('2 machine identities with audit references')).toBeInTheDocument();

    const apiClientRow = screen.getByText('egac_client').closest('tr')!;
    expect(within(apiClientRow).getByRole('button', { name: /Open audit event platform.api_client.rotate/i })).toBeInTheDocument();

    const serviceAccountRow = screen.getByText('egsa_service').closest('tr')!;
    expect(within(serviceAccountRow).getByRole('button', { name: /Open audit event authz.role_assignment.create/i })).toBeInTheDocument();

    fireEvent.click(within(apiClientRow).getByRole('button', { name: /Open audit event platform.api_client.rotate/i }));
    expect(screen.getByRole('tab', { name: /^Audit$/i })).toHaveAttribute('aria-selected', 'true');
    expect(document.getElementById('authz-audit-resource-type-filter')).toHaveValue('api_client');
    expect(document.getElementById('authz-audit-resource-id-filter')).toHaveValue('client-1');
  });
});
