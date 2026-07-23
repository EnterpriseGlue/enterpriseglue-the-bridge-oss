export type ConfigRoleTemplateScope = 'platform' | 'tenant' | 'project' | 'engine' | 'engine_runtime_resource';
export type ConfigRoleTemplateOwnershipMode = 'config_locked' | 'config_warn';

export type ConfigRoleTemplateInput = {
  bundleKey: string;
  tenantKey: string;
  roleKey: string;
  roleName: string;
  description?: string;
  scope: ConfigRoleTemplateScope;
  permissionIds: string[];
  ownershipMode: ConfigRoleTemplateOwnershipMode;
};

const stableConfigKey = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;

export function isStableConfigKey(value: string): boolean {
  return value.length >= 3 && value.length <= 160 && stableConfigKey.test(value);
}

export function configRoleKeyFromSystemRoleKey(systemRoleKey: string): string {
  const suffix = systemRoleKey.replace(/^system\./, '').toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '');
  return `custom.${suffix || 'role'}`;
}

export function buildSystemRoleConfigBundle(input: ConfigRoleTemplateInput) {
  if (!isStableConfigKey(input.bundleKey)) throw new Error('Bundle key must be a stable lowercase configuration key.');
  if (!isStableConfigKey(input.tenantKey)) throw new Error('Tenant key must be a stable lowercase configuration key.');
  if (!isStableConfigKey(input.roleKey) || !input.roleKey.startsWith('custom.')) throw new Error('Configuration role key must use the custom.* namespace.');
  if (!input.roleName.trim()) throw new Error('Role name is required.');
  const permissions = [...new Set(input.permissionIds)].sort();
  if (permissions.length === 0) throw new Error('At least one permission is required.');

  return {
    bundle: {
      apiVersion: 'enterpriseglue.ai/v1alpha1',
      kind: 'EnterpriseGlueConfigBundle',
      metadata: { key: input.bundleKey, owner: 'platform' },
      tenantKey: input.tenantKey,
      mode: 'preview_only',
      settings: {},
      imports: ['./roles.json'],
    },
    files: {
      './roles.json': {
        roles: [{
          key: input.roleKey,
          name: input.roleName.trim(),
          ...(input.description?.trim() ? { description: input.description.trim() } : {}),
          scope: input.scope,
          permissions,
          ownershipMode: input.ownershipMode,
        }],
      },
    },
  };
}
