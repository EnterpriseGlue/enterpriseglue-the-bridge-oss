import type { MigrationInterface, QueryRunner } from 'typeorm';

const CANONICAL_TENANT_ID = 'tenant-default';
const LEGACY_TENANT_ID = 'default-tenant-id';

const TENANT_ID_TABLES: Array<{ metadataName?: string; fallback: string }> = [
  { metadataName: 'Project', fallback: 'projects' },
  { metadataName: 'Engine', fallback: 'engines' },
  { metadataName: 'GitProvider', fallback: 'git_providers' },
  { metadataName: 'Invitation', fallback: 'invitations' },
  { metadataName: 'Notification', fallback: 'notifications' },
  { metadataName: 'AuditLog', fallback: 'audit_logs' },
  { metadataName: 'RbacRole', fallback: 'roles' },
  { metadataName: 'RbacRoleAssignment', fallback: 'role_assignments' },
  { metadataName: 'PermissionGrant', fallback: 'permission_grants' },
  { metadataName: 'AuthzPolicy', fallback: 'authz_policies' },
  { metadataName: 'AuthzAuditLog', fallback: 'authz_audit_log' },
  { metadataName: 'AuthzGroup', fallback: 'authz_groups' },
  { metadataName: 'AuthzGroupMembership', fallback: 'authz_group_memberships' },
  { metadataName: 'SsoProvider', fallback: 'sso_providers' },
  { metadataName: 'SsoAssignmentMapping', fallback: 'sso_assignment_mappings' },
  { metadataName: 'SsoGroupMapping', fallback: 'sso_group_mappings' },
  { metadataName: 'SsoSyncRun', fallback: 'sso_sync_runs' },
  { metadataName: 'SsoSyncEvent', fallback: 'sso_sync_events' },
  { metadataName: 'SsoNormalizedIdentity', fallback: 'sso_normalized_identities' },
  { metadataName: 'SsoEngineAccessSnapshot', fallback: 'sso_engine_access_snapshots' },
  { metadataName: 'EngineSet', fallback: 'engine_sets' },
  { metadataName: 'EngineSetMaterialization', fallback: 'engine_set_materializations' },
  { metadataName: 'ProjectEngineTarget', fallback: 'project_engine_targets' },
  { metadataName: 'ExternalEngineSystem', fallback: 'external_engine_systems' },
  { metadataName: 'EngineDeploymentArtifact', fallback: 'engine_deployment_artifacts' },
  { fallback: 'tenant_settings' },
  { fallback: 'tenant_memberships' },
  { fallback: 'tenant_email_templates' },
];

function defaultSchema(queryRunner: QueryRunner): string | null {
  const schema = (queryRunner.connection.options as { schema?: string }).schema?.trim();
  return schema || null;
}

function tablePath(queryRunner: QueryRunner, metadataName: string | undefined, fallback: string): string {
  if (metadataName) {
    try {
      return queryRunner.connection.getMetadata(metadataName).tablePath;
    } catch {
      // Fall through to fallback table path.
    }
  }
  const schema = defaultSchema(queryRunner);
  return schema && !fallback.includes('.') ? `${schema}.${fallback}` : fallback;
}

function escapeIdentifier(queryRunner: QueryRunner, identifier: string): string {
  return queryRunner.connection.driver.escape(identifier);
}

function escapeTablePath(queryRunner: QueryRunner, table: string): string {
  return table.split('.').map((part) => escapeIdentifier(queryRunner, part)).join('.');
}

async function updateTenantIdColumn(queryRunner: QueryRunner, table: string): Promise<void> {
  if (!(await queryRunner.hasTable(table)) || !(await queryRunner.hasColumn(table, 'tenant_id'))) {
    return;
  }

  await queryRunner.query(
    `UPDATE ${escapeTablePath(queryRunner, table)}
     SET ${escapeIdentifier(queryRunner, 'tenant_id')} = '${CANONICAL_TENANT_ID}'
     WHERE ${escapeIdentifier(queryRunner, 'tenant_id')} = '${LEGACY_TENANT_ID}'`
  );
}

export class NormalizeOssDefaultTenantId1700000000043 implements MigrationInterface {
  name = 'NormalizeOssDefaultTenantId1700000000043';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const tenantsTable = tablePath(queryRunner, undefined, 'tenants');
    if (await queryRunner.hasTable(tenantsTable)) {
      const escapedTenants = escapeTablePath(queryRunner, tenantsTable);
      const idColumn = escapeIdentifier(queryRunner, 'id');
      await queryRunner.query(
        `UPDATE ${escapedTenants}
         SET ${idColumn} = '${CANONICAL_TENANT_ID}'
         WHERE ${idColumn} = '${LEGACY_TENANT_ID}'
           AND NOT EXISTS (
             SELECT 1 FROM ${escapedTenants} WHERE ${idColumn} = '${CANONICAL_TENANT_ID}'
           )`
      );
    }

    for (const table of TENANT_ID_TABLES) {
      await updateTenantIdColumn(queryRunner, tablePath(queryRunner, table.metadataName, table.fallback));
    }

    if (await queryRunner.hasTable(tenantsTable)) {
      const escapedTenants = escapeTablePath(queryRunner, tenantsTable);
      const idColumn = escapeIdentifier(queryRunner, 'id');
      await queryRunner.query(
        `DELETE FROM ${escapedTenants}
         WHERE ${idColumn} = '${LEGACY_TENANT_ID}'
           AND EXISTS (
             SELECT 1 FROM ${escapedTenants} WHERE ${idColumn} = '${CANONICAL_TENANT_ID}'
           )`
      );
    }
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Data canonicalization is intentionally not reversed.
  }
}
