import { describe, expect, it, vi } from 'vitest';
import { getMetadataArgsStorage } from 'typeorm';
import { EngineDeployment } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineDeployment.js';
import { EngineDeploymentArtifact } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineDeploymentArtifact.js';
import { DeploymentReceipt } from '@enterpriseglue/shared/infrastructure/persistence/entities/DeploymentReceipt.js';
import { ExternalIdentity } from '@enterpriseglue/shared/infrastructure/persistence/entities/ExternalIdentity.js';
import { IdentityProvider } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvider.js';
import { ProjectEngineTarget } from '@enterpriseglue/shared/infrastructure/persistence/entities/ProjectEngineTarget.js';
import { RbacRole } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRole.js';
import { RbacRoleAssignment } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRoleAssignment.js';
import { RuntimeResource } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResource.js';
import { RuntimeResourceSet } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResourceSet.js';
import { RuntimeResourceSetMaterialization } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResourceSetMaterialization.js';
import { AddExternalIdentities1700000000047 } from '@enterpriseglue/shared/db/migrations/1700000000047-add-external-identities.js';
import { AddIdentityProviders1700000000056 } from '@enterpriseglue/shared/db/migrations/1700000000056-add-identity-providers.js';
import { AddRuntimeResourceSets1700000000054 } from '@enterpriseglue/shared/db/migrations/1700000000054-add-runtime-resource-sets.js';
import { AddRuntimeResourceInventory1700000000055 } from '@enterpriseglue/shared/db/migrations/1700000000055-add-runtime-resource-inventory.js';
import { AddDeploymentHistoryLineage1700000000058 } from '@enterpriseglue/shared/db/migrations/1700000000058-add-deployment-history-lineage.js';
import { RequireCanonicalRoleAssignmentShape1700000000084 } from '@enterpriseglue/shared/db/migrations/1700000000084-require-canonical-role-assignment-shape.js';
import { AddRoleAssignmentSourceRefIndex1700000000085 } from '@enterpriseglue/shared/db/migrations/1700000000085-add-role-assignment-source-ref-index.js';
import { externalIdentityKey } from '@enterpriseglue/shared/services/platform-admin/ExternalIdentityService.js';

function column(target: Function, propertyName: string) {
  return getMetadataArgsStorage().columns.find(
    (candidate) => candidate.target === target && candidate.propertyName === propertyName,
  );
}

function uniqueColumnSets(target: Function): string[][] {
  const metadata = getMetadataArgsStorage();
  const constraints = metadata.uniques
    .filter((candidate) => candidate.target === target)
    .flatMap((candidate) => Array.isArray(candidate.columns) ? [candidate.columns] : []);
  const indexes = metadata.indices
    .filter((candidate) => candidate.target === target && candidate.unique)
    .flatMap((candidate) => Array.isArray(candidate.columns) ? [candidate.columns] : []);
  return [...constraints, ...indexes]
    .map((columns) => columns.filter((entry): entry is string => typeof entry === 'string'))
    .sort((left, right) => left.join(',').localeCompare(right.join(',')));
}

describe('canonical authorization persistence schema invariants', () => {
  it('enforces one canonical assignment per principal, role, scope, and source identity', () => {
    expect(uniqueColumnSets(RbacRoleAssignment)).toContainEqual(['assignmentKey']);
    expect(column(RbacRoleAssignment, 'assignmentKey')?.options.nullable).not.toBe(true);
    expect(column(RbacRoleAssignment, 'principalType')?.options.nullable).not.toBe(true);
    expect(column(RbacRoleAssignment, 'principalId')?.options.nullable).not.toBe(true);
    expect(column(RbacRoleAssignment, 'scopeType')?.options.nullable).not.toBe(true);
  });

  it('requires canonical assignment shape only after a fail-closed backfill', () => {
    expect(new RequireCanonicalRoleAssignmentShape1700000000084().name).toBe('RequireCanonicalRoleAssignmentShape1700000000084');
    expect(new AddRoleAssignmentSourceRefIndex1700000000085().name).toBe('AddRoleAssignmentSourceRefIndex1700000000085');
  });

  it('scopes custom role key uniqueness by canonical tenant identity', () => {
    const uniqueSets = uniqueColumnSets(RbacRole);
    expect(uniqueSets).toContainEqual(['roleKeyIdentity']);
    expect(uniqueSets).not.toContainEqual(['key']);
    expect(column(RbacRole, 'roleKeyIdentity')?.options.nullable).not.toBe(true);
    expect(column(RbacRole, 'tenantId')?.options.nullable).toBe(true);
  });

  it('enforces one immutable external subject link per tenant and provider', () => {
    expect(uniqueColumnSets(ExternalIdentity)).toContainEqual(['identityKey']);
    expect(column(ExternalIdentity, 'identityKey')?.options.nullable).not.toBe(true);

    const base = { tenantId: 'tenant-a', providerId: 'provider-a', subjectId: 'subject-a' };
    const key = externalIdentityKey(base);
    expect(externalIdentityKey({ ...base, tenantId: 'tenant-b' })).not.toBe(key);
    expect(externalIdentityKey({ ...base, providerId: 'provider-b' })).not.toBe(key);
    expect(externalIdentityKey({ ...base, subjectId: 'subject-b' })).not.toBe(key);
    expect(externalIdentityKey({ tenantId: 'tenant-a|provider-a', providerId: 'subject-a', subjectId: '' }))
      .not.toBe(externalIdentityKey({ tenantId: 'tenant-a', providerId: 'provider-a|subject-a', subjectId: '' }));
  });

  it('migrates external identity links with their portable canonical key and lookup indexes', async () => {
    const createTable = vi.fn().mockResolvedValue(undefined);
    const migration = new AddExternalIdentities1700000000047();

    await migration.up({
      hasTable: vi.fn().mockResolvedValue(false),
      createTable,
      connection: { getMetadata: () => { throw new Error('metadata unavailable'); } },
    } as any);

    const table = createTable.mock.calls[0][0];
    expect(table.name).toBe('external_identities');
    expect(table.uniques).toEqual(expect.arrayContaining([
      expect.objectContaining({ columnNames: ['identity_key'] }),
    ]));
    expect(table.columns.map((candidate: { name: string }) => candidate.name)).toEqual(expect.arrayContaining([
      'tenant_id', 'provider_id', 'subject_id', 'directory_tenant_id', 'user_id', 'identity_key',
    ]));
    expect(table.indices).toEqual(expect.arrayContaining([
      expect.objectContaining({ columnNames: ['tenant_id', 'provider_id', 'subject_id'] }),
      expect.objectContaining({ columnNames: ['user_id'] }),
    ]));
  });

  it('keeps EnterpriseGlue tenancy distinct from external directory tenancy in identity persistence', async () => {
    expect(column(IdentityProvider, 'tenantId')?.options.name).toBe('tenant_id');
    expect(column(IdentityProvider, 'directoryTenantId')?.options.name).toBe('directory_tenant_id');
    expect(column(ExternalIdentity, 'tenantId')?.options.name).toBe('tenant_id');
    expect(column(ExternalIdentity, 'directoryTenantId')?.options.name).toBe('directory_tenant_id');

    const createTable = vi.fn().mockResolvedValue(undefined);
    await new AddIdentityProviders1700000000056().up({
      hasTable: vi.fn().mockResolvedValue(false),
      createTable,
    } as any);

    expect(createTable.mock.calls[0][0].columns.map((candidate: { name: string }) => candidate.name))
      .toEqual(expect.arrayContaining(['tenant_id', 'directory_tenant_id']));
  });

  it('enforces one project-engine target independent of source ownership', () => {
    expect(uniqueColumnSets(ProjectEngineTarget)).toContainEqual(['projectId', 'engineId']);
  });

  it('persists direct discovery and receipt lineage without requiring a project', async () => {
    expect(column(EngineDeployment, 'projectId')?.options.nullable).toBe(true);
    expect(column(EngineDeploymentArtifact, 'projectId')?.options.nullable).toBe(true);
    expect(column(EngineDeployment, 'ingestionSource')?.options.default).toBe('enterpriseglue_proxy');
    expect(column(EngineDeployment, 'lineageQuality')?.options.default).toBe('complete');
    expect(uniqueColumnSets(DeploymentReceipt)).toContainEqual(['tenantId', 'idempotencyKey']);

    const addColumn = vi.fn().mockResolvedValue(undefined);
    const changeColumn = vi.fn().mockResolvedValue(undefined);
    const createIndex = vi.fn().mockResolvedValue(undefined);
    const query = vi.fn()
      .mockResolvedValueOnce([
        { id: 'newest', engine_id: 'engine-a', camunda_deployment_id: 'deployment-a' },
        { id: 'stale', engine_id: 'engine-a', camunda_deployment_id: 'deployment-a' },
      ])
      .mockResolvedValue(undefined);
    const table = {
      indices: [],
      findColumnByName: vi.fn().mockReturnValue({ type: 'text', isNullable: false }),
    };
    await new AddDeploymentHistoryLineage1700000000058().up({
      hasTable: vi.fn().mockResolvedValue(true),
      hasColumn: vi.fn().mockResolvedValue(false),
      addColumn,
      getTable: vi.fn().mockResolvedValue(table),
      changeColumn,
      createIndex,
      query,
      connection: {
        getMetadata: () => { throw new Error('metadata unavailable'); },
        driver: { createParameter: vi.fn().mockReturnValue('$1') },
      },
    } as any);

    expect(addColumn.mock.calls.map(([tableName, definition]) => [tableName, definition.name])).toEqual([
      ['engine_deployments', 'ingestion_source'],
      ['engine_deployments', 'lineage_quality'],
      ['engine_deployments', 'reporting_principal_id'],
      ['engine_deployments', 'reconciled_at'],
      ['engine_deployments', 'lineage_json'],
    ]);
    expect(changeColumn).toHaveBeenCalledWith('engine_deployments', 'project_id', expect.objectContaining({ isNullable: true }));
    expect(changeColumn).toHaveBeenCalledWith('engine_deployment_artifacts', 'project_id', expect.objectContaining({ isNullable: true }));
    expect(createIndex).toHaveBeenCalledWith('engine_deployments', expect.objectContaining({
      columnNames: ['engine_id', 'camunda_deployment_id'], isUnique: true,
    }));
    expect(query).toHaveBeenCalledWith('DELETE FROM engine_deployments WHERE id = $1', ['stale']);
  });

  it('persists canonical runtime resources, sets, and materialization lineage', async () => {
    expect(uniqueColumnSets(RuntimeResource)).toContainEqual(['engineId', 'resourceKind', 'resourceKey', 'runtimeTenantId']);
    expect(uniqueColumnSets(RuntimeResourceSet)).toContainEqual(['tenantId', 'key']);
    expect(uniqueColumnSets(RuntimeResourceSetMaterialization)).toContainEqual(['runtimeResourceSetId', 'runtimeResourceId']);
    expect(column(RuntimeResource, 'runtimeTenantId')?.options.default).toBe('');
    expect(column(RuntimeResourceSetMaterialization, 'lineageJson')?.options.nullable).not.toBe(true);

    const createTable = vi.fn().mockResolvedValue(undefined);
    const queryRunner = { hasTable: vi.fn().mockResolvedValue(false), createTable };
    await new AddRuntimeResourceSets1700000000054().up(queryRunner as any);
    await new AddRuntimeResourceInventory1700000000055().up(queryRunner as any);

    const tables = createTable.mock.calls.map(([table]) => table);
    expect(tables.map((table) => table.name)).toEqual([
      'runtime_resource_sets', 'runtime_resources', 'runtime_resource_set_materializations',
    ]);
    expect(tables[1].uniques).toEqual(expect.arrayContaining([
      expect.objectContaining({ columnNames: ['engine_id', 'resource_kind', 'resource_key', 'runtime_tenant_id'] }),
    ]));
    expect(tables[2].uniques).toEqual(expect.arrayContaining([
      expect.objectContaining({ columnNames: ['runtime_resource_set_id', 'runtime_resource_id'] }),
    ]));
  });
});
