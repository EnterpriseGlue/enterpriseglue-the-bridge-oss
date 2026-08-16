import { describe, it, expect } from 'vitest';
import {
  authzQueryKeys,
  useArchiveCustomRole,
  useApiClients,
  useAssignRole,
  useCreateApiClient,
  useCreateCustomPermission,
  useCreateCustomRole,
  useCurrentUserPermissions,
  useEvaluateAccess,
  useExternalEngineAudit,
  useExternalEngines,
  usePermissionCatalog,
  useRbacRoles,
  useRevokeApiClient,
  useRotateApiClient,
  useRemoveRoleAssignment,
  useRoleAssignments,
  useRoleDetail,
  useAuthzPolicies,
  useCheckPermission,
  useAuthzAuditLog,
  useUpdateCustomRole,
} from '@src/features/platform-admin/hooks/useAuthzApi';

describe('useAuthzApi', () => {
  it('exports authz query keys', () => {
    expect(authzQueryKeys.myPermissions).toEqual(['platform-admin', 'authz', 'me', 'permissions']);
    expect(authzQueryKeys.permissions).toEqual(['platform-admin', 'authz', 'permissions']);
    expect(authzQueryKeys.roles).toEqual(['platform-admin', 'authz', 'roles']);
    expect(authzQueryKeys.roleDetail('role-1')).toEqual(['platform-admin', 'authz', 'roles', 'role-1']);
    expect(authzQueryKeys.roleAssignments({})).toEqual(['platform-admin', 'authz', 'role-assignments', {}]);
    expect(authzQueryKeys.apiClients).toEqual(['platform-admin', 'authz', 'api-clients']);
    expect(authzQueryKeys.externalEngines).toEqual(['platform-admin', 'authz', 'external-engines']);
    expect(authzQueryKeys.externalEngineAudit('engine-1')).toEqual(['platform-admin', 'authz', 'external-engines', 'engine-1', 'audit', undefined]);
    expect(authzQueryKeys.engineSets()).toEqual(['platform-admin', 'authz', 'engine-sets', undefined]);
    expect(authzQueryKeys.engineSet()).toEqual(['platform-admin', 'authz', 'engine-sets', 'detail', undefined]);
    expect(authzQueryKeys.engineSet()).not.toEqual(authzQueryKeys.engineSets());
    expect(authzQueryKeys.projectEngineTargets()).toEqual(['platform-admin', 'authz', 'project-engine-targets', undefined]);
    expect(authzQueryKeys.projectEngineTarget()).toEqual(['platform-admin', 'authz', 'project-engine-targets', 'detail', undefined]);
    expect(authzQueryKeys.projectEngineTarget()).not.toEqual(authzQueryKeys.projectEngineTargets());
    expect(authzQueryKeys.policies).toEqual(['platform-admin', 'authz', 'policies']);
    expect(authzQueryKeys.auditLog({})).toEqual(['platform-admin', 'authz', 'audit', {}]);
  });

  it('exports authz hooks', () => {
    expect(typeof useCurrentUserPermissions).toBe('function');
    expect(typeof usePermissionCatalog).toBe('function');
    expect(typeof useRbacRoles).toBe('function');
    expect(typeof useRoleDetail).toBe('function');
    expect(typeof useCreateCustomPermission).toBe('function');
    expect(typeof useCreateCustomRole).toBe('function');
    expect(typeof useUpdateCustomRole).toBe('function');
    expect(typeof useArchiveCustomRole).toBe('function');
    expect(typeof useRoleAssignments).toBe('function');
    expect(typeof useAssignRole).toBe('function');
    expect(typeof useRemoveRoleAssignment).toBe('function');
    expect(typeof useApiClients).toBe('function');
    expect(typeof useCreateApiClient).toBe('function');
    expect(typeof useRotateApiClient).toBe('function');
    expect(typeof useRevokeApiClient).toBe('function');
    expect(typeof useExternalEngines).toBe('function');
    expect(typeof useExternalEngineAudit).toBe('function');
    expect(typeof useEvaluateAccess).toBe('function');
    expect(typeof useAuthzPolicies).toBe('function');
    expect(typeof useCheckPermission).toBe('function');
    expect(typeof useAuthzAuditLog).toBe('function');
  });
});
