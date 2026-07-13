import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import EnginesPage, {
  buildEngineMutationPayload,
  formatEngineAccessMemberGovernance,
  formatEngineAccessMemberName,
  formatEngineAccessPrincipal,
  formatEngineAccessRole,
  formatEngineAccessSourceLineage,
  formatEngineCapabilityDiagnostics,
  formatEngineCapabilitySummary,
  formatEngineFieldOwnership,
  formatEngineLabels,
  getEngineLabelEntries,
  getEngineMetadataFilterOptions,
  matchesEngineMetadataFilter,
  formatProjectEngineTargetModes,
  formatProjectEngineTargetProject,
  formatProjectEngineTargetStatus,
  formatEngineRegistrationSource,
  formatEngineRegistrationStatus,
  formatEngineTimestamp,
  getEngineActionPermissions,
  getEngineDeleteUnavailableReason,
  getEngineLifecycleUnavailableReason,
  getEngineMembersUnavailableReason,
  getEngineRowDiagnosticTags,
  getEngineTestUnavailableReason,
  resolveEngineDetailSections,
  isEngineGovernanceRoleAssignment,
  isConfigLockedEngine,
  isConfigWarnEngine,
  isExternallyManagedEngine,
  isExternallyRegisteredEngine,
  legacyEngineRoleHasPermission,
} from '@src/features/mission-control/engines/EnginesPage';
import { apiClient } from '@src/shared/api/client';
import { EnginePermission } from '@src/shared/auth/permissions';

const authState = vi.hoisted(() => ({
  permissions: {
    userId: 'user-1',
    platform: ['platform:engine:create'],
    projects: [],
    engines: [],
    generatedAt: 1,
  } as any,
  refreshUser: vi.fn(),
}));

vi.mock('@src/shared/api/client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@src/shared/hooks/useAuth', () => ({
  useAuth: () => ({
    permissions: authState.permissions,
    refreshUser: authState.refreshUser,
    hasEnginePermission: (engineId: string | null | undefined, permission: string) => Boolean(
      engineId && authState.permissions?.engines?.some((entry: any) => entry.resourceId === engineId && entry.permissions.includes(permission))
    ),
  }),
}));

vi.mock('@src/shared/notifications/ToastProvider', () => ({
  useToast: () => ({ notify: vi.fn() }),
}));

describe('EnginesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.permissions = {
      userId: 'user-1',
      platform: ['platform:engine:create'],
      projects: [],
      engines: [],
      generatedAt: 1,
    };
    vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
      if (url === '/api/auth/platform-settings') return { engineOnboardingMode: 'manual_allowed', projectEngineTargetMode: 'manual_allowed' };
      if (url === '/engines-api/environment-tags') return [];
      if (url === '/engines-api/engines') return [];
      return [];
    });
  });

  it('exports EnginesPage component', () => {
    expect(EnginesPage).toBeDefined();
    expect(typeof EnginesPage).toBe('function');
  });

  it('builds stable metadata filters from engine labels and matches exact values', () => {
    const options = getEngineMetadataFilterOptions([
      { labels: { country: 'TR', domain: 'payments' } },
      { labels: { country: 'TR', region: 'eu-west' } },
    ]);

    expect(getEngineLabelEntries({ region: 'eu-west', country: 'TR', ignored: 1 })).toEqual([
      ['country', 'TR'],
      ['region', 'eu-west'],
    ]);
    expect(options.map((option) => option.label)).toEqual(['country: TR', 'domain: payments', 'region: eu-west']);
    expect(matchesEngineMetadataFilter({ labels: { country: 'TR' } }, options[0].id)).toBe(true);
    expect(matchesEngineMetadataFilter({ labels: { country: 'NL' } }, options[0].id)).toBe(false);
  });

  function renderPage() {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/t/default/engines']}>
          <EnginesPage />
        </MemoryRouter>
      </QueryClientProvider>
    );
  }

  it('enables manual engine creation when the platform create action is allowed', async () => {
    renderPage();

    expect(await screen.findByRole('button', { name: /add your first engine/i })).toBeEnabled();
  });

  it('hides manual engine creation when onboarding mode is external-only', async () => {
    vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
      if (url === '/api/auth/platform-settings') return { engineOnboardingMode: 'external_only', projectEngineTargetMode: 'manual_allowed' };
      if (url === '/engines-api/environment-tags') return [];
      if (url === '/engines-api/engines') return [];
      return [];
    });

    renderPage();

    expect(await screen.findByText(/engines are registered by external systems/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /add your first engine/i })).not.toBeInTheDocument();
    });
  });

  it('disables manual engine creation when the platform create action is denied', async () => {
    authState.permissions = {
      userId: 'user-1',
      platform: [],
      projects: [],
      engines: [
        {
          resourceId: 'engine-1',
          permissions: [EnginePermission.INSTANCE_VIEW],
        },
      ],
      generatedAt: 1,
    };

    renderPage();

    expect(await screen.findByRole('button', { name: /add your first engine/i })).toBeDisabled();
  });

  it('opens read-only registration details for visible engines without edit permission', async () => {
    authState.permissions = {
      userId: 'user-1',
      platform: [],
      projects: [],
      engines: [
        {
          resourceId: 'engine-1',
          permissions: [EnginePermission.INSTANCE_VIEW, EnginePermission.MEMBERS_VIEW, EnginePermission.PROJECT_ACCESS_VIEW, EnginePermission.DEPLOY_VIEW],
        },
      ],
      generatedAt: 1,
    };
    vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
      if (url === '/api/auth/platform-settings') return { engineOnboardingMode: 'manual_allowed', projectEngineTargetMode: 'manual_allowed' };
      if (url === '/engines-api/environment-tags') return [];
      if (url === '/engines-api/engines') return [
        {
          id: 'engine-1',
          name: 'External Engine',
          baseUrl: 'https://engine.example.com',
          type: 'operaton',
          registrationSource: 'external_api',
          externalSystemId: 'system-1',
          externalId: 'fleet/prod',
          managementMode: 'hybrid',
          lifecycleStatus: 'active',
          driftStatus: 'manual_override',
          capabilityStatus: 'mismatch',
          lastExternalSyncAt: 1704067200000,
          externalUpdatedAt: 1704067260000,
          labels: { env: 'prod', team: 'payments' },
          fieldOwnership: { connection: 'external', display: 'manual' },
          capabilities: {
            compatibilityProfile: 'camunda7-rest',
            supportLevel: 'compatible',
            operations: ['engine.read', 'engine.deploy'],
          },
          reportedCapabilities: {
            compatibilityProfile: 'camunda7-rest',
            supportLevel: 'compatible',
            operations: ['engine.read'],
          },
          capabilityDiagnostics: {
            status: 'mismatch',
            expectedOperations: ['engine.batch.admin', 'engine.deploy', 'engine.read'],
            reportedOperations: ['engine.read'],
            missingOperations: ['engine.batch.admin', 'engine.deploy'],
            extraOperations: [],
            expectedSupportLevel: 'compatible',
            reportedSupportLevel: 'compatible',
            expectedCompatibilityProfile: 'camunda7-rest',
            reportedCompatibilityProfile: 'camunda7-rest',
            issues: ['Missing expected operations: engine.batch.admin, engine.deploy.'],
            recommendation: 'Update the external registration payload to report the missing operations, then run reconcile again.',
          },
        },
      ];
      if (url === '/engines-api/engines/engine-1/project-targets') return [
        {
          id: 'target-1',
          projectId: 'project-1',
          projectName: 'Payments App',
          status: 'active',
          source: 'legacy',
          allowManualDeploy: true,
          allowCiDeploy: false,
          allowApiDeploy: true,
          allowImport: true,
          environment: { id: 'env-prod', name: 'Production', color: '#24a148', manualDeployAllowed: true },
          lastSeenAt: 1704067300000,
          updatedAt: 1704067400000,
        },
      ];
      if (url === '/engines-api/engines/engine-1/deployment-history') return [
        {
          id: 'history-1', engineDeploymentId: 'deployment-1', deploymentName: 'Payments release', deploymentTime: null,
          projectId: 'project-1', ingestionSource: 'pipeline_receipt', lineageQuality: 'reported', reportingPrincipalId: 'release-bot',
          deployedAt: 1704067200000, reconciledAt: 1704067300000, resourceCount: 2, status: 'success',
        },
      ];
      if (url === '/engines-api/engines/engine-1/members') return {
        members: [
          {
            id: 'owner-user-1',
            engineId: 'engine-1',
            userId: 'user-1',
            role: 'owner',
            createdAt: 1704067100000,
            user: { id: 'user-1', email: 'owner@example.com', firstName: 'Owner', lastName: 'User' },
          },
        ],
        pendingInvites: [
          { invitationId: 'invite-1', email: 'operator@example.com', role: 'operator', status: 'pending' },
        ],
      };
      if (url === '/api/authz/role-assignments?resourceType=engine&resourceId=engine-1') return [
        {
          id: 'governance-owner-1',
          userId: 'user-1',
          principalType: 'user',
          principalId: 'user-1',
          roleId: 'system.engine.owner',
          roleName: null,
          roleScope: 'engine',
          resourceType: 'engine',
          resourceId: 'engine-1',
          scopeType: 'engine',
          scopeId: 'engine-1',
          source: 'system',
          sourceMappingId: 'engine:engine-1:governance-owner',
          sourceRef: 'engine:engine-1:governance-owner',
          expiresAt: null,
          lastSeenAt: 1704067200000,
          createdById: null,
          createdAt: 1704067200000,
          updatedAt: 1704067200000,
        },
        {
          id: 'governance-owner-2',
          userId: 'group-owners',
          principalType: 'group',
          principalId: 'group-owners',
          roleId: 'system.engine.owner',
          roleName: null,
          roleScope: 'engine',
          resourceType: 'engine',
          resourceId: 'engine-1',
          scopeType: 'engine',
          scopeId: 'engine-1',
          source: 'manual',
          sourceMappingId: null,
          sourceRef: 'manual:engine-owner',
          expiresAt: null,
          lastSeenAt: 1704067200000,
          createdById: 'user-1',
          createdAt: 1704067200000,
          updatedAt: 1704067200000,
        },
        {
          id: 'assignment-1',
          userId: 'group-1',
          principalType: 'group',
          principalId: 'group-1',
          roleId: 'system.engine.operator',
          roleName: 'Engine Operator',
          roleScope: 'engine',
          resourceType: 'engine',
          resourceId: 'engine-1',
          scopeType: 'engine',
          scopeId: 'engine-1',
          source: 'sso',
          sourceMappingId: 'mapping-1',
          sourceRef: 'sso-group:payments-ops',
          expiresAt: null,
          lastSeenAt: 1704067200000,
          createdById: null,
          createdAt: 1704067200000,
          updatedAt: 1704067200000,
        },
      ];
      return null;
    });

    renderPage();

    expect(await screen.findByText('External Engine')).toBeInTheDocument();
    expect(screen.getByText('Drift: Manual Override')).toBeInTheDocument();
    expect(screen.getByText('Capability: Mismatch')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /options/i }));
    fireEvent.click((await screen.findByText('View details')).closest('button')!);

    expect(await screen.findByText('Engine details')).toBeInTheDocument();
    expect(screen.getByText('Registration')).toBeInTheDocument();
    expect(screen.getAllByText('External API').length).toBeGreaterThan(0);
    expect(screen.getByText('fleet/prod')).toBeInTheDocument();
    expect(screen.getByText('Manual Override')).toBeInTheDocument();
    expect(screen.getByText('env=prod, team=payments')).toBeInTheDocument();
    expect(screen.getByText('External: connection | Manual: display')).toBeInTheDocument();
    expect(screen.getByText('camunda7-rest, Compatible, 2 operations')).toBeInTheDocument();
    expect(screen.getByText('camunda7-rest, Compatible, 1 operation')).toBeInTheDocument();
    expect(screen.getByText('Missing: engine.batch.admin, engine.deploy')).toBeInTheDocument();
    expect(await screen.findByText('Access')).toBeInTheDocument();
    expect(screen.getByText('Accountable owner')).toBeInTheDocument();
    expect(screen.getByText('Effective owners')).toBeInTheDocument();
    expect(screen.getByText('Owner User, Group: group-owners')).toBeInTheDocument();
    expect((await screen.findAllByText('Owner User')).length).toBeGreaterThan(0);
    expect(screen.getByText(/owner@example.com.*Accountable owner/)).toBeInTheDocument();
    expect(screen.getByText('Governance grants')).toBeInTheDocument();
    expect(screen.getAllByText('Managed governance').length).toBeGreaterThan(1);
    expect(screen.getByText('Group: group-1')).toBeInTheDocument();
    expect(screen.getByText('Engine Operator')).toBeInTheDocument();
    expect(screen.getByText('SSO-managed assignment; Source ref sso-group:payments-ops; SSO mapping mapping-1')).toBeInTheDocument();
    expect(screen.getByText('1 pending invite also exists for this engine.')).toBeInTheDocument();
    expect(await screen.findByText('Deployment targets')).toBeInTheDocument();
    expect(await screen.findByText('Deployment history')).toBeInTheDocument();
    expect(screen.getByText('Payments release')).toBeInTheDocument();
    expect(screen.getByText('reported')).toBeInTheDocument();
    expect(screen.getByText('pipeline_receipt')).toBeInTheDocument();
    expect(screen.getByText('Reported by release-bot')).toBeInTheDocument();
    expect(await screen.findByText('Payments App')).toBeInTheDocument();
    expect(screen.getByText('Manual, API, Import')).toBeInTheDocument();
    expect(screen.getByText('Legacy')).toBeInTheDocument();
    expect(screen.getByText('Production')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toBeDisabled();
  });

  it('hides engine detail sections when scoped section permissions are missing', async () => {
    authState.permissions = {
      userId: 'user-1',
      platform: [],
      projects: [],
      engines: [
        {
          resourceId: 'engine-1',
          permissions: [EnginePermission.INSTANCE_VIEW],
        },
      ],
      generatedAt: 1,
    };
    vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
      if (url === '/api/auth/platform-settings') return { engineOnboardingMode: 'manual_allowed', projectEngineTargetMode: 'manual_allowed' };
      if (url === '/engines-api/environment-tags') return [];
      if (url === '/engines-api/engines') return [
        {
          id: 'engine-1',
          name: 'Visible Engine',
          baseUrl: 'https://engine.example.com',
          type: 'operaton',
          registrationSource: 'user',
          myRole: null,
        },
      ];
      return [];
    });

    renderPage();

    expect(await screen.findByText('Visible Engine')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /options/i }));
    fireEvent.click((await screen.findByText('View details')).closest('button')!);

    expect(await screen.findByText('Engine details')).toBeInTheDocument();
    expect(screen.getByText('Registration')).toBeInTheDocument();
    expect(screen.queryByText('Access')).not.toBeInTheDocument();
    expect(screen.queryByText('Deployment targets')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toBeDisabled();
  });

  it('disables row detail viewing when engine inventory read is denied', async () => {
    authState.permissions = {
      userId: 'user-1',
      platform: [],
      projects: [],
      engines: [],
      generatedAt: 1,
    };
    vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
      if (url === '/api/auth/platform-settings') return { engineOnboardingMode: 'manual_allowed', projectEngineTargetMode: 'manual_allowed' };
      if (url === '/engines-api/environment-tags') return [];
      if (url === '/engines-api/engines') return [
        {
          id: 'engine-1',
          name: 'Visible Engine',
          baseUrl: 'https://engine.example.com',
          type: 'operaton',
          registrationSource: 'user',
          myRole: null,
        },
      ];
      return [];
    });

    renderPage();

    expect(await screen.findByText('Visible Engine')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /options/i }));

    const viewDetails = await screen.findByText('View details');
    expect(viewDetails.closest('button')).toBeDisabled();
    fireEvent.click(viewDetails);
    expect(screen.queryByText('Engine details')).not.toBeInTheDocument();
  });

  it('preserves legacy owner and delegate action access', () => {
    const noScopedPermissions = () => false;

    expect(getEngineActionPermissions({ id: 'engine-1', myRole: 'owner' }, noScopedPermissions)).toMatchObject({
      canEdit: true,
      canDelete: true,
      canTest: true,
      canViewSecrets: true,
      canManageSecrets: true,
      canViewMembers: true,
      canManageMembers: true,
    });
    expect(getEngineActionPermissions({ id: 'engine-1', myRole: 'delegate' }, noScopedPermissions)).toMatchObject({
      canEdit: true,
      canDelete: true,
      canTest: true,
      canViewSecrets: true,
      canManageSecrets: true,
      canViewMembers: true,
      canManageMembers: true,
    });
  });

  it('maps legacy operator and deployer roles without over-granting management actions', () => {
    const noScopedPermissions = () => false;

    expect(getEngineActionPermissions({ id: 'engine-1', myRole: 'operator' }, noScopedPermissions)).toMatchObject({
      canEdit: false,
      canDelete: false,
      canTest: false,
      canViewSecrets: false,
      canManageSecrets: false,
      canViewMembers: true,
      canManageMembers: false,
    });
    expect(getEngineActionPermissions({ id: 'engine-1', myRole: 'deployer' }, noScopedPermissions)).toMatchObject({
      canEdit: false,
      canDelete: false,
      canTest: false,
      canViewSecrets: false,
      canManageSecrets: false,
      canViewMembers: false,
      canManageMembers: false,
    });
  });

  it('enables actions from scoped engine permission snapshots', () => {
    const scopedPermissions = new Set([
      EnginePermission.ENGINE_EDIT,
      EnginePermission.ENGINE_DELETE,
      EnginePermission.SECRETS_VIEW,
      EnginePermission.SECRETS_MANAGE,
      EnginePermission.MEMBERS_MANAGE,
      EnginePermission.ENVIRONMENT_SET,
      EnginePermission.ENVIRONMENT_LOCK,
      EnginePermission.OWNERSHIP_TRANSFER,
    ]);
    const hasScopedPermission = (_engineId: string | null | undefined, permission: string) => scopedPermissions.has(permission as any);

    expect(getEngineActionPermissions({ id: 'engine-1', myRole: null }, hasScopedPermission)).toMatchObject({
      canEdit: true,
      canDelete: true,
      canTest: true,
      canViewSecrets: true,
      canManageSecrets: true,
      canViewMembers: true,
      canManageMembers: true,
      canSetEnvironment: true,
      canLockEnvironment: true,
      canTransferOwnership: true,
    });
  });

  it('enables actions from registry-backed action decisions', () => {
    const noScopedPermissions = () => false;
    const actionDecisions = new Set([
      'engine.inventory.update',
      'engine.inventory.delete',
      'engine.secrets.view',
      'engine.secrets.manage',
      'engine.members.read',
      'engine.members.lookup',
      'engine.members.invite',
      'engine.members.add',
      'engine.members.update-role',
      'engine.members.remove',
      'engine.delegate.manage',
      'engine.ownership.transfer',
      'engine.environment.set',
      'engine.environment.lock',
      'engine.project-access.requests.read',
      'engine.project-access.requests.approve',
      'engine.project-access.requests.deny',
      'engine.project-access.revoke',
    ]);
    const hasAction = (_engineId: string | null | undefined, actionId: string) => actionDecisions.has(actionId);

    expect(getEngineActionPermissions({ id: 'engine-1', myRole: null }, noScopedPermissions, hasAction)).toMatchObject({
      canEdit: true,
      canDelete: true,
      canTest: true,
      canViewSecrets: true,
      canManageSecrets: true,
      canViewMembers: true,
      canLookupMembers: true,
      canInviteMembers: true,
      canAddMembers: true,
      canUpdateMemberRoles: true,
      canRemoveMembers: true,
      canManageDelegate: true,
      canTransferOwnership: true,
      canViewProjectAccess: true,
      canApproveProjectAccess: true,
      canDenyProjectAccess: true,
      canRevokeProjectAccess: true,
      canSetEnvironment: true,
      canLockEnvironment: true,
      canOpenMembers: true,
    });
  });

  it('does not enable engine actions when scoped permissions, action decisions, and legacy roles are absent', () => {
    const noScopedPermissions = () => false;
    const noActions = () => false;

    expect(getEngineActionPermissions({ id: 'engine-1', myRole: null }, noScopedPermissions, noActions)).toMatchObject({
      canEdit: false,
      canDelete: false,
      canTest: false,
      canViewSecrets: false,
      canManageSecrets: false,
      canViewMembers: false,
      canManageMembers: false,
      canLookupMembers: false,
      canInviteMembers: false,
      canAddMembers: false,
      canUpdateMemberRoles: false,
      canRemoveMembers: false,
      canManageDelegate: false,
      canTransferOwnership: false,
      canViewProjectAccess: false,
      canApproveProjectAccess: false,
      canDenyProjectAccess: false,
      canRevokeProjectAccess: false,
      canSetEnvironment: false,
      canLockEnvironment: false,
      canOpenMembers: false,
    });
  });

  it('enables engine member actions from operation-specific scoped permissions', () => {
    const scopedPermissions = new Set([
      EnginePermission.MEMBERS_LOOKUP,
      EnginePermission.MEMBERS_INVITE,
      EnginePermission.MEMBERS_ADD,
      EnginePermission.MEMBERS_UPDATE_ROLE,
      EnginePermission.MEMBERS_REMOVE,
      EnginePermission.PROJECT_ACCESS_VIEW,
      EnginePermission.PROJECT_ACCESS_APPROVE,
      EnginePermission.PROJECT_ACCESS_DENY,
      EnginePermission.PROJECT_ACCESS_REVOKE,
    ]);
    const hasScopedPermission = (_engineId: string | null | undefined, permission: string) => scopedPermissions.has(permission as any);

    expect(getEngineActionPermissions({ id: 'engine-1', myRole: null }, hasScopedPermission)).toMatchObject({
      canViewMembers: true,
      canManageMembers: false,
      canLookupMembers: true,
      canInviteMembers: true,
      canAddMembers: true,
      canUpdateMemberRoles: true,
      canRemoveMembers: true,
      canViewProjectAccess: true,
      canApproveProjectAccess: true,
      canDenyProjectAccess: true,
      canRevokeProjectAccess: true,
      canOpenMembers: true,
    });
  });

  it('does not grant delete to operator through legacy role mapping', () => {
    expect(legacyEngineRoleHasPermission({ myRole: 'operator' }, EnginePermission.ENGINE_DELETE)).toBe(false);
  });

  it('detects externally registered engines for edit warnings', () => {
    expect(isExternallyRegisteredEngine({ registrationSource: 'external_api' })).toBe(true);
    expect(isExternallyRegisteredEngine({ externalId: 'cluster-a/prod' })).toBe(true);
    expect(isExternallyRegisteredEngine({ registrationSource: 'manual' })).toBe(false);
    expect(formatEngineRegistrationSource({ registrationSource: 'config' })).toBe('Configuration');
    expect(formatEngineRegistrationSource({ registrationSource: 'external_api' })).toBe('External API');
    expect(formatEngineRegistrationSource({ registrationSource: 'user' })).toBe('Manual');
    expect(formatEngineRegistrationSource({ externalId: 'cluster-a/prod' })).toBe('External ID');
  });

  it('formats registration metadata for engine detail views', () => {
    expect(resolveEngineDetailSections({ isEditing: true, canViewMembers: true, canViewProjectAccess: true })).toEqual([
      'registration',
      'access',
      'deployment',
    ]);
    expect(resolveEngineDetailSections({ isEditing: true, canViewMembers: false, canViewProjectAccess: false })).toEqual([
      'registration',
    ]);
    expect(resolveEngineDetailSections({ isEditing: false, canViewMembers: true, canViewProjectAccess: true })).toEqual([
      'access',
      'deployment',
    ]);
    expect(formatEngineRegistrationStatus('manual_override')).toBe('Manual Override');
    expect(formatEngineRegistrationStatus(null)).toBe('-');
    expect(formatEngineLabels({ team: 'payments', env: 'prod' })).toBe('env=prod, team=payments');
    expect(formatEngineLabels({})).toBe('-');
    expect(formatEngineFieldOwnership({ auth: 'external', display: 'manual' })).toBe('External: auth | Manual: display');
    expect(formatEngineFieldOwnership(null)).toBe('-');
    expect(formatEngineTimestamp(1704067200000)).toBe('2024-01-01 00:00:00 UTC');
    expect(formatEngineTimestamp(null)).toBe('-');
    expect(formatEngineCapabilitySummary({
      compatibilityProfile: 'camunda7-rest',
      supportLevel: 'compatible',
      operations: ['engine.read', 'engine.deploy'],
    })).toBe('camunda7-rest, Compatible, 2 operations');
    expect(formatEngineCapabilitySummary(null)).toBe('-');
    expect(formatEngineCapabilityDiagnostics({
      status: 'in_sync',
      reportedOperations: ['engine.read'],
    })).toBe('All expected operations reported');
    expect(formatEngineCapabilityDiagnostics({
      status: 'mismatch',
      missingOperations: ['engine.deploy'],
      reportedOperations: ['engine.read'],
    })).toBe('Missing: engine.deploy');
    expect(formatEngineCapabilityDiagnostics({
      status: 'mismatch',
      extraOperations: ['engine.unknown'],
      reportedOperations: ['engine.read'],
    })).toBe('Extra: engine.unknown');
    expect(formatEngineCapabilityDiagnostics({
      status: 'unknown',
      reportedOperations: [],
    })).toBe('No operation capabilities reported');
    expect(formatEngineAccessMemberName({
      id: 'member-1',
      engineId: 'engine-1',
      userId: 'user-1',
      role: 'owner',
      user: { id: 'user-1', email: 'owner@example.com', firstName: 'Owner', lastName: 'User' },
    })).toBe('Owner User');
    expect(formatEngineAccessMemberGovernance({
      id: 'member-1',
      engineId: 'engine-1',
      userId: 'user-1',
      role: 'owner',
    })).toBe('Accountable owner');
    expect(formatEngineAccessMemberGovernance({
      id: 'member-2',
      engineId: 'engine-1',
      userId: 'user-2',
      role: 'operator',
    })).toBe('Scoped user access');
    expect(formatEngineAccessPrincipal({ id: 'assignment-1', principalType: 'api_client', principalId: 'client-1', roleId: 'system.api.engine_registrar', source: 'manual' })).toBe('API client: client-1');
    expect(formatEngineAccessRole('system.engine.deployer')).toBe('Deployer');
    expect(formatEngineAccessSourceLineage({ id: 'assignment-1', roleId: 'system.engine.operator', source: 'sso', sourceRef: 'sso-group:payments-ops', sourceMappingId: 'mapping-1' })).toBe('SSO-managed assignment; Source ref sso-group:payments-ops; SSO mapping mapping-1');
    expect(isEngineGovernanceRoleAssignment({ id: 'assignment-2', roleId: 'system.engine.owner', source: 'system' })).toBe(true);
    expect(isEngineGovernanceRoleAssignment({ id: 'assignment-3', roleId: 'system.engine.operator', source: 'manual' })).toBe(false);
    expect(formatProjectEngineTargetProject({ id: 'target-1', projectId: 'project-1', projectName: 'Payments App' })).toBe('Payments App');
    expect(formatProjectEngineTargetProject({ id: 'target-1', projectId: 'project-1' })).toBe('project-1');
    expect(formatProjectEngineTargetModes({
      id: 'target-1',
      projectId: 'project-1',
      allowManualDeploy: true,
      allowCiDeploy: true,
      allowApiDeploy: false,
      allowImport: true,
    })).toBe('Manual, CI, Import');
    expect(formatProjectEngineTargetModes({ id: 'target-1', projectId: 'project-1' })).toBe('-');
    expect(formatProjectEngineTargetStatus('disabled')).toBe('Disabled');
    expect(getEngineRowDiagnosticTags({
      registrationSource: 'config',
      ownershipMode: 'config_locked',
    }).map((tag) => tag.label)).toEqual(['Managed by config']);
    expect(getEngineRowDiagnosticTags({
      registrationSource: 'external_api',
      lifecycleStatus: 'decommissioned',
      driftStatus: 'manual_override',
      capabilityStatus: 'mismatch',
    }).map((tag) => tag.label)).toEqual([
      'External API',
      'Lifecycle: Decommissioned',
      'Drift: Manual Override',
      'Capability: Mismatch',
    ]);
    expect(getEngineRowDiagnosticTags({
      registrationSource: 'user',
      lifecycleStatus: 'active',
      driftStatus: 'in_sync',
      capabilityStatus: 'compatible',
    })).toEqual([]);
    expect(getEngineTestUnavailableReason({ canTest: false })).toBe('Missing permission engine:edit');
    expect(getEngineTestUnavailableReason({ canTest: true })).toBeNull();
    expect(getEngineLifecycleUnavailableReason({ lifecycleStatus: 'decommissioned' }, 'testing the connection')).toBe('Engine is decommissioned. Reactivate it from Access Control before testing the connection.');
    expect(getEngineLifecycleUnavailableReason({ lifecycleStatus: 'disabled' }, 'testing the connection')).toBe('Engine is disabled. Reactivate it from Access Control before testing the connection.');
    expect(getEngineTestUnavailableReason({ canTest: true }, { lifecycleStatus: 'decommissioned' })).toBe('Engine is decommissioned. Reactivate it from Access Control before testing the connection.');
    expect(getEngineMembersUnavailableReason({ canOpenMembers: false })).toBe('Missing permission engine:members:view');
    expect(getEngineMembersUnavailableReason({ canOpenMembers: true })).toBeNull();
    expect(getEngineDeleteUnavailableReason({ canDelete: false }, true)).toBe('Missing permission engine:delete');
    expect(getEngineDeleteUnavailableReason({ canDelete: true }, false)).toBe('Manual engine deletion is disabled by the current onboarding policy');
    expect(getEngineDeleteUnavailableReason({ canDelete: true }, true, { registrationSource: 'external_api' })).toBe('Externally registered engines must be decommissioned from Access Control or the owning external system.');
    expect(getEngineDeleteUnavailableReason({ canDelete: true }, true, { lifecycleStatus: 'decommissioned' })).toBe('Engine is decommissioned. Reactivate it from Access Control before deleting the engine.');
    expect(getEngineDeleteUnavailableReason({ canDelete: true }, true)).toBeNull();
  });

  it('only treats external API registrations as externally managed', () => {
    expect(isExternallyManagedEngine({ registrationSource: 'external_api' })).toBe(true);
    expect(isExternallyManagedEngine({ registrationSource: 'user', externalId: 'cluster-a/prod' })).toBe(false);
    expect(isExternallyManagedEngine({ externalId: 'cluster-a/prod' })).toBe(false);
    expect(isConfigLockedEngine({ registrationSource: 'config', ownershipMode: 'config_locked' })).toBe(true);
    expect(isConfigLockedEngine({ registrationSource: 'config', ownershipMode: 'config_warn' })).toBe(false);
    expect(isConfigWarnEngine({ registrationSource: 'config', ownershipMode: 'config_warn' })).toBe(true);
  });

  it('strips source-owned fields from externally managed engine update payloads', () => {
    expect(buildEngineMutationPayload({
      name: 'Display Name',
      baseUrl: 'https://manual.example.com/engine-rest',
      type: 'operaton',
      externalId: 'new-external-id',
      labels: { team: 'payments' },
      authType: 'basic',
      username: 'manual-user',
      passwordEnc: 'manual-secret',
      oauthTokenUrl: 'https://idp.example.com/token',
      oauthScopes: 'engine',
      oauthAudience: 'engine-api',
      version: '1.2.3',
      environmentTagId: 'env-prod',
      runtimeAccessScope: 'resource_aware',
      deploymentIntegration: 'direct_engine',
    }, { registrationSource: 'external_api' })).toEqual({
      name: 'Display Name',
      environmentTagId: 'env-prod',
    });
  });

  it('keeps normal engine update payload cleanup for locally managed engines', () => {
    expect(buildEngineMutationPayload({
      name: 'Manual Engine',
      baseUrl: 'https://manual.example.com/engine-rest',
      type: 'operaton',
      authType: 'none',
      username: 'unused',
      passwordEnc: 'unused',
      oauthTokenUrl: 'https://idp.example.com/token',
      oauthScopes: 'engine',
      oauthAudience: 'engine-api',
      environmentTagId: '',
      runtimeAccessScope: 'resource_aware',
      deploymentIntegration: 'direct_engine',
    }, { registrationSource: 'user' })).toMatchObject({
      name: 'Manual Engine',
      baseUrl: 'https://manual.example.com/engine-rest',
      type: 'operaton',
      authType: 'none',
      username: undefined,
      passwordEnc: null,
      oauthTokenUrl: undefined,
      oauthScopes: undefined,
      oauthAudience: undefined,
      runtimeAccessScope: 'resource_aware',
      deploymentIntegration: 'direct_engine',
    });
  });

  it('keeps an existing write-only engine credential when an edit omits a replacement', () => {
    expect(buildEngineMutationPayload({
      name: 'Manual Engine',
      baseUrl: 'https://manual.example.com/engine-rest',
      type: 'operaton',
      authType: 'basic',
      username: 'manual-user',
      passwordEnc: '',
    }, { registrationSource: 'user', hasCredential: true })).toMatchObject({
      passwordEnc: undefined,
    });
  });

  it('strips authentication fields from engine update payloads without secret management', () => {
    expect(buildEngineMutationPayload({
      name: 'Manual Engine',
      baseUrl: 'https://manual.example.com/engine-rest',
      type: 'operaton',
      authType: 'basic',
      username: 'manual-user',
      passwordEnc: 'manual-secret',
      oauthTokenUrl: 'https://idp.example.com/token',
      oauthScopes: 'engine',
      oauthAudience: 'engine-api',
      environmentTagId: 'env-prod',
    }, { registrationSource: 'user' }, { canManageSecrets: false })).toMatchObject({
      name: 'Manual Engine',
      baseUrl: 'https://manual.example.com/engine-rest',
      type: 'operaton',
      authType: undefined,
      username: undefined,
      passwordEnc: undefined,
      oauthTokenUrl: undefined,
      oauthScopes: undefined,
      oauthAudience: undefined,
      environmentTagId: 'env-prod',
    });
  });
});
