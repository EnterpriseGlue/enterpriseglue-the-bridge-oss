import { describe, expect, it } from 'vitest';
import {
  ConfigRolesFileSchema,
  EnterpriseGlueConfigBundleSchema,
} from '@enterpriseglue/shared/schemas/platform-admin/config-bundle.js';
import { filterRoleLibraryPermissions } from '@src/features/platform-admin/components/RoleLibrarySettingsTab';
import {
  buildSystemRoleConfigBundle,
  configRoleKeyFromSystemRoleKey,
  isStableConfigKey,
} from '@src/features/platform-admin/components/configRoleTemplate';

const permissions = [
  { key: 'engine:runtime:view', scope: 'engine' as const, category: 'Engine runtime', label: 'View runtime', description: 'Read instances' },
  { key: 'engine:deployment:deploy', scope: 'engine' as const, category: 'Deployments', label: 'Deploy', description: 'Deploy models' },
  { key: 'project:file:write', scope: 'project' as const, category: 'Files', label: 'Write file', description: 'Edit a project file' },
];

describe('RoleLibrarySettingsTab permission filters', () => {
  it('matches permission identifiers, labels, descriptions, and categories', () => {
    expect(filterRoleLibraryPermissions(permissions, [], 'deploy', false)).toEqual([permissions[1]]);
    expect(filterRoleLibraryPermissions(permissions, [], 'instances', false)).toEqual([permissions[0]]);
    expect(filterRoleLibraryPermissions(permissions, [], 'files', false)).toEqual([permissions[2]]);
  });

  it('limits results to permissions selected for the role when requested', () => {
    expect(filterRoleLibraryPermissions(permissions, ['engine:deployment:deploy'], '', true)).toEqual([permissions[1]]);
    expect(filterRoleLibraryPermissions(permissions, ['engine:deployment:deploy'], 'runtime', true)).toEqual([]);
  });

  it('limits results to permissions classified as sensitive by the shared risk helper', () => {
    const withSensitivePermission = [
      ...permissions,
      { key: 'engine:members:manage', scope: 'engine' as const, category: 'Access', label: 'Manage members', description: 'Change engine membership' },
    ];

    expect(filterRoleLibraryPermissions(withSensitivePermission, [], '', false, true)).toEqual([withSensitivePermission[3]]);
  });

  it('limits results to an explicit permission category', () => {
    expect(filterRoleLibraryPermissions(permissions, [], '', false, false, 'Deployments')).toEqual([permissions[1]]);
  });
});

describe('system role configuration export', () => {
  it('derives a custom role key from a system role key', () => {
    expect(configRoleKeyFromSystemRoleKey('system.engine.operator')).toBe('custom.engine.operator');
    expect(isStableConfigKey('custom.engine.operator')).toBe(true);
    expect(isStableConfigKey('Custom Engine Operator')).toBe(false);
  });

  it('builds an importable explicit-permission configuration bundle', () => {
    const exported = buildSystemRoleConfigBundle({
      bundleKey: 'acme.authz',
      tenantKey: 'acme',
      roleKey: 'custom.engine.operator',
      roleName: 'Production engine operator',
      description: 'Managed in Git',
      scope: 'engine',
      permissionIds: ['engine:view', 'engine:deploy', 'engine:view'],
      ownershipMode: 'config_locked',
    });

    expect(exported).toEqual({
      bundle: {
        apiVersion: 'enterpriseglue.ai/v1alpha1',
        kind: 'EnterpriseGlueConfigBundle',
        metadata: { key: 'acme.authz', owner: 'platform' },
        tenantKey: 'acme',
        mode: 'preview_only',
        imports: ['./roles.json'],
      },
      files: {
        './roles.json': {
          roles: [{
            key: 'custom.engine.operator',
            name: 'Production engine operator',
            description: 'Managed in Git',
            scope: 'engine',
            permissions: ['engine:deploy', 'engine:view'],
            ownershipMode: 'config_locked',
          }],
        },
      },
    });
    expect(EnterpriseGlueConfigBundleSchema.safeParse(exported.bundle).success).toBe(true);
    expect(ConfigRolesFileSchema.safeParse(exported.files['./roles.json']).success).toBe(true);
  });

  it('rejects invalid bundle and role keys', () => {
    expect(() => buildSystemRoleConfigBundle({
      bundleKey: 'Acme Authz',
      tenantKey: 'acme',
      roleKey: 'system.engine.operator',
      roleName: 'Operator',
      scope: 'engine',
      permissionIds: ['engine:view'],
      ownershipMode: 'config_warn',
    })).toThrow('Bundle key');
  });
});
