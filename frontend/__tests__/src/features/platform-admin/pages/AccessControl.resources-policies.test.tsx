import { describe, it, expect, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type {
  AuthzGroup,
  AuthzGroupMembership,
  ExternalEngineRegistration,
  PermissionCatalogEntry,
  RoleAssignment,
  RoleSummary,
} from './AccessControlTestUtils';

const {
  default: AccessControl,
  buildPrincipalSummaries,
  buildResourceSummaries,
  buildEngineSetSelector,
  filterPermissions,
  filterRoles,
  getAssignableRolesForPrincipal,
  getPermissionImplications,
  getPermissionRisk,
} = await import('@src/features/platform-admin/pages/AccessControl');
import {
  resetAccessControlMocks,
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
} from './AccessControlTestUtils';

function menuItem(label: string): HTMLElement | null {
  const node = screen.queryAllByText(label).find((candidate) => candidate.closest('.cds--overflow-menu-options__option'));
  return node?.closest('button') || node?.closest('[role="menuitem"]') || node || null;
}

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
    expect(screen.getByText(/Identity mapping: test-idp group exact SSO Operators -> sso-ops \(authoritative\)/)).toBeInTheDocument();
    expect(screen.getAllByText(/authz.sso_group_membership.create/).length).toBeGreaterThan(0);
  });

  it('renders By Resource access chains and related project targets', () => {
    render(<AccessControl />);

    fireEvent.click(screen.getByRole('tab', { name: /By Resource/i }));

    expect(screen.getByText('Resources')).toBeInTheDocument();
    expect(screen.getAllByText('External Engine').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: /View resource External Engine/i }));

    expect(screen.getByRole('heading', { name: /Engine: External Engine/i })).toBeInTheDocument();
    expect(screen.getAllByText('User: 00000000-0000-4000-8000-000000000001').length).toBeGreaterThan(0);
    expect(screen.getByText('Group: Operations')).toBeInTheDocument();
    expect(screen.getAllByText('Custom Operator').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Managed by SSO').length).toBeGreaterThan(0);
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

    fireEvent.click(screen.getByRole('tab', { name: /^Engine sets$/i }));

    expect(screen.getAllByText('Production Engines').length).toBeGreaterThan(0);
    expect(screen.getByText('Labels (all): environment=prod')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Production Engines' }));
    await waitFor(() => expect(menuItem('View details')).toBeTruthy());
    fireEvent.click(menuItem('View details')!);
    expect(screen.getAllByText('External Engine').length).toBeGreaterThan(0);
    expect(screen.getByText('label: environment=prod')).toBeInTheDocument();
    expect(screen.getByText('Production Engines assignment usage')).toBeInTheDocument();
    expect(screen.getAllByText('Group: Operations').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Engine Operator').length).toBeGreaterThan(0);
    expect(screen.getByText('Production Engines authorization audit')).toBeInTheDocument();
    expect(screen.getAllByText('engine.deploy.create').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Allowed by Engine Set assignment').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Production Engines' }));
    await waitFor(() => expect(menuItem('Refresh matching engines')).toBeTruthy());
    await act(async () => fireEvent.click(menuItem('Refresh matching engines')!));

    expect(materializeEngineSet).toHaveBeenCalledWith('engine-set-1');
    expect(screen.getByText(/engines matched/)).toBeInTheDocument();
  });

  it('requires acknowledgement before creating broad Engine Sets', async () => {
    render(<AccessControl />);

    fireEvent.click(screen.getByRole('tab', { name: /^Engine sets$/i }));
    fireEvent.click(screen.getByRole('button', { name: /Create engine set/i }));
    expect(screen.getByText('Enter one or more engine IDs, separated by commas.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Engine set name'), { target: { value: 'All Engines' } });

    const engineSetModal = screen.getByRole('heading', { name: /^Create engine set$/i }).closest('.cds--modal-container') as HTMLElement;
    fireEvent.click(within(engineSetModal).getByRole('combobox', { name: /Selector/i }));
    const allEnginesOption = screen.getAllByText('All engines')
      .find((element) => element.classList.contains('cds--list-box__menu-item__option')) as HTMLElement;
    fireEvent.click(allEnginesOption);

    expect(screen.getByText('Broad engine set selector')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Create$/i }).find((button) => button.hasAttribute('disabled'))).toBeDefined();

    fireEvent.click(screen.getByLabelText('I understand this selector can grant access across a broad set of engines.'));

    const createButton = screen.getAllByRole('button', { name: /^Create$/i }).find((button) => !button.hasAttribute('disabled'));
    expect(createButton).toBeDefined();
    await act(async () => fireEvent.click(createButton!));

    expect(createEngineSet).toHaveBeenCalledWith(expect.objectContaining({
      name: 'All Engines',
      description: null,
      selector: { mode: 'all' },
      riskAcknowledged: true,
    }));
  }, 120_000);

  it('renders project-engine targets with manage, sync, and eligibility actions', async () => {
    render(<AccessControl />);

    fireEvent.click(screen.getByRole('tab', { name: /^Project Targets$/i }));

    fireEvent.click(screen.getByRole('button', { name: 'Advanced integration status' }));
    const projectTargets = screen;

    expect(projectTargets.getByLabelText('Project target API diagnostics')).toBeInTheDocument();
    expect(projectTargets.getByText('Register targets: unavailable')).toBeInTheDocument();
    expect(projectTargets.getByText('Decommission targets: unavailable')).toBeInTheDocument();
    expect(projectTargets.getAllByText('Payments').length).toBeGreaterThan(0);
    expect(projectTargets.getByText('Manual, CI')).toBeInTheDocument();
    expect(projectTargets.getByText(/Policies: prod/)).toBeInTheDocument();
    fireEvent.click(projectTargets.getByRole('button', { name: 'Actions for Payments' }));
    await waitFor(() => expect(menuItem('Archive')).toBeTruthy());
    fireEvent.click(menuItem('Archive')!);
    fireEvent.click(screen.getByRole('dialog', { name: 'Archive project target' }).querySelector('.cds--btn--danger')!);
    await waitFor(() => expect(archiveProjectEngineTarget).toHaveBeenCalledWith('target-1'));

    fireEvent.click(projectTargets.getByRole('button', { name: 'Actions for Inventory' }));
    await waitFor(() => expect(menuItem('Edit')).toBeTruthy());
    expect(menuItem('Edit')).toBeDisabled();
    expect(menuItem('Archive')).toBeDisabled();

    fireEvent.click(document.getElementById('target-sync-project')!);
    fireEvent.click(screen.getByRole('option', { name: 'Payments' }));
    fireEvent.click(projectTargets.getByRole('button', { name: /Import targets/i }));
    await waitFor(() => expect(syncLegacyProjectEngineTargets).toHaveBeenCalledWith({ projectId: 'project-1' }));
    await waitFor(() => expect(projectTargets.getByText('Existing project targets imported')).toBeInTheDocument());

    fireEvent.change(document.getElementById('target-evaluate-user')!, { target: { value: 'second' } });
    fireEvent.click(screen.getByRole('button', { name: /Second User/ }));
    fireEvent.click(document.getElementById('target-evaluate-project')!);
    fireEvent.click(screen.getByRole('option', { name: 'Payments' }));
    fireEvent.click(document.getElementById('target-evaluate-engine')!);
    fireEvent.click(screen.getByRole('option', { name: 'External Engine' }));
    fireEvent.click(projectTargets.getByRole('button', { name: /Check deployment access/i }));

    await waitFor(() => expect(evaluateDeploymentEligibility).toHaveBeenCalledWith({
      userId: '00000000-0000-4000-8000-000000000020',
      projectId: 'project-1',
      engineId: 'engine-1',
      mode: 'manual',
    }));
    await waitFor(() => expect(projectTargets.getByText('Deployment eligibility denied')).toBeInTheDocument());
    expect(projectTargets.getByText('Missing engine deploy permission')).toBeInTheDocument();
  }, 120_000);

  it('creates manual project-engine targets from Access Control', async () => {
    render(<AccessControl />);

    fireEvent.click(screen.getByRole('tab', { name: /^Project Targets$/i }));
    fireEvent.click(screen.getByRole('button', { name: /Create Target/i }));

    fireEvent.click(document.getElementById('project-target-project')!);
    fireEvent.click(screen.getByRole('option', { name: 'New project' }));
    fireEvent.click(document.getElementById('project-target-engine')!);
    fireEvent.click(screen.getByRole('option', { name: 'External Engine' }));
    fireEvent.click(screen.getByLabelText('API deploy'));
    fireEvent.click(screen.getByRole('button', { name: 'Advanced integration metadata' }));
    fireEvent.change(document.getElementById('project-target-external-project-id')!, { target: { value: 'cmdb-project-new' } });
    fireEvent.change(document.getElementById('project-target-policy-tags')!, { target: { value: 'prod, sox' } });

    const projectTargetModal = screen.getByRole('heading', { name: /^Create Project Target$/i }).closest('.cds--modal-container') as HTMLElement;
    const createButton = within(projectTargetModal).getByRole('button', { name: /^Create$/i });
    expect(createButton).toBeDefined();
    await act(async () => fireEvent.click(createButton!));

    await waitFor(() => expect(createProjectEngineTarget).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-new',
      engineId: 'engine-1',
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

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Block production deploys outside hours' }));
    await waitFor(() => expect(menuItem('Disable')).toBeTruthy());
    fireEvent.click(menuItem('Disable')!);
    await waitFor(() => expect(updatePolicy).toHaveBeenCalledWith({ id: 'policy-1', isActive: false }));

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Block production deploys outside hours' }));
    await waitFor(() => expect(menuItem('Delete')).toBeTruthy());
    fireEvent.click(menuItem('Delete')!);
    fireEvent.click(screen.getByRole('dialog', { name: 'Delete authorization policy' }).querySelector('.cds--btn--danger')!);
    await waitFor(() => expect(deletePolicy).toHaveBeenCalledWith('policy-1'));
  });

  it('creates authorization policies from Access Control', async () => {
    render(<AccessControl />);

    fireEvent.click(screen.getByRole('tab', { name: /^Policies$/i }));
    fireEvent.click(screen.getByRole('button', { name: /Add policy/i }));
    expect(screen.getByRole('combobox', { name: 'Effect' })).toHaveTextContent('Select an effect');

    fireEvent.change(screen.getByLabelText('Policy name'), { target: { value: 'Require production approvals' } });
    fireEvent.change(document.getElementById('policy-description')!, { target: { value: 'Blocks production without an approval tag.' } });
    fireEvent.click(document.querySelector('#policy-effect button')!);
    fireEvent.click(screen.getByRole('option', { name: 'Deny' }));
    fireEvent.click(document.querySelector('#policy-resource-type button')!);
    fireEvent.click(screen.getByRole('option', { name: 'Engine' }));
    fireEvent.click(document.getElementById('policy-action')!);
    fireEvent.click(screen.getByText('Deploy (engine:deploy)'));
    fireEvent.click(screen.getByRole('button', { name: 'Advanced conditions (JSON)' }));
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
      resourceType: 'engine',
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

    expect(document.querySelector('#effective-user')).toBeInTheDocument();
    expect(document.querySelector('#effective-permission')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Check access/i })).toBeDisabled();
  });

  it('only offers permissions compatible with the selected Effective Access resource', () => {
    render(<AccessControl />);

    fireEvent.click(screen.getByRole('tab', { name: /Effective Access/i }));
    fireEvent.click(document.querySelector('#effective-permission button')!);

    expect(screen.getByText('Check Access (platform:authz:check)')).toBeInTheDocument();
    expect(screen.queryByText('View Instances (engine:instance:view)')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Check Access (platform:authz:check)'));
    fireEvent.click(document.querySelector('#effective-resource-type button')!);
    fireEvent.click(screen.getByRole('option', { name: 'Engine' }));
    fireEvent.click(document.querySelector('#effective-permission button')!);

    expect(screen.getByText('View Instances (engine:instance:view)')).toBeInTheDocument();
    expect(screen.queryByText('Check Access (platform:authz:check)')).not.toBeInTheDocument();
  });

  it('shows runtime resource selector fields for effective access', () => {
    render(<AccessControl />);

    fireEvent.click(screen.getByRole('tab', { name: /Effective Access/i }));
    const resourceTypeDropdown = document.querySelector('#effective-resource-type button');
    expect(resourceTypeDropdown).not.toBeNull();
    fireEvent.click(resourceTypeDropdown as HTMLButtonElement);
    fireEvent.click(screen.getByText('Runtime resource'));

    expect(document.querySelector('#effective-runtime-engine')).toBeInTheDocument();
    expect(document.querySelector('#effective-runtime-resource-kind')).toBeInTheDocument();
    expect(document.querySelector('#effective-runtime-resource')).toBeInTheDocument();
    expect(document.querySelector('#effective-runtime-tenant-id')).not.toBeInTheDocument();
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
        identityEntitlementMapping: {
          id: 'mapping-prod-operators',
          providerId: 'provider-1',
          entitlementType: 'group',
          externalId: 'Prod Operators',
          matchOperator: 'exact',
          targetGroupId: 'group-operators',
          syncMode: 'authoritative',
        },
      }],
    };

    render(<AccessControl />);

    fireEvent.click(screen.getByRole('tab', { name: /Effective Access/i }));

    expect(screen.getByText('Why this access decision was made')).toBeInTheDocument();
    expect(screen.getAllByText('system.engine.operator').length).toBeGreaterThan(0);
    expect(screen.getByText('user:user-1')).toBeInTheDocument();
    expect(screen.getByText('Engine Set: SSO Prod Operators')).toBeInTheDocument();
    expect(screen.getByText(/Identity mapping: group exact Prod Operators/)).toBeInTheDocument();
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
        identityEntitlementMapping: {
          id: 'sso-group-mapping-operators',
          providerId: 'provider-1',
          entitlementType: 'group',
          externalId: 'Operators',
          matchOperator: 'contains',
          targetGroupId: 'group-operators',
          syncMode: 'authoritative',
        },
      }],
    };

    render(<AccessControl />);

    fireEvent.click(screen.getByRole('tab', { name: /Effective Access/i }));

    expect(screen.getByText('group:Operators')).toBeInTheDocument();
    expect(screen.getByText(/Group membership: sso/)).toBeInTheDocument();
    expect(screen.getByText(/Identity mapping: group contains Operators/)).toBeInTheDocument();
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
