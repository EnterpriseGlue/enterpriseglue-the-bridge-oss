import { describe, expect, it, vi } from 'vitest';
import { getMetadataArgsStorage } from 'typeorm';
import { EngineDeployment } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineDeployment.js';
import { EngineDeploymentArtifact } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineDeploymentArtifact.js';
import { ExternalIdentity } from '@enterpriseglue/shared/infrastructure/persistence/entities/ExternalIdentity.js';
import { ProjectEngineTarget } from '@enterpriseglue/shared/infrastructure/persistence/entities/ProjectEngineTarget.js';
import { RbacRole } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRole.js';
import { RbacRoleAssignment } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRoleAssignment.js';
import { AddExternalIdentities1700000000047 } from '@enterpriseglue/shared/db/migrations/1700000000047-add-external-identities.js';
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

  it('enforces one project-engine target independent of source ownership', () => {
    expect(uniqueColumnSets(ProjectEngineTarget)).toContainEqual(['projectId', 'engineId']);
  });

  it('allows discovered deployment and artifact lineage without a project', () => {
    expect(column(EngineDeployment, 'projectId')?.options.nullable).toBe(true);
    expect(column(EngineDeploymentArtifact, 'projectId')?.options.nullable).toBe(true);
  });
});
