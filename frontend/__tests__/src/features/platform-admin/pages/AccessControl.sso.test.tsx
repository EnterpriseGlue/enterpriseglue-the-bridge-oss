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

describe('AccessControl SSO', () => {
  beforeEach(resetAccessControlMocks);

  it('renders SSO engine assignment external selector fields', () => {
    render(<AccessControl />);

    fireEvent.click(screen.getByRole('tab', { name: /SSO Engine Assignments/i }));
    fireEvent.click(screen.getByRole('button', { name: /Add Mapping/i }));

    expect(screen.getByText('Add SSO Engine Assignment')).toBeInTheDocument();
    expect(document.getElementById('target-external-engine-id')).toBeInTheDocument();
    expect(document.getElementById('target-label-key')).toBeInTheDocument();
    expect(document.getElementById('target-label-value')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Create$/i }).some((button) => button.hasAttribute('disabled'))).toBe(true);
  });

  it('renders SSO platform-role and group mappings with test and create flows', async () => {
    authState.permissions = {
      ...authState.permissions,
      platform: [
        ...authState.permissions.platform,
        'platform:sso-platform-role-mappings:view',
        'platform:sso-platform-role-mappings:manage',
      ],
    };

    render(<AccessControl />);

    fireEvent.click(screen.getByRole('tab', { name: /^SSO Mappings$/i }));

    expect(screen.getByText('Platform role mappings')).toBeInTheDocument();
    expect(screen.getByText('Group mappings')).toBeInTheDocument();
    expect(screen.getByText('group:groups Wildcard compatibility Platform Admins')).toBeInTheDocument();
    expect(screen.getByText('group:groups Wildcard compatibility Operators')).toBeInTheDocument();
    expect(screen.getAllByText('Operations').length).toBeGreaterThan(0);
    expect(screen.getByText('Platform role preview: Platform Admin')).toBeInTheDocument();
    expect(screen.getByText('1 group membership would sync')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Test Platform Role Mappings/i }));
    });
    expect(testSsoPlatformMapping).toHaveBeenCalledWith({
      claims: {
        email: 'user@example.com',
        groups: ['Camunda Operators'],
      },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Test Group Mappings/i }));
    });
    expect(testSsoGroupMapping).toHaveBeenCalledWith({
      claims: {
        email: 'user@example.com',
        groups: ['Camunda Operators'],
      },
    });

    fireEvent.click(screen.getByRole('button', { name: /Add Platform Mapping/i }));
    fireEvent.change(document.getElementById('sso-platform-claim-value')!, { target: { value: 'Platform Owners' } });

    const platformModal = screen.getByRole('heading', { name: /^Add Platform Role SSO Mapping$/i }).closest('.cds--modal-container') as HTMLElement;
    await act(async () => {
      fireEvent.click(within(platformModal).getByRole('button', { name: /^Create$/i }));
    });

    expect(createSsoPlatformMapping).toHaveBeenCalledWith({
      providerId: null,
      claimType: 'group',
      claimKey: 'groups',
      claimValue: 'Platform Owners',
      claimOperator: null,
      targetRole: 'user',
      priority: 0,
      isActive: true,
    });

    fireEvent.click(screen.getByRole('button', { name: /Add Group Mapping/i }));
    fireEvent.change(document.getElementById('sso-group-claim-value')!, { target: { value: 'Release Operators' } });

    const groupModal = screen.getByRole('heading', { name: /^Add SSO Group Mapping$/i }).closest('.cds--modal-container') as HTMLElement;
    await act(async () => {
      fireEvent.click(within(groupModal).getByRole('button', { name: /^Create$/i }));
    });

    expect(createSsoGroupMapping).toHaveBeenCalledWith({
      providerId: null,
      claimType: 'group',
      claimKey: 'groups',
      claimValue: 'Release Operators',
      claimOperator: null,
      targetGroupId: 'group-1',
      syncMode: 'authoritative',
      priority: 0,
      isActive: true,
    });
  }, 30000);

  it('requires acknowledgement before saving all-engine SSO engine assignments', async () => {
    render(<AccessControl />);

    fireEvent.click(screen.getByRole('tab', { name: /SSO Engine Assignments/i }));

    const allEngineRow = screen
      .getAllByText('group:groups Wildcard compatibility All Engines')
      .map((element) => element.closest('tr'))
      .find((row): row is HTMLTableRowElement => Boolean(row));
    expect(allEngineRow).toBeDefined();

    fireEvent.click(within(allEngineRow!).getByRole('button', { name: /Edit/i }));

    const modal = screen.getByRole('heading', { name: /^Edit SSO Engine Assignment$/i }).closest('.cds--modal-container') as HTMLElement;
    const saveButton = within(modal).getByRole('button', { name: /^Save$/i });
    expect(saveButton).toBeDisabled();
    expect(within(modal).getByText('All-engine assignment mapping')).toBeInTheDocument();

    fireEvent.click(within(modal).getByLabelText('I understand this mapping can grant access to all active engines.'));
    expect(saveButton).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(saveButton);
    });

    await waitFor(() => expect(updateSsoAssignment).toHaveBeenCalledWith(expect.objectContaining({
      targetSelectorType: 'all_engines',
      riskAcknowledged: true,
    })));
  });

  it('requires acknowledgement before saving regex SSO engine assignments', async () => {
    render(<AccessControl />);

    fireEvent.click(screen.getByRole('tab', { name: /SSO Engine Assignments/i }));

    const regexRow = screen
      .getAllByText('group:groups Matches regex ^Regex Ops$')
      .map((element) => element.closest('tr'))
      .find((row): row is HTMLTableRowElement => Boolean(row));
    expect(regexRow).toBeDefined();

    fireEvent.click(within(regexRow!).getByRole('button', { name: /Edit/i }));

    const modal = screen.getByRole('heading', { name: /^Edit SSO Engine Assignment$/i }).closest('.cds--modal-container') as HTMLElement;
    const saveButton = within(modal).getByRole('button', { name: /^Save$/i });
    expect(saveButton).toBeDisabled();
    expect(within(modal).getByText('Regex claim mapping')).toBeInTheDocument();

    fireEvent.click(within(modal).getByLabelText('I understand this mapping uses regex claim matching.'));
    expect(saveButton).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(saveButton);
    });

    await waitFor(() => expect(updateSsoAssignment).toHaveBeenCalledWith(expect.objectContaining({
      id: 'mapping-4',
      claimOperator: 'matches_regex',
      riskAcknowledged: true,
    })));
  });

  it('blocks custom secret-role SSO engine assignments when the platform setting is off', () => {
    render(<AccessControl />);

    fireEvent.click(screen.getByRole('tab', { name: /SSO Engine Assignments/i }));

    const secretRoleRow = screen
      .getAllByText('group:groups Wildcard compatibility Secret Readers')
      .map((element) => element.closest('tr'))
      .find((row): row is HTMLTableRowElement => Boolean(row));
    expect(secretRoleRow).toBeDefined();

    fireEvent.click(within(secretRoleRow!).getByRole('button', { name: /Edit/i }));

    const modal = screen.getByRole('heading', { name: /^Edit SSO Engine Assignment$/i }).closest('.cds--modal-container') as HTMLElement;
    const saveButton = within(modal).getByRole('button', { name: /^Save$/i });
    expect(saveButton).toBeDisabled();
    expect(within(modal).getByText('Sensitive permission assignment mapping')).toBeInTheDocument();
    expect(within(modal).getByText(/Platform settings currently block active SSO mappings to custom roles with engine secret access/)).toBeInTheDocument();
  });

  it('blocks custom unredacted-audit SSO engine assignments when the platform setting is off', () => {
    render(<AccessControl />);

    fireEvent.click(screen.getByRole('tab', { name: /SSO Engine Assignments/i }));

    const auditRoleRow = screen
      .getAllByText('group:groups Wildcard compatibility Audit Readers')
      .map((element) => element.closest('tr'))
      .find((row): row is HTMLTableRowElement => Boolean(row));
    expect(auditRoleRow).toBeDefined();

    fireEvent.click(within(auditRoleRow!).getByRole('button', { name: /Edit/i }));

    const modal = screen.getByRole('heading', { name: /^Edit SSO Engine Assignment$/i }).closest('.cds--modal-container') as HTMLElement;
    const saveButton = within(modal).getByRole('button', { name: /^Save$/i });
    expect(saveButton).toBeDisabled();
    expect(within(modal).getByText('Sensitive permission assignment mapping')).toBeInTheDocument();
    expect(within(modal).getByText(/custom roles with unredacted audit access/)).toBeInTheDocument();
  });

  it('renders SSO engine assignment diagnostics, sync run events, and claims preview', async () => {
    ssoAssignmentTestState.data = {
      matchedMappings: [
        {
          id: 'mapping-1',
          providerId: null,
          claimType: 'group',
          claimKey: 'groups',
          claimValue: 'Ops',
          targetScope: 'engine',
          targetSelectorType: 'external_engine_id',
          targetEngineId: null,
          targetExternalEngineId: 'cluster-a/prod',
          targetLabelKey: null,
          targetLabelValue: null,
          targetRoleId: 'system.engine.operator',
          syncMode: 'authoritative',
          priority: 0,
          isActive: true,
          createdAt: 1,
          updatedAt: 1,
          targetResourceId: 'engine-1',
          targetResourceIds: ['engine-1'],
        },
      ],
      assignments: [
        { mappingId: 'mapping-1', roleId: 'system.engine.operator', resourceType: 'engine', resourceId: 'engine-1' },
        { mappingId: 'mapping-2', roleId: 'system.engine.deployer', resourceType: 'engine', resourceId: null },
      ],
    };

    render(<AccessControl />);

    fireEvent.click(screen.getByRole('tab', { name: /SSO Engine Assignments/i }));

    expect(screen.getByText('SSO diagnostics')).toBeInTheDocument();
    expect(screen.getByText('7 active mappings')).toBeInTheDocument();
    expect(screen.getByText('1 additive')).toBeInTheDocument();
    expect(screen.getByText('1 all-engine selector')).toBeInTheDocument();
    expect(screen.getByText('1 target warning')).toBeInTheDocument();
    expect(screen.getByText('1 stale SSO assignment')).toBeInTheDocument();
    expect(screen.getByText('2 SSO-managed assignments')).toBeInTheDocument();
    expect(screen.getByText('All-engine selectors are broad')).toBeInTheDocument();
    expect(screen.getAllByText('Missing label match').length).toBeGreaterThan(0);
    expect(screen.getByText('Stale SSO assignment lineage')).toBeInTheDocument();
    expect(screen.getByText('assignment-stale')).toBeInTheDocument();
    expect(screen.getByText('SSO sync runs')).toBeInTheDocument();
    expect(screen.getByText('Diagnostics run complete')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('checkbox', { name: 'Provider checks' }));
    await user.click(screen.getByRole('checkbox', { name: 'Snapshot replay' }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Snapshot replay' })).toBeChecked());
    await user.click(screen.getByRole('checkbox', { name: 'Refresh claims' }));
    await user.click(screen.getByRole('checkbox', { name: 'Cleanup stale rows' }));
    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: 'Provider checks' })).toBeChecked();
      expect(screen.getByRole('checkbox', { name: 'Refresh claims' })).toBeChecked();
      expect(screen.getByRole('checkbox', { name: 'Cleanup stale rows' })).toBeChecked();
    });
    await user.click(screen.getByRole('button', { name: /Run diagnostics/i }));
    await waitFor(() => expect(runSsoSyncDiagnostics).toHaveBeenCalledWith({
      trigger: 'manual',
      includeProviderChecks: true,
      includeSnapshotReplay: true,
      refreshProviderClaims: true,
      includeCleanup: true,
    }));
    expect(screen.getAllByText('Engine materialization failed').length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByText('sync-run-1 events')).toBeInTheDocument());
    expect(screen.getByText('engine_assignment.materialization_failed')).toBeInTheDocument();
    expect(screen.getByText('sso_assignment:mapping-1')).toBeInTheDocument();
    expect(screen.getAllByText('Claims preview').length).toBeGreaterThan(0);
    expect(screen.getByText('1 matched mapping; 2 assignments would be created or refreshed.')).toBeInTheDocument();
    expect(screen.getByText('Engine Operator - engine-1')).toBeInTheDocument();
    expect(screen.getByText('Engine Deployer - all engines')).toBeInTheDocument();
  });

  it('renders SSO engine access snapshots and transition cleanup controls', () => {
    render(<AccessControl />);

    fireEvent.click(screen.getByRole('tab', { name: /SSO Engine Assignments/i }));

    expect(screen.getByText('SSO engine access snapshots')).toBeInTheDocument();
    expect(screen.getByText('1 snapshot')).toBeInTheDocument();
    expect(screen.getByText('user: user-1')).toBeInTheDocument();
    expect(screen.getAllByText('engine-1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Engine Operator').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Active').length).toBeGreaterThan(0);
    expect(screen.getAllByText('mapping-1').length).toBeGreaterThan(0);
    expect(screen.getByText('provider=microsoft; 1 subject id; 1 group id')).toBeInTheDocument();

    fireEvent.change(document.getElementById('sso-engine-access-cleanup-engine-id')!, { target: { value: 'engine-1' } });
    fireEvent.click(screen.getByText('Preview cleanup'));

    expect(previewEngineAccessTransitionCleanup).toHaveBeenCalledWith('engine-1');
    expect(screen.getByText('1 cleanup candidate found')).toBeInTheDocument();
    expect(screen.getByText(/user:user-1 manual Engine Operator -> SSO Engine Operator/i)).toBeInTheDocument();
    expect(screen.getByText('Remove 0 manual assignments').closest('button')).toBeDisabled();
  });
});
