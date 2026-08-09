export const TENANT_SAFE_PROJECT_PERMISSION_IDS = [
  'project:delete',
  'project:settings:manage',
  'project:members:manage',
  'project:members:view',
  'project:members:search',
  'project:members:invite',
  'project:members:add',
  'project:members:update-role',
  'project:members:remove',
  'project:members:manage-deploy-grant',
  'project:delegate:manage',
  'project:ownership:transfer',
  'project:files:create',
  'project:files:edit',
  'project:files:delete',
  'project:files:view',
  'project:versions:create',
  'project:versions:restore',
  'project:git:push',
  'project:git:pull',
  'project:git:connect',
  'project:deploy',
  'project:deployment-targets:view',
  'project:deployment-targets:manage',
] as const;

export const TENANT_SAFE_ENGINE_PERMISSION_IDS = [
  'engine:deploy',
  'engine:deploy:view',
  'engine:process:start',
  'engine:process:cancel',
  'engine:process:modify',
  'engine:instance:view',
  'engine:instance:delete',
  'engine:instance:retry',
  'engine:variables:metadata:view',
  'engine:variables:value:view',
  'engine:variables:edit',
] as const;

export const TENANT_SAFE_PERMISSION_IDS = new Set<string>([
  ...TENANT_SAFE_PROJECT_PERMISSION_IDS,
  ...TENANT_SAFE_ENGINE_PERMISSION_IDS,
]);

export const TENANT_MACHINE_SAFE_PERMISSION_IDS = new Set<string>([
  'project:deploy',
  ...TENANT_SAFE_ENGINE_PERMISSION_IDS,
]);

export function isTenantSafePermission(permissionId: string): boolean {
  return TENANT_SAFE_PERMISSION_IDS.has(permissionId);
}

export function rolePermissionValidationError(
  roleScope: string,
  permission: { key: string; scope: string },
): string | null {
  if (roleScope === 'tenant') {
    return isTenantSafePermission(permission.key)
      ? null
      : `Permission ${permission.key} is not tenant-safe`;
  }
  return permission.scope === roleScope
    ? null
    : `Permission ${permission.key} does not match ${roleScope} role scope`;
}

/**
 * Variable mutation is intentionally not a blind-write capability. A role
 * that can alter values must also be able to inspect the values it is about to
 * replace, and a value reader must at least be allowed to see variable
 * metadata. Keeping this rule next to the scope policy makes manual, API, and
 * configuration-managed roles converge on the same least-privilege contract.
 */
export function rolePermissionDependencyError(permissionIds: readonly string[]): string | null {
  const permissions = new Set(permissionIds);
  if (permissions.has('engine:variables:edit') && !permissions.has('engine:variables:value:view')) {
    return 'Permission engine:variables:edit requires engine:variables:value:view';
  }
  if (permissions.has('engine:variables:value:view') && !permissions.has('engine:variables:metadata:view')) {
    return 'Permission engine:variables:value:view requires engine:variables:metadata:view';
  }
  return null;
}
