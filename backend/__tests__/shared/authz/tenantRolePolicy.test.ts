import { describe, expect, it } from 'vitest';
import {
  isTenantSafePermission,
  rolePermissionDependencyError,
  rolePermissionValidationError,
  TENANT_MACHINE_SAFE_PERMISSION_IDS,
  TENANT_SAFE_ENGINE_PERMISSION_IDS,
  TENANT_SAFE_PERMISSION_IDS,
  TENANT_SAFE_PROJECT_PERMISSION_IDS,
} from '@enterpriseglue/shared/authz/tenant-role-policy.js';
import {
  EnginePermissions,
  PermissionCatalog,
  PlatformPermissions,
  ProjectPermissions,
  SystemRoleDefinitions,
} from '@enterpriseglue/shared/services/platform-admin/permissions.js';

describe('tenant role permission policy', () => {
  it('classifies the complete project catalog and only runtime-safe engine actions as tenant-safe', () => {
    expect(new Set(TENANT_SAFE_PROJECT_PERMISSION_IDS)).toEqual(new Set(Object.values(ProjectPermissions)));
    expect(new Set(TENANT_SAFE_ENGINE_PERMISSION_IDS)).toEqual(new Set([
      EnginePermissions.DEPLOY,
      EnginePermissions.DEPLOY_VIEW,
      EnginePermissions.PROCESS_START,
      EnginePermissions.PROCESS_CANCEL,
      EnginePermissions.PROCESS_MODIFY,
      EnginePermissions.INSTANCE_VIEW,
      EnginePermissions.INSTANCE_DELETE,
      EnginePermissions.INSTANCE_RETRY,
      EnginePermissions.VARIABLES_METADATA_VIEW,
      EnginePermissions.VARIABLES_VALUE_VIEW,
      EnginePermissions.VARIABLES_EDIT,
    ]));
    expect(TENANT_SAFE_PERMISSION_IDS).toEqual(new Set([
      ...TENANT_SAFE_PROJECT_PERMISSION_IDS,
      ...TENANT_SAFE_ENGINE_PERMISSION_IDS,
    ]));
  });

  it('keeps platform, connection, secret, membership, and tenant-project-link administration outside tenant roles', () => {
    const prohibited = [
      ...Object.values(PlatformPermissions),
      ...Object.values(EnginePermissions).filter((permission) =>
        !TENANT_SAFE_ENGINE_PERMISSION_IDS.includes(permission as typeof TENANT_SAFE_ENGINE_PERMISSION_IDS[number])
      ),
    ];

    for (const permission of prohibited) {
      expect(isTenantSafePermission(permission)).toBe(false);
      expect(TENANT_MACHINE_SAFE_PERMISSION_IDS.has(permission)).toBe(false);
    }
    expect(TENANT_MACHINE_SAFE_PERMISSION_IDS).toEqual(new Set([
      ProjectPermissions.DEPLOY,
      ...TENANT_SAFE_ENGINE_PERMISSION_IDS,
    ]));
  });

  it('keeps the catalog flag and every immutable tenant role aligned with the classifier', () => {
    for (const permission of PermissionCatalog) {
      expect(permission.tenantSafe).toBe(isTenantSafePermission(permission.key));
    }
    for (const role of SystemRoleDefinitions.filter((candidate) => candidate.scope === 'tenant')) {
      expect(role.permissions.length).toBeGreaterThan(0);
      for (const permission of role.permissions) {
        expect(isTenantSafePermission(permission)).toBe(true);
      }
    }
  });

  it('accepts every classified permission for tenant roles and rejects every unclassified permission', () => {
    for (const permission of PermissionCatalog) {
      const result = rolePermissionValidationError('tenant', permission);
      if (permission.tenantSafe) {
        expect(result).toBeNull();
      } else {
        expect(result).toBe(`Permission ${permission.key} is not tenant-safe`);
      }
    }
  });

  it('proves tenant-safe permission unions are monotonic and cross-policy unions reject unsafe members', () => {
    const tenantSafe = PermissionCatalog.filter((permission) => permission.tenantSafe);
    const prohibited = PermissionCatalog.filter((permission) => !permission.tenantSafe);
    const union = new Set<string>();

    for (const permission of tenantSafe) {
      const before = new Set(union);
      expect(rolePermissionValidationError('tenant', permission)).toBeNull();
      union.add(permission.key);
      for (const existing of before) {
        expect(union.has(existing), `adding ${permission.key} removed ${existing}`).toBe(true);
      }
    }

    expect(union).toEqual(new Set(TENANT_SAFE_PERMISSION_IDS));
    expect(
      tenantSafe.some((permission) => permission.scope === 'project')
      && tenantSafe.some((permission) => permission.scope === 'engine'),
    ).toBe(true);

    for (const permission of prohibited) {
      const candidate = new Set([...union, permission.key]);
      expect(candidate.size).toBe(union.size + 1);
      expect(rolePermissionValidationError('tenant', permission))
        .toBe(`Permission ${permission.key} is not tenant-safe`);
    }
  });

  it('preserves exact-scope validation for non-tenant roles', () => {
    expect(rolePermissionValidationError('project', {
      key: ProjectPermissions.FILES_VIEW,
      scope: 'project',
    })).toBeNull();
    expect(rolePermissionValidationError('engine', {
      key: ProjectPermissions.FILES_VIEW,
      scope: 'project',
    })).toBe(`Permission ${ProjectPermissions.FILES_VIEW} does not match engine role scope`);
  });

  it('requires a metadata and value chain for every variable editor role', () => {
    expect(rolePermissionDependencyError([])).toBeNull();
    expect(rolePermissionDependencyError([
      EnginePermissions.VARIABLES_METADATA_VIEW,
    ])).toBeNull();
    expect(rolePermissionDependencyError([
      EnginePermissions.VARIABLES_VALUE_VIEW,
    ])).toBe('Permission engine:variables:value:view requires engine:variables:metadata:view');
    expect(rolePermissionDependencyError([
      EnginePermissions.VARIABLES_METADATA_VIEW,
      EnginePermissions.VARIABLES_EDIT,
    ])).toBe('Permission engine:variables:edit requires engine:variables:value:view');
    expect(rolePermissionDependencyError([
      EnginePermissions.VARIABLES_METADATA_VIEW,
      EnginePermissions.VARIABLES_VALUE_VIEW,
      EnginePermissions.VARIABLES_EDIT,
    ])).toBeNull();
  });
});
