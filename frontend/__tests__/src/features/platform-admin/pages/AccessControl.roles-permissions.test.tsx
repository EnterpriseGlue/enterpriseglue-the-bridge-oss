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

function expectButtonAbsentOrDisabled(container: typeof screen | ReturnType<typeof within>, name: RegExp) {
  const button = container.queryByRole('button', { name });
  if (button) {
    expect(button).toBeDisabled();
  } else {
    expect(button).not.toBeInTheDocument();
  }
}

describe('AccessControl roles and permissions', () => {
  beforeEach(resetAccessControlMocks);

  it('renders role and permission catalog data', () => {
    render(<AccessControl />);

    expect(screen.getByRole('heading', { name: 'Access Control' })).toBeInTheDocument();
    expect(screen.getAllByText('Platform Admin').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Custom Operator').length).toBeGreaterThan(0);
  });

  it('duplicates a system role into a custom role draft', async () => {
    render(<AccessControl />);

    fireEvent.click(screen.getAllByRole('button', { name: /Duplicate/i })[0]);

    await waitFor(() => expect(screen.getByDisplayValue('Copy of Platform Admin')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByLabelText('Check Access (platform:authz:check)')).toBeChecked());
    expect(screen.getByText('Sensitive permissions selected')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Create$/i }).find((button) => button.hasAttribute('disabled'))).toBeDefined();
    fireEvent.click(screen.getByLabelText('I understand this role includes sensitive permissions.'));

    const createButton = screen.getAllByRole('button', { name: /^Create$/i }).find((button) => !button.hasAttribute('disabled'));
    expect(createButton).toBeDefined();
    fireEvent.click(createButton!);

    await waitFor(() => expect(createRole).toHaveBeenCalledWith({
      name: 'Copy of Platform Admin',
      description: 'Admin',
      scope: 'platform',
      permissionIds: ['platform:authz:check', 'platform:users:permanent-delete'],
    }));
  }, 60000);

  it('opens custom role creation with disabled submit until required fields are present', () => {
    render(<AccessControl />);

    fireEvent.click(screen.getByRole('button', { name: /Create Role/i }));

    expect(screen.getByText('Create Custom Role')).toBeInTheDocument();
    expect(screen.getByLabelText('Role name')).toBeInTheDocument();
    expect(screen.getByText('Deploy (engine:deploy)')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Create$/i }).some((button) => button.hasAttribute('disabled'))).toBe(true);
  }, 60000);

  it('hides denied Access Control tabs and disables known management actions', () => {
    authState.permissions = {
      userId: 'viewer-1',
      platform: ['platform:authz:roles:view'],
      projects: [],
      engines: [],
      generatedAt: 1,
    };

    render(<AccessControl />);

    expect(screen.getByRole('tab', { name: /^Roles$/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^Permissions$/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^Assignments$/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^Groups$/i })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /Effective Access/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /SSO Engine Assignments/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /^Engine Sets$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /^Project Targets$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^Policies$/i })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /^Audit$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /External Registration/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Create Role/i })).toBeDisabled();

    fireEvent.click(screen.getByRole('tab', { name: /^Assignments$/i }));
    expect(screen.getByRole('button', { name: /Assign Role/i })).toBeDisabled();
    expect(screen.getAllByLabelText('Remove assignment').every((button) => button.hasAttribute('disabled'))).toBe(true);
  });

  it('allows read-only Engine Set inspection while disabling management actions', () => {
    authState.permissions = {
      userId: 'viewer-1',
      platform: ['platform:engine-sets:view'],
      projects: [],
      engines: [],
      generatedAt: 1,
    };

    render(<AccessControl />);

    fireEvent.click(screen.getByRole('tab', { name: /^Engine Sets$/i }));

    expect(screen.getAllByText('Production Engines').length).toBeGreaterThan(0);
    expectButtonAbsentOrDisabled(screen, /Create Engine Set/i);
    expectButtonAbsentOrDisabled(screen, /Edit/i);
    expectButtonAbsentOrDisabled(screen, /Materialize/i);
    expectButtonAbsentOrDisabled(screen, /Archive/i);
  });

  it('allows read-only project target inspection while disabling management actions', () => {
    authState.permissions = {
      userId: 'viewer-1',
      platform: ['platform:project-engine-targets:view'],
      projects: [],
      engines: [],
      generatedAt: 1,
    };

    render(<AccessControl />);

    fireEvent.click(screen.getByRole('tab', { name: /^Project Targets$/i }));

    expect(screen.getByText('Payments')).toBeInTheDocument();
    expectButtonAbsentOrDisabled(screen, /Create Target/i);
    expectButtonAbsentOrDisabled(screen, /Sync Legacy Targets/i);
    expectButtonAbsentOrDisabled(screen, /Evaluate Eligibility/i);
    const manualRow = screen.getByText('Payments').closest('tr')!;
    expectButtonAbsentOrDisabled(within(manualRow), /Edit/i);
    expectButtonAbsentOrDisabled(within(manualRow), /Archive/i);
  });

  it('allows read-only policy inspection while disabling management actions', () => {
    authState.permissions = {
      userId: 'viewer-1',
      platform: ['platform:authz:roles:view'],
      projects: [],
      engines: [],
      generatedAt: 1,
    };

    render(<AccessControl />);

    fireEvent.click(screen.getByRole('tab', { name: /^Policies$/i }));

    expect(screen.getByText('Block production deploys outside hours')).toBeInTheDocument();
    expectButtonAbsentOrDisabled(screen, /Add Policy/i);
    const policyRow = screen.getByText('Block production deploys outside hours').closest('tr')!;
    expectButtonAbsentOrDisabled(within(policyRow), /Edit/i);
    expectButtonAbsentOrDisabled(within(policyRow), /Disable/i);
    expectButtonAbsentOrDisabled(within(policyRow), /Delete/i);
  });

  it('creates custom permissions from the permission catalog tab', async () => {
    render(<AccessControl />);

    fireEvent.click(screen.getByRole('tab', { name: /^Permissions$/i }));
    fireEvent.click(screen.getByRole('button', { name: /Add Permission/i }));

    fireEvent.change(document.getElementById('custom-permission-key')!, { target: { value: 'project:custom:approve-release' } });
    fireEvent.change(document.getElementById('custom-permission-category')!, { target: { value: 'Release' } });
    fireEvent.change(document.getElementById('custom-permission-label')!, { target: { value: 'Approve release' } });
    fireEvent.change(document.getElementById('custom-permission-description')!, { target: { value: 'Allows release approval.' } });

    const permissionModal = screen.getByText('Create Custom Permission').closest('.cds--modal-container')!;
    const createButton = Array.from(permissionModal.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Create') as HTMLButtonElement | undefined;
    expect(createButton).toBeDefined();
    expect(createButton).not.toBeDisabled();
    await act(async () => {
      fireEvent.click(createButton!);
    });

    expect(createPermission).toHaveBeenCalledWith({
      key: 'project:custom:approve-release',
      scope: 'project',
      category: 'Release',
      label: 'Approve release',
      description: 'Allows release approval.',
    });
  });

  it('renders manual role assignments and removal affordance', () => {
    render(<AccessControl />);

    fireEvent.click(screen.getByRole('tab', { name: /^Assignments$/i }));

    const principalCells = screen.getAllByText('00000000-0000-4000-8000-000000000001');
    expect(principalCells.length).toBeGreaterThan(0);
    expect(screen.getAllByText('Custom Operator').length).toBeGreaterThan(0);
    const assignmentRow = principalCells[0].closest('tr');
    expect(assignmentRow).toBeTruthy();
    expect(within(assignmentRow!).getByLabelText('Remove assignment')).toBeInTheDocument();
  });

  it('identifies locally overridable config assignments without hiding their removal affordance', () => {
    render(<AccessControl />);

    fireEvent.click(screen.getByRole('tab', { name: /^Assignments$/i }));

    const principal = screen.getByText('00000000-0000-4000-8000-000000000099');
    const assignmentRow = principal.closest('tr');
    expect(assignmentRow).toBeTruthy();
    expect(within(assignmentRow!).getByText('Config warning')).toBeInTheDocument();
    expect(within(assignmentRow!).getByLabelText('Remove assignment')).toBeInTheDocument();
  });

  it('renders external engine registration audit drilldown', () => {
    render(<AccessControl />);

    fireEvent.click(screen.getByRole('tab', { name: /External Registration/i }));
    fireEvent.click(screen.getAllByRole('button', { name: /View audit/i })[0]);

    expect(screen.getByText('External Engine audit')).toBeInTheDocument();
    expect(screen.getByText('Audit event')).toBeInTheDocument();
    expect(screen.getByText('engine.external_registration.update')).toBeInTheDocument();
    expect(screen.getByText(/externalId: cluster-a\/prod/)).toBeInTheDocument();
  });
});
