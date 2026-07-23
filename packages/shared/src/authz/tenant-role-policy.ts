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
