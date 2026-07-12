import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { AuditLog } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuditLog.js';
import { AuthzGroup } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroup.js';
import { RbacRole } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRole.js';
import { RbacRolePermission } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRolePermission.js';
import { configBundleApplyService } from '@enterpriseglue/shared/services/platform-admin/ConfigBundleApplyService.js';
import { configBundlePreviewService } from '@enterpriseglue/shared/services/platform-admin/ConfigBundlePreviewService.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));

const bundle = {
  apiVersion: 'enterpriseglue.ai/v1alpha1',
  kind: 'EnterpriseGlueConfigBundle',
  metadata: { key: 'acme.authz', owner: 'platform' },
  tenantKey: 'acme',
  mode: 'authoritative',
  settings: {},
  imports: ['./roles.json', './groups.json'],
};
const files = {
  './roles.json': {
    roles: [{ key: 'custom.engine.deployer', name: 'Deployer', scope: 'engine', permissions: ['engine:deploy'] }],
  },
  './groups.json': {
    groups: [{ key: 'group.deployers', name: 'Deployers' }],
  },
};

function setupDataSource() {
  const roleInsert = vi.fn().mockResolvedValue(undefined);
  const groupInsert = vi.fn().mockResolvedValue(undefined);
  const permissionInsert = vi.fn().mockResolvedValue(undefined);
  const auditInsert = vi.fn().mockResolvedValue(undefined);
  const roleRepo = { find: vi.fn().mockResolvedValue([]), insert: roleInsert, update: vi.fn() };
  const groupRepo = { find: vi.fn().mockResolvedValue([]), insert: groupInsert, update: vi.fn() };
  const permissionRepo = { find: vi.fn().mockResolvedValue([]), insert: permissionInsert, delete: vi.fn() };
  const auditRepo = { insert: auditInsert };
  const repositories = (entity: unknown) => {
    if (entity === RbacRole) return roleRepo;
    if (entity === AuthzGroup) return groupRepo;
    if (entity === RbacRolePermission) return permissionRepo;
    if (entity === AuditLog) return auditRepo;
    throw new Error('Unexpected repository');
  };
  const dataSource = {
    getRepository: repositories,
    transaction: vi.fn(async (callback: any) => callback({ getRepository: repositories })),
  };
  (getDataSource as unknown as Mock).mockResolvedValue(dataSource);
  return { roleInsert, groupInsert, permissionInsert, auditInsert, dataSource };
}

describe('configBundleApplyService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('applies a hash-bound role and group bundle through one transaction with audit records', async () => {
    const { roleInsert, groupInsert, permissionInsert, auditInsert } = setupDataSource();
    const preview = configBundlePreviewService.preview({ bundle, files });

    const result = await configBundleApplyService.apply({
      bundle,
      files,
      expectedPreviewHash: preview.canonicalHash!,
      tenantId: 'tenant-a',
      actorId: 'admin-1',
    });

    expect(result).toMatchObject({ canonicalHash: preview.canonicalHash, created: 2, updated: 0, archived: 0 });
    expect(roleInsert).toHaveBeenCalledWith(expect.objectContaining({
      key: 'custom.engine.deployer',
      roleKeyIdentity: 'tenant-a:custom.engine.deployer',
      source: 'config',
      sourceRef: 'config_bundle:acme.authz',
    }));
    expect(groupInsert).toHaveBeenCalledWith(expect.objectContaining({ key: 'group.deployers', source: 'config', sourceRef: 'config_bundle:acme.authz' }));
    expect(permissionInsert).toHaveBeenCalledWith([expect.objectContaining({ permissionId: 'engine:deploy' })]);
    expect(auditInsert).toHaveBeenCalledTimes(2);
  });

  it('rejects stale or arbitrary preview hashes before opening a transaction', async () => {
    const { dataSource } = setupDataSource();
    await expect(configBundleApplyService.apply({
      bundle,
      files,
      expectedPreviewHash: 'stale-preview',
      tenantId: 'tenant-a',
      actorId: 'admin-1',
    })).rejects.toMatchObject({ statusCode: 409 });
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });
});
