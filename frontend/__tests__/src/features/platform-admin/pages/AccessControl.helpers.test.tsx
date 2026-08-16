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

describe('AccessControl helpers', () => {
  beforeEach(resetAccessControlMocks);

  it('filters API-client assignable roles to machine-safe system roles', () => {
    const roles = [
      {
        id: 'system.api.engine_registrar',
        key: 'system.api.engine_registrar',
        name: 'API Engine Registrar',
        description: null,
        scope: 'platform',
        kind: 'system',
        isEditable: false,
        isAssignable: true,
        isArchived: false,
        permissionCount: 1,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'system.platform.admin',
        key: 'system.platform.admin',
        name: 'Platform Admin',
        description: null,
        scope: 'platform',
        kind: 'system',
        isEditable: false,
        isAssignable: true,
        isArchived: false,
        permissionCount: 10,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'system.api.external_engine_system_registrar',
        key: 'system.api.external_engine_system_registrar',
        name: 'API External System Registrar',
        description: null,
        scope: 'external_engine_system',
        kind: 'system',
        isEditable: false,
        isAssignable: true,
        isArchived: false,
        permissionCount: 1,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'system.project.deployer',
        key: 'system.project.deployer',
        name: 'Project Deployer',
        description: null,
        scope: 'project',
        kind: 'system',
        isEditable: false,
        isAssignable: true,
        isArchived: false,
        permissionCount: 1,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'custom.project.editor',
        key: 'custom.project.editor',
        name: 'Project Editor Custom',
        description: null,
        scope: 'project',
        kind: 'custom',
        isEditable: true,
        isAssignable: true,
        isArchived: false,
        permissionCount: 2,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'system.engine.deployer',
        key: 'system.engine.deployer',
        name: 'Engine Deployer',
        description: null,
        scope: 'engine',
        kind: 'system',
        isEditable: false,
        isAssignable: true,
        isArchived: false,
        permissionCount: 2,
        createdAt: 1,
        updatedAt: 1,
      },
    ] as RoleSummary[];

    expect(getAssignableRolesForPrincipal(roles, 'platform', 'api_client').map((role) => role.id)).toEqual([
      'system.api.engine_registrar',
    ]);
    expect(getAssignableRolesForPrincipal(roles, 'platform', 'service_account')).toEqual([]);
    expect(getAssignableRolesForPrincipal(roles, 'external_engine_system', 'api_client').map((role) => role.id)).toEqual([
      'system.api.external_engine_system_registrar',
    ]);
    expect(getAssignableRolesForPrincipal(roles, 'external_engine_system', 'service_account')).toEqual([]);
    expect(getAssignableRolesForPrincipal(roles, 'project', 'api_client').map((role) => role.id)).toEqual([
      'system.project.deployer',
    ]);
    expect(getAssignableRolesForPrincipal(roles, 'engine', 'api_client').map((role) => role.id)).toEqual([
      'system.engine.deployer',
    ]);
    expect(getAssignableRolesForPrincipal(roles, 'project', 'service_account').map((role) => role.id)).toEqual([
      'system.project.deployer',
    ]);
    expect(getAssignableRolesForPrincipal(roles, 'project', 'user').map((role) => role.id)).toEqual([
      'system.project.deployer',
      'custom.project.editor',
    ]);
    expect(getAssignableRolesForPrincipal(roles, 'project', 'group').map((role) => role.id)).toEqual([
      'system.project.deployer',
      'custom.project.editor',
    ]);
  });

  it('filters roles by search query and scope', () => {
    const manualRoleOwnership = {
      source: 'manual' as const,
      sourceRef: null,
      ownershipMode: 'manual' as const,
      sourceHash: null,
      lastAppliedAt: null,
      driftStatus: null,
    };
    const roles: RoleSummary[] = [
      {
        id: 'system.platform.admin',
        key: 'system.platform.admin',
        name: 'Platform Admin',
        description: 'Admin',
        scope: 'platform',
        kind: 'system',
        isEditable: false,
        isAssignable: true,
        isArchived: false,
        ...manualRoleOwnership,
        permissionCount: 1,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'custom.engine.operator',
        key: 'custom.engine.operator',
        name: 'Custom Operator',
        description: 'Custom',
        scope: 'engine',
        kind: 'custom',
        isEditable: true,
        isAssignable: true,
        isArchived: false,
        ...manualRoleOwnership,
        permissionCount: 2,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'system.project.viewer',
        key: 'system.project.viewer',
        name: 'Project Viewer',
        description: 'Read projects',
        scope: 'project',
        kind: 'system',
        isEditable: false,
        isAssignable: true,
        isArchived: false,
        ...manualRoleOwnership,
        permissionCount: 3,
        createdAt: 1,
        updatedAt: 1,
      },
    ];

    expect(filterRoles(roles, 'operator', 'all').map((role) => role.id)).toEqual(['custom.engine.operator']);
    expect(filterRoles(roles, '', 'engine').map((role) => role.id)).toEqual(['custom.engine.operator']);
    expect(filterRoles(roles, 'project', 'engine')).toEqual([]);
  });

  it('classifies dangerous permissions and quick-filter groups', () => {
    const permissions: PermissionCatalogEntry[] = [
      { key: 'platform:users:permanent-delete', scope: 'platform', category: 'User Management', label: 'Permanent delete users', description: 'Permanently delete users' },
      { key: 'engine:instance:view', scope: 'engine', category: 'Engine', label: 'View instances', description: 'View instances' },
      { key: 'project:files:edit', scope: 'project', category: 'Project', label: 'Edit files', description: 'Edit files' },
      { key: 'engine:process:start', scope: 'engine', category: 'Engine', label: 'Start process', description: 'Start process' },
      { key: 'engine:deploy', scope: 'engine', category: 'Engine', label: 'Deploy', description: 'Deploy' },
      { key: 'engine:members:add', scope: 'engine', category: 'Engine', label: 'Add engine members', description: 'Add engine members' },
      { key: 'engine:project-access:approve', scope: 'engine', category: 'Engine', label: 'Approve engine access', description: 'Approve engine access' },
      { key: 'engine:environment:lock', scope: 'engine', category: 'Engine', label: 'Lock engine environment', description: 'Lock engine environment' },
    ];

    expect(getPermissionRisk(permissions[0])?.label).toBe('Permanent delete');
    expect(getPermissionRisk(permissions[5])?.label).toBe('Access control');
    expect(getPermissionRisk(permissions[6])?.label).toBe('Access control');
    expect(getPermissionRisk(permissions[7])?.label).toBe('Sensitive operation');
    expect(getPermissionImplications(permissions[2])).toEqual(['project:files:view']);
    expect(getPermissionImplications(permissions[3])).toEqual(['engine:instance:view']);
    expect(getPermissionImplications(permissions[4])).toEqual(['engine:deploy:view']);
    expect(getPermissionImplications(permissions[5])).toEqual(['engine:members:view']);
    expect(filterPermissions(permissions, 'view').map((permission) => permission.key)).toEqual(['engine:instance:view']);
    expect(filterPermissions(permissions, 'editor').map((permission) => permission.key)).toEqual(['project:files:edit']);
    expect(filterPermissions(permissions, 'operator').map((permission) => permission.key)).toEqual(['engine:instance:view', 'engine:process:start']);
    expect(filterPermissions(permissions, 'deployment').map((permission) => permission.key)).toEqual(['engine:deploy']);
  });

  it('summarizes direct and group-inherited principal access', () => {
    const summaries = buildPrincipalSummaries(
      [
        {
          id: 'direct-1',
          userId: 'user-1',
          principalType: 'user',
          principalId: 'user-1',
          principalDisplayName: 'Ada Lovelace',
          principalSecondary: 'ada@example.test',
          roleId: 'custom.engine.operator',
          roleName: 'Custom Operator',
          resourceType: 'engine',
          resourceId: 'engine-1',
          source: 'manual',
        } as RoleAssignment,
        {
          id: 'group-assign-1',
          userId: '',
          principalType: 'group',
          principalId: 'group-1',
          roleId: 'system.engine.deployer',
          roleName: 'Engine Deployer',
          resourceType: 'engine',
          resourceId: 'engine-2',
          source: 'manual',
        } as RoleAssignment,
      ],
      [
        {
          id: 'group-1',
          key: 'operations',
          name: 'Operations',
          description: null,
          source: 'manual',
          sourceRef: null,
          isSystem: false,
          isArchived: false,
          createdById: 'admin-1',
          createdAt: 1,
          updatedAt: 1,
        } as AuthzGroup,
      ],
      [
        {
          id: 'membership-1',
          groupId: 'group-1',
          groupName: 'Operations',
          userId: 'user-1',
          source: 'manual',
          sourceRef: null,
          expiresAt: null,
          createdById: 'admin-1',
          createdAt: 1,
          updatedAt: 1,
        } as AuthzGroupMembership,
      ],
      [],
      [],
    );

    const user = summaries.find((summary) => summary.key === 'user:user-1');
    expect(user).toMatchObject({
      label: 'Ada Lovelace',
      detail: 'ada@example.test',
      directAssignmentCount: 1,
      inheritedAssignmentCount: 1,
      relationshipCount: 1,
    });
    expect(summaries.find((summary) => summary.key === 'group:group-1')).toMatchObject({
      label: 'Operations',
      directAssignmentCount: 1,
    });
  });

  it('summarizes resource assignments by principal type', () => {
    const summaries = buildResourceSummaries(
      [
        {
          id: 'user-engine-1',
          userId: 'user-1',
          principalType: 'user',
          principalId: 'user-1',
          roleId: 'custom.engine.operator',
          resourceType: 'engine',
          resourceId: 'engine-1',
          source: 'manual',
        } as RoleAssignment,
        {
          id: 'group-engine-1',
          userId: '',
          principalType: 'group',
          principalId: 'group-1',
          roleId: 'system.engine.deployer',
          resourceType: 'engine',
          resourceId: 'engine-1',
          source: 'manual',
        } as RoleAssignment,
        {
          id: 'machine-system-1',
          userId: '',
          principalType: 'api_client',
          principalId: 'client-1',
          roleId: 'system.api.external_engine_system_registrar',
          resourceType: 'external_engine_system',
          resourceId: 'system-1',
          source: 'manual',
        } as RoleAssignment,
      ],
      [{ id: 'system-1', key: 'fleet', name: 'Fleet', isActive: true } as any],
      [],
      [{ id: 'engine-1', name: 'External Engine', lifecycleStatus: 'active' } as ExternalEngineRegistration],
      [],
    );

    expect(summaries.find((summary) => summary.key === 'engine:engine-1')).toMatchObject({
      label: 'External Engine',
      assignmentCount: 2,
      userAssignmentCount: 1,
      groupAssignmentCount: 1,
      machineAssignmentCount: 0,
    });
    expect(summaries.find((summary) => summary.key === 'external_engine_system:system-1')).toMatchObject({
      label: 'Fleet',
      assignmentCount: 1,
      machineAssignmentCount: 1,
    });
  });

  it('builds Engine Set selectors from form state', () => {
    expect(buildEngineSetSelector({
      key: '',
      name: 'All',
      description: '',
      selectorMode: 'all',
      engineIds: '',
      labelKey: '',
      labelValue: '',
      labelMatch: 'all',
    })).toEqual({ mode: 'all' });

    expect(buildEngineSetSelector({
      key: '',
      name: 'Explicit engines',
      description: '',
      selectorMode: 'engine_ids',
      engineIds: 'engine-1, engine-2',
      labelKey: '',
      labelValue: '',
      labelMatch: 'all',
    })).toEqual({ mode: 'engine_ids', engineIds: ['engine-1', 'engine-2'] });

    expect(buildEngineSetSelector({
      key: '',
      name: 'Production',
      description: '',
      selectorMode: 'labels',
      engineIds: '',
      labelKey: 'environment',
      labelValue: 'prod',
      labelMatch: 'all',
    })).toEqual({ mode: 'labels', labels: { environment: 'prod' }, labelMatch: 'all' });
  });

});
