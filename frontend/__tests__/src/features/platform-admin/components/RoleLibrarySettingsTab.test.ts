import { describe, expect, it } from 'vitest';
import { filterRoleLibraryPermissions } from '@src/features/platform-admin/components/RoleLibrarySettingsTab';

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
});
