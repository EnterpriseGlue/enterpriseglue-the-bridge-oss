import { TableColumn, TableIndex } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

function tablePath(queryRunner: QueryRunner, metadataName: string, fallback: string): string {
  try {
    return queryRunner.connection.getMetadata(metadataName).tablePath;
  } catch {
    return fallback;
  }
}

async function addTenantColumnIfMissing(
  queryRunner: QueryRunner,
  tableName: string,
  indexName: string,
  indexColumns: string[] = ['tenant_id']
): Promise<void> {
  if (!(await queryRunner.hasTable(tableName))) {
    return;
  }
  if (!(await queryRunner.hasColumn(tableName, 'tenant_id'))) {
    await queryRunner.addColumn(tableName, new TableColumn({
      name: 'tenant_id',
      type: 'text',
      isNullable: true,
    }));
  }
  const table = await queryRunner.getTable(tableName);
  if (table && !table.indices.some((index) => index.name === indexName)) {
    await queryRunner.createIndex(tableName, new TableIndex({
      name: indexName,
      columnNames: indexColumns,
    }));
  }
}

async function dropTenantColumnIfPresent(
  queryRunner: QueryRunner,
  tableName: string,
  indexName: string
): Promise<void> {
  if (!(await queryRunner.hasTable(tableName))) {
    return;
  }
  const table = await queryRunner.getTable(tableName);
  const index = table?.indices.find((candidate) => candidate.name === indexName);
  if (index) {
    await queryRunner.dropIndex(tableName, index);
  }
  if (await queryRunner.hasColumn(tableName, 'tenant_id')) {
    await queryRunner.dropColumn(tableName, 'tenant_id');
  }
}

export class AddAuthzTenantScope1700000000021 implements MigrationInterface {
  name = 'AddAuthzTenantScope1700000000021';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await addTenantColumnIfMissing(
      queryRunner,
      tablePath(queryRunner, 'RbacRole', 'roles'),
      'idx_roles_tenant'
    );
    await addTenantColumnIfMissing(
      queryRunner,
      tablePath(queryRunner, 'RbacRoleAssignment', 'role_assignments'),
      'idx_role_assignments_tenant'
    );
    await addTenantColumnIfMissing(
      queryRunner,
      tablePath(queryRunner, 'SsoAssignmentMapping', 'sso_assignment_mappings'),
      'idx_sso_assignment_tenant'
    );
    await addTenantColumnIfMissing(
      queryRunner,
      tablePath(queryRunner, 'PermissionGrant', 'permission_grants'),
      'idx_permission_grants_tenant'
    );
    await addTenantColumnIfMissing(
      queryRunner,
      tablePath(queryRunner, 'AuthzPolicy', 'authz_policies'),
      'idx_authz_policies_tenant'
    );
    await addTenantColumnIfMissing(
      queryRunner,
      tablePath(queryRunner, 'AuthzAuditLog', 'authz_audit_log'),
      'idx_authz_audit_log_tenant',
      ['tenant_id', 'timestamp']
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await dropTenantColumnIfPresent(
      queryRunner,
      tablePath(queryRunner, 'AuthzAuditLog', 'authz_audit_log'),
      'idx_authz_audit_log_tenant'
    );
    await dropTenantColumnIfPresent(
      queryRunner,
      tablePath(queryRunner, 'AuthzPolicy', 'authz_policies'),
      'idx_authz_policies_tenant'
    );
    await dropTenantColumnIfPresent(
      queryRunner,
      tablePath(queryRunner, 'PermissionGrant', 'permission_grants'),
      'idx_permission_grants_tenant'
    );
    await dropTenantColumnIfPresent(
      queryRunner,
      tablePath(queryRunner, 'SsoAssignmentMapping', 'sso_assignment_mappings'),
      'idx_sso_assignment_tenant'
    );
    await dropTenantColumnIfPresent(
      queryRunner,
      tablePath(queryRunner, 'RbacRoleAssignment', 'role_assignments'),
      'idx_role_assignments_tenant'
    );
    await dropTenantColumnIfPresent(
      queryRunner,
      tablePath(queryRunner, 'RbacRole', 'roles'),
      'idx_roles_tenant'
    );
  }
}
