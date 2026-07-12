import { In, IsNull } from 'typeorm';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { AuthzGroup } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroup.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { RbacRole } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRole.js';
import { RbacRolePermission } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRolePermission.js';

function json(value: string | null | undefined): Record<string, unknown> {
  try { const parsed = value ? JSON.parse(value) : {}; return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; }
}

function externalReference(value: string | null | undefined): string | null {
  return value?.startsWith('ref:') ? value.slice(4) : null;
}

class ConfigBundleExportService {
  async exportBundle(input: { bundleKey: string; tenantId?: string | null; tenantKey?: string }): Promise<{ bundle: Record<string, unknown>; files: Record<string, unknown> }> {
    const dataSource = await getDataSource();
    const tenantId = input.tenantId || null;
    const sourceRef = `config_bundle:${input.bundleKey}`;
    const where = { sourceRef, ...(tenantId ? { tenantId } : { tenantId: IsNull() }) };
    const [roles, groups, engines] = await Promise.all([
      dataSource.getRepository(RbacRole).find({ where: { ...where, isArchived: false } }),
      dataSource.getRepository(AuthzGroup).find({ where: { ...where, isArchived: false } }),
      dataSource.getRepository(Engine).find({ where: { ...where, lifecycleStatus: 'active' } }),
    ]);
    const permissions = roles.length
      ? await dataSource.getRepository(RbacRolePermission).find({ where: { roleId: In(roles.map((role) => role.id)) } })
      : [];
    const permissionIdsByRole = new Map<string, string[]>();
    for (const permission of permissions) permissionIdsByRole.set(permission.roleId, [...(permissionIdsByRole.get(permission.roleId) || []), permission.permissionId]);

    const files: Record<string, unknown> = {};
    if (roles.length) files['./roles.json'] = { roles: roles.map((role) => ({ key: role.key, name: role.name, description: role.description || undefined, scope: role.scope, permissions: permissionIdsByRole.get(role.id) || [], ownershipMode: 'config_locked' })) };
    if (groups.length) files['./groups.json'] = { groups: groups.map((group) => ({ key: group.key, name: group.name, description: group.description || undefined, ownershipMode: 'config_locked' })) };
    if (engines.length) files['./engines.json'] = { engines: engines.map((engine) => {
      const auth = engine.authType === 'basic'
        ? { type: 'basic', username: engine.username || '', passwordRef: externalReference(engine.passwordEnc) || undefined }
        : engine.authType === 'bearer'
          ? { type: 'bearer', tokenRef: externalReference(engine.passwordEnc) || undefined }
          : engine.authType === 'oauth2-client-credentials'
            ? { type: 'oauth2-client-credentials', username: engine.username || '', passwordRef: externalReference(engine.passwordEnc) || undefined, tokenUrl: engine.oauthTokenUrl || '', scopes: engine.oauthScopes ? engine.oauthScopes.split(/\s+/).filter(Boolean) : undefined, audience: engine.oauthAudience || undefined }
            : { type: 'none' };
      return { key: engine.configKey, name: engine.name, baseUrl: engine.baseUrl, type: engine.type, externalId: engine.externalId || undefined, labels: json(engine.labelsJson), auth, version: engine.version || undefined, runtimeAccessScope: engine.runtimeAccessScope, deploymentIntegration: engine.deploymentIntegration, connectionMode: engine.connectionMode, ownershipMode: engine.ownershipMode };
    }) };
    const imports = Object.keys(files);
    return {
      bundle: { apiVersion: 'enterpriseglue.ai/v1alpha1', kind: 'EnterpriseGlueConfigBundle', metadata: { key: input.bundleKey, owner: 'platform' }, tenantKey: input.tenantKey || 'default', mode: 'authoritative', settings: {}, imports },
      files,
    };
  }
}

export const configBundleExportService = new ConfigBundleExportService();
