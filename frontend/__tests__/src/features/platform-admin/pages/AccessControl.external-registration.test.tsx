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

describe('AccessControl external registration', () => {
  beforeEach(resetAccessControlMocks);

  it('renders external registration API clients', async () => {
    render(<AccessControl />);

    fireEvent.click(screen.getByRole('tab', { name: /External Registration/i }));

    expect(screen.getAllByText('Engine registration').length).toBeGreaterThan(0);
    expect(screen.getByText('engine:register')).toBeInTheDocument();
    expect(screen.getByLabelText('Client name')).toBeInTheDocument();
    expect(document.getElementById('api-client-scope-config-bundle-manage')).toBeInTheDocument();
    expect(document.getElementById('api-client-scope-deployment-execute')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Create Client/i })).toBeDisabled();
    expect(screen.getAllByText('CI deployer').length).toBeGreaterThan(0);
    expect(screen.getByText('egsa_service')).toBeInTheDocument();
    expect(screen.getByLabelText('Service account name')).toBeInTheDocument();
    expect(screen.getAllByText('deployment:execute').length).toBeGreaterThan(0);
    expect(screen.getAllByText('External Engine').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Fleet Manager').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Hybrid').length).toBeGreaterThan(0);
    expect(screen.getAllByText('cluster-a/prod').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Active').length).toBeGreaterThan(0);
    expect(screen.getByText('In Sync')).toBeInTheDocument();
    expect(screen.getByText('Mismatch')).toBeInTheDocument();
    expect(screen.getByText('Missing: engine.deploy, engine.instance.mutate')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: /Reconcile/i })[0]);
    await waitFor(() => expect(reconcileExternalEngine).toHaveBeenCalledWith('engine-1'));
    await waitFor(() => expect(screen.getByText('Reconcile diagnostics')).toBeInTheDocument());
    expect(screen.getByText(/1 Engine Set checked; 0 created, 1 updated, 0 removed/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Decommission/i }));
    await waitFor(() => expect(decommissionExternalEngine).toHaveBeenCalledWith({
      id: 'engine-1',
      reason: 'Decommissioned from Access Control',
    }));
    fireEvent.click(screen.getByRole('button', { name: /Reactivate/i }));
    await waitFor(() => expect(reactivateExternalEngine).toHaveBeenCalledWith({
      id: 'engine-2',
      reason: 'Reactivated from Access Control',
    }));
    expect(screen.getByText('environment=prod, region=eu')).toBeInTheDocument();
  }, 60000);

  it('creates API clients with selected machine scopes', async () => {
    authState.permissions = {
      ...authState.permissions,
      platform: [...authState.permissions.platform, 'platform:api-clients:manage'],
    };

    render(<AccessControl />);

    fireEvent.click(screen.getByRole('tab', { name: /External Registration/i }));
    fireEvent.change(screen.getByLabelText('Client name'), { target: { value: 'Deploy bot' } });
    fireEvent.click(document.getElementById('api-client-scope-config-bundle-manage')!);
    fireEvent.click(document.getElementById('api-client-scope-deployment-execute')!);
    const createClientButton = screen.getByRole('button', { name: /Create Client/i });
    await waitFor(() => expect(createClientButton).not.toBeDisabled());
    fireEvent.click(createClientButton);

    await waitFor(() => expect(createApiClient).toHaveBeenCalledWith({
      name: 'Deploy bot',
      scopes: ['engine:register', 'config:bundle:manage', 'deployment:execute'],
    }));
  }, 60000);

  it('creates service accounts for machine role assignment', async () => {
    authState.permissions = {
      ...authState.permissions,
      platform: [...authState.permissions.platform, 'platform:service-accounts:manage'],
    };

    render(<AccessControl />);

    fireEvent.click(screen.getByRole('tab', { name: /External Registration/i }));
    fireEvent.change(screen.getByLabelText('Service account name'), { target: { value: 'Release service' } });
    fireEvent.change(screen.getByLabelText('Service account description'), { target: { value: 'Release automation' } });
    const createServiceAccountButton = screen.getByRole('button', { name: /Create Service Account/i });
    await waitFor(() => expect(createServiceAccountButton).not.toBeDisabled());
    fireEvent.click(createServiceAccountButton);

    await waitFor(() => expect(createServiceAccount).toHaveBeenCalledWith({
      name: 'Release service',
      description: 'Release automation',
      scopes: ['deployment:execute'],
    }));
  }, 60000);

  it('creates, edits, and archives external engine systems', () => {
    render(<AccessControl />);

    fireEvent.click(screen.getByRole('tab', { name: /External Registration/i }));
    fireEvent.change(document.getElementById('external-system-key')!, { target: { value: 'cmdb' } });
    fireEvent.change(document.getElementById('external-system-name')!, { target: { value: 'CMDB' } });
    fireEvent.change(document.getElementById('external-system-description')!, { target: { value: 'External CMDB' } });
    const createSystemButton = screen.getByText(/^Create System$/i);
    expect(createSystemButton).not.toBeDisabled();
    fireEvent.click(createSystemButton);

    expect(createExternalSystem).toHaveBeenCalledWith({
      key: 'cmdb',
      name: 'CMDB',
      description: 'External CMDB',
      defaultManagementMode: 'external_managed',
      defaultFieldOwnership: {
        connection: 'external',
        auth: 'external',
        display: 'manual',
      },
    });

    const systemRow = screen.getByText('fleet-manager').closest('tr')!;
    fireEvent.click(within(systemRow).getByRole('button', { name: /Edit/i }));
    expect(document.getElementById('external-system-key')).toHaveValue('fleet-manager');
    fireEvent.change(document.getElementById('external-system-name')!, { target: { value: 'Fleet Manager EU' } });
    fireEvent.click(screen.getByText(/^Update System$/i));

    expect(updateExternalSystem).toHaveBeenCalledWith({
      id: 'system-1',
      name: 'Fleet Manager EU',
      description: 'External CMDB',
      defaultManagementMode: 'hybrid',
      defaultFieldOwnership: {
        connection: 'external',
        auth: 'external',
        display: 'manual',
      },
    });

    fireEvent.click(within(systemRow).getByRole('button', { name: /Archive/i }));
    expect(archiveExternalSystem).toHaveBeenCalledWith('system-1');
  }, 60000);
});
