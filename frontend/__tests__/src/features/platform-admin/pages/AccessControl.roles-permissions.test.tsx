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
const { RoleAssignmentsTable } = await import('@src/features/platform-admin/pages/access-control/RoleAssignmentsTable');
const {
  assignmentResourceTypeOptions,
  canSubmitAssignment,
  withAssignmentPrincipalType,
  withAssignmentResourceType,
} = await import('@src/features/platform-admin/pages/access-control/assignmentFormOptions');
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

function expectButtonAbsentOrDisabled(container: typeof screen | ReturnType<typeof within>, name: RegExp) {
  const button = container.queryByRole('button', { name });
  if (button) {
    expect(button).toBeDisabled();
  } else {
    expect(button).not.toBeInTheDocument();
  }
}

function menuItem(label: string): HTMLElement | null {
  const node = screen.queryAllByText(label).find((candidate) => candidate.closest('.cds--overflow-menu-options__option'));
  return node?.closest('button') || node?.closest('[role="menuitem"]') || node || null;
}

describe('AccessControl roles and permissions', () => {
  beforeEach(resetAccessControlMocks);

  it('normalizes incompatible scopes when changing an assignment to a service account', () => {
    expect(withAssignmentPrincipalType({ principalType: 'user', principalId: 'user-1', roleId: 'role-1', resourceType: 'platform', resourceId: '', runtimeEngineId: 'engine-1' }, 'service_account')).toMatchObject({ principalType: 'service_account', principalId: '', roleId: '', resourceType: 'engine', runtimeEngineId: 'engine-1' });
  });

  it('clears role and platform resource state when changing assignment scope', () => {
    expect(withAssignmentResourceType({ principalType: 'user', principalId: 'user-1', roleId: 'role-1', resourceType: 'engine', resourceId: 'engine-1', runtimeEngineId: 'engine-1' }, 'platform')).toMatchObject({ resourceType: 'platform', resourceId: '', runtimeEngineId: '', roleId: '' });
  });

  it('enables assignment submission only for a complete non-pending scope', () => {
    const complete = { principalType: 'user' as const, principalId: 'user-1', roleId: 'role-1', resourceType: 'engine' as const, resourceId: 'engine-1' };
    expect(canSubmitAssignment(complete, false)).toBe(true);
    expect(canSubmitAssignment({ ...complete, resourceId: '' }, false)).toBe(false);
    expect(canSubmitAssignment(complete, true)).toBe(false);
  });

  it('treats the authenticated tenant as a first-class assignment scope for every principal', () => {
    const current = {
      principalType: 'group' as const,
      principalId: 'group-1',
      roleId: 'system.tenant.viewer',
      resourceType: 'engine' as const,
      resourceId: 'engine-1',
      runtimeEngineId: 'engine-1',
    };
    const tenant = withAssignmentResourceType(current, 'tenant');

    expect(tenant).toMatchObject({
      resourceType: 'tenant',
      resourceId: '',
      runtimeEngineId: '',
      roleId: '',
    });
    expect(canSubmitAssignment({ ...tenant, roleId: 'system.tenant.viewer' }, false)).toBe(true);
    for (const principalType of ['user', 'group', 'api_client', 'service_account'] as const) {
      expect(assignmentResourceTypeOptions(principalType)).toContainEqual({
        id: 'tenant',
        label: 'Current tenant',
      });
    }
  });

  it('renders role and permission catalog data', () => {
    render(<AccessControl />);

    expect(screen.getByRole('heading', { name: 'Access Control' })).toBeInTheDocument();
    expect(screen.getAllByText('Platform Admin').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Custom Operator').length).toBeGreaterThan(0);
  });

  it('duplicates a system role into a custom role draft', async () => {
    render(<AccessControl />);

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Platform Admin' }));
    await waitFor(() => expect(menuItem('Duplicate')).toBeTruthy());
    fireEvent.click(menuItem('Duplicate')!);

    await waitFor(() => expect(screen.getByDisplayValue('Copy of Platform Admin')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByLabelText('Check Access')).toBeChecked());
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

    expect(screen.getByText('Create custom role')).toBeInTheDocument();
    expect(screen.getByLabelText('Role name')).toBeInTheDocument();
    expect(screen.getAllByText('Deploy').length).toBeGreaterThan(0);
    expect(screen.getAllByText('engine:deploy').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /^Create$/i }).some((button) => button.hasAttribute('disabled'))).toBe(true);
  }, 60000);

  it('hides denied Access Control tabs and disables known management actions', () => {
    authState.permissions = {
      userId: 'viewer-1',
      tenantId: null,
      platform: ['platform:authz:roles:view'],
      projects: [],
      engines: [],
      authorizationVersion: 'test-authz-v1',
      generatedAt: 1,
    };

    render(<AccessControl />);

    expect(screen.getByRole('tab', { name: /^Roles$/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^Permissions$/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^Assignments$/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^Groups$/i })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /Effective Access/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /SSO Engine Assignments/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /^Engine sets$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /^Project Targets$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^Policies$/i })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /^Audit$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /External Registration/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Create Role/i })).toBeDisabled();

    fireEvent.click(screen.getByRole('tab', { name: /^Assignments$/i }));
    expect(screen.getByRole('button', { name: /Assign role/i })).toBeDisabled();
    expect(screen.getAllByLabelText('Remove assignment').every((button) => button.hasAttribute('disabled'))).toBe(true);
  });

  it('allows read-only Engine Set inspection while disabling management actions', async () => {
    authState.permissions = {
      userId: 'viewer-1',
      tenantId: null,
      platform: ['platform:engine-sets:view'],
      projects: [],
      engines: [],
      authorizationVersion: 'test-authz-v1',
      generatedAt: 1,
    };

    render(<AccessControl />);

    fireEvent.click(screen.getByRole('tab', { name: /^Engine sets$/i }));

    expect(screen.getAllByText('Production Engines').length).toBeGreaterThan(0);
    expectButtonAbsentOrDisabled(screen, /Create engine set/i);
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Production Engines' }));
    await waitFor(() => expect(menuItem('Edit')).toBeTruthy());
    expect(menuItem('Edit')).toBeDisabled();
    expect(menuItem('Refresh matching engines')).toBeDisabled();
    expect(menuItem('Archive')).toBeDisabled();
  });

  it('allows read-only project target inspection while disabling management actions', () => {
    authState.permissions = {
      userId: 'viewer-1',
      tenantId: null,
      platform: ['platform:project-engine-targets:view'],
      projects: [],
      engines: [],
      authorizationVersion: 'test-authz-v1',
      generatedAt: 1,
    };

    render(<AccessControl />);

    fireEvent.click(screen.getByRole('tab', { name: /^Project Targets$/i }));

    expect(screen.getByText('Payments')).toBeInTheDocument();
    expectButtonAbsentOrDisabled(screen, /Create Target/i);
    expectButtonAbsentOrDisabled(screen, /Import targets/i);
    expectButtonAbsentOrDisabled(screen, /Check deployment access/i);
    const manualRow = screen.getByText('Payments').closest('tr')!;
    expectButtonAbsentOrDisabled(within(manualRow), /Edit/i);
    expectButtonAbsentOrDisabled(within(manualRow), /Archive/i);
  });

  it('allows read-only policy inspection while disabling management actions', () => {
    authState.permissions = {
      userId: 'viewer-1',
      tenantId: null,
      platform: ['platform:authz:roles:view'],
      projects: [],
      engines: [],
      authorizationVersion: 'test-authz-v1',
      generatedAt: 1,
    };

    render(<AccessControl />);

    fireEvent.click(screen.getByRole('tab', { name: /^Policies$/i }));

    expect(screen.getByText('Block production deploys outside hours')).toBeInTheDocument();
    expectButtonAbsentOrDisabled(screen, /Add policy/i);
    const policyRow = screen.getByText('Block production deploys outside hours').closest('tr')!;
    expectButtonAbsentOrDisabled(within(policyRow), /Edit/i);
    expectButtonAbsentOrDisabled(within(policyRow), /Disable/i);
    expectButtonAbsentOrDisabled(within(policyRow), /Delete/i);
  });

  it('creates custom permissions from the permission catalog tab', async () => {
    render(<AccessControl />);

    fireEvent.click(screen.getByRole('tab', { name: /^Permissions$/i }));
    fireEvent.click(screen.getByRole('button', { name: /Add permission/i }));

    fireEvent.change(document.getElementById('custom-permission-key')!, { target: { value: 'project:custom:approve-release' } });
    fireEvent.change(document.getElementById('custom-permission-category')!, { target: { value: 'Release' } });
    fireEvent.change(document.getElementById('custom-permission-label')!, { target: { value: 'Approve release' } });
    fireEvent.change(document.getElementById('custom-permission-description')!, { target: { value: 'Allows release approval.' } });

    const permissionModal = screen.getByText('Create custom permission').closest('.cds--modal-container')!;
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

    expect(screen.getAllByText('Custom Operator').length).toBeGreaterThan(0);
    const assignmentRow = screen
      .getAllByText('User: 00000000-0000-4000-8000-000000000001')
      .map((principal) => principal.closest('tr'))
      .find((row) => row && within(row).queryByLabelText('Remove assignment'));
    expect(assignmentRow).toBeTruthy();
    expect(within(assignmentRow!).getByLabelText('Remove assignment')).toBeInTheDocument();
  });

  it('shows SSO-managed assignments without a manual removal affordance', () => {
    render(<AccessControl />);

    fireEvent.click(screen.getByRole('tab', { name: /^Assignments$/i }));

    const assignmentRow = screen.getByText('User: 00000000-0000-4000-8000-000000000012').closest('tr');
    expect(assignmentRow).toBeTruthy();
    expect(within(assignmentRow!).getByText('Managed by SSO')).toBeInTheDocument();
    expect(within(assignmentRow!).queryByLabelText('Remove assignment')).not.toBeInTheDocument();
  });

  it('labels SSO mapping assignments without exposing manual removal', () => {
    const assignment: RoleAssignment = {
      id: 'provider-assignment', tenantId: null, userId: 'provider-user', principalType: 'user', principalId: 'provider-user',
      roleId: 'system.engine.operator', roleKey: 'system.engine.operator', roleName: 'Engine Operator', roleScope: 'engine', resourceType: 'engine', resourceId: 'engine-1',
      scopeType: 'engine', scopeId: 'engine-1', source: 'sso', sourceRef: 'identity_mapping:identity-mapping-1',
      ownershipMode: 'manual', sourceHash: null, lastAppliedAt: null, driftStatus: null,
      expiresAt: null, lastSeenAt: 1, createdById: null, createdAt: 1, updatedAt: 1,
    };
    render(<RoleAssignmentsTable assignments={[assignment]} apiClients={[]} groups={[]} serviceAccounts={[]} externalSystems={[]} loading={false} canDelete onRemove={() => undefined} />);

    const row = screen.getByText('User: provider-user').closest('tr');
    expect(row).toBeTruthy();
    expect(within(row!).getByTitle(/SSO assignment mapping/)).toBeInTheDocument();
    expect(within(row!).queryByLabelText('Remove assignment')).not.toBeInTheDocument();
  });

  it('keeps manual engine assignments visible but read-only in SSO-managed mode', () => {
    const assignment: RoleAssignment = {
      id: 'assignment-manual', tenantId: null, userId: 'manual-user', principalType: 'user', principalId: 'manual-user',
      roleId: 'system.engine.operator', roleKey: 'system.engine.operator', roleName: 'Engine Operator', roleScope: 'engine',
      resourceType: 'engine', resourceId: 'engine-1', scopeType: 'engine', scopeId: 'engine-1',
      source: 'manual', sourceRef: null, ownershipMode: 'manual', sourceHash: null, lastAppliedAt: null, driftStatus: null,
      expiresAt: null, lastSeenAt: 1, createdById: null, createdAt: 1, updatedAt: 1,
    };
    authState.permissions = {
      ...authState.permissions,
      platformActionAvailability: {
        allowedActions: ['platform.authz.assignments.delete.project-access'],
        restrictions: {
          'platform.authz.assignments.delete.engine-access': {
            reasonCode: 'engine_access_sso_managed',
            reason: 'Engine access is SSO-managed.',
            managementSource: 'sso',
            sourceRef: 'identity-provider:test',
          },
        },
      },
    };
    render(<RoleAssignmentsTable assignments={[assignment]} apiClients={[]} groups={[]} serviceAccounts={[]} externalSystems={[]} loading={false} canDelete onRemove={() => undefined} />);

    expect(screen.getByText('User: manual-user')).toBeInTheDocument();
    expect(screen.getByLabelText('Remove assignment')).toBeDisabled();
    expect(screen.getByTitle(/SSO-managed/)).toBeInTheDocument();
  });

  it('identifies locally overridable config assignments without hiding their removal affordance', () => {
    render(<AccessControl />);

    fireEvent.click(screen.getByRole('tab', { name: /^Assignments$/i }));

    const assignmentRow = screen.getByText('User: 00000000-0000-4000-8000-000000000099').closest('tr');
    expect(assignmentRow).toBeTruthy();
    expect(within(assignmentRow!).getByText('Configuration-linked')).toBeInTheDocument();
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
