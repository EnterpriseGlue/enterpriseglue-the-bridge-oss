import { Table, TableIndex, TableUnique } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';
import {
  portableBigint,
  portableBoolean,
  portableBooleanDefault,
  portableInteger,
  portableNumberDefault,
  portableStringDefault,
  portableText,
} from './support/portable-columns.js';

function tablePath(queryRunner: QueryRunner, metadataName: string, fallback: string): string {
  try { return queryRunner.connection.getMetadata(metadataName).tablePath; } catch { return fallback; }
}

async function createIfMissing(queryRunner: QueryRunner, table: Table): Promise<void> {
  if (!await queryRunner.hasTable(table.name)) await queryRunner.createTable(table, true);
}

/**
 * Adds the cross-database persistence boundary for authoritative SCIM
 * directories. All natural-key uniqueness uses non-null portable identities
 * so Oracle empty-string and nullable-unique semantics cannot weaken it.
 */
export class AddIdentityProvisioningFoundation1700000000111 implements MigrationInterface {
  name = 'AddIdentityProvisioningFoundation1700000000111';

  async up(queryRunner: QueryRunner): Promise<void> {
    const key = portableText(queryRunner, 'key');
    const document = portableText(queryRunner, 'document');
    const timestamp = portableBigint(queryRunner);
    const integer = portableInteger(queryRunner);
    const boolean = portableBoolean(queryRunner);
    const stringDefault = (value: string) => portableStringDefault(queryRunner, value);
    const booleanDefault = (value: boolean) => portableBooleanDefault(queryRunner, value);
    const numberDefault = (value: number) => portableNumberDefault(queryRunner, value);

    const directories = tablePath(queryRunner, 'IdentityProvisioningDirectory', 'identity_provisioning_directories');
    const credentials = tablePath(queryRunner, 'IdentityProvisioningCredential', 'identity_provisioning_credentials');
    const users = tablePath(queryRunner, 'ScimUserLink', 'scim_user_links');
    const groups = tablePath(queryRunner, 'ScimGroupLink', 'scim_group_links');
    const memberships = tablePath(queryRunner, 'ScimGroupMembership', 'scim_group_memberships');
    const diagnostics = tablePath(queryRunner, 'IdentityProvisioningDiagnostic', 'identity_provisioning_diagnostics');

    await createIfMissing(queryRunner, new Table({
      name: directories,
      columns: [
        { name: 'id', ...key, isPrimary: true },
        { name: 'tenant_id', ...key, isNullable: true },
        { name: 'key', ...key },
        { name: 'directory_key_identity', ...key },
        { name: 'active_authoritative_identity', ...key },
        { name: 'display_name', ...document },
        { name: 'description', ...document, isNullable: true },
        { name: 'type', ...key, default: stringDefault('scim_v2') },
        { name: 'identity_provider_key', ...key, isNullable: true },
        { name: 'authoritative', ...boolean, default: booleanDefault(true) },
        { name: 'status', ...key, default: stringDefault('disabled') },
        { name: 'ownership_mode', ...key, default: stringDefault('manual') },
        { name: 'source_ref', ...document, isNullable: true },
        { name: 'source_hash', ...key, isNullable: true },
        { name: 'credential_secret_ref', ...document, isNullable: true },
        { name: 'last_applied_at', ...timestamp, isNullable: true },
        { name: 'drift_status', ...key, isNullable: true },
        { name: 'created_at', ...timestamp },
        { name: 'updated_at', ...timestamp },
        { name: 'archived_at', ...timestamp, isNullable: true },
      ],
      uniques: [
        new TableUnique({ name: 'uq_identity_provisioning_directories_key_identity', columnNames: ['directory_key_identity'] }),
        new TableUnique({ name: 'uq_identity_provisioning_directories_active_authority', columnNames: ['active_authoritative_identity'] }),
      ],
      indices: [
        new TableIndex({ name: 'idx_identity_provisioning_directories_tenant_status', columnNames: ['tenant_id', 'status'] }),
        new TableIndex({ name: 'idx_identity_provisioning_directories_provider', columnNames: ['identity_provider_key'] }),
      ],
    }));

    await createIfMissing(queryRunner, new Table({
      name: credentials,
      columns: [
        { name: 'id', ...key, isPrimary: true },
        { name: 'directory_id', ...key },
        { name: 'name', ...document },
        { name: 'token_hash', ...key },
        { name: 'fingerprint', ...key },
        { name: 'status', ...key, default: stringDefault('active') },
        { name: 'created_at', ...timestamp },
        { name: 'expires_at', ...timestamp, isNullable: true },
        { name: 'overlap_ends_at', ...timestamp, isNullable: true },
        { name: 'last_used_at', ...timestamp, isNullable: true },
        { name: 'revoked_at', ...timestamp, isNullable: true },
        { name: 'created_by_user_id', ...key, isNullable: true },
      ],
      uniques: [new TableUnique({ name: 'uq_identity_provisioning_credentials_hash', columnNames: ['token_hash'] })],
      indices: [
        new TableIndex({ name: 'idx_identity_provisioning_credentials_directory_status', columnNames: ['directory_id', 'status'] }),
        new TableIndex({ name: 'idx_identity_provisioning_credentials_expiry', columnNames: ['expires_at'] }),
      ],
    }));

    await createIfMissing(queryRunner, new Table({
      name: users,
      columns: [
        { name: 'id', ...key, isPrimary: true },
        { name: 'tenant_id', ...key, isNullable: true },
        { name: 'directory_id', ...key },
        { name: 'user_id', ...key },
        { name: 'directory_user_identity', ...key },
        { name: 'directory_username_identity', ...key },
        { name: 'external_id', ...document, isNullable: true },
        { name: 'external_id_identity', ...key },
        { name: 'user_name', ...document },
        { name: 'profile_json', ...document, default: stringDefault('{}') },
        { name: 'active', ...boolean, default: booleanDefault(true) },
        { name: 'status', ...key, default: stringDefault('active') },
        { name: 'version', ...integer, default: numberDefault(1) },
        { name: 'last_provisioned_at', ...timestamp },
        { name: 'created_at', ...timestamp },
        { name: 'updated_at', ...timestamp },
        { name: 'deactivated_at', ...timestamp, isNullable: true },
      ],
      uniques: [
        new TableUnique({ name: 'uq_scim_user_links_directory_user', columnNames: ['directory_user_identity'] }),
        new TableUnique({ name: 'uq_scim_user_links_directory_username', columnNames: ['directory_username_identity'] }),
        new TableUnique({ name: 'uq_scim_user_links_external_identity', columnNames: ['external_id_identity'] }),
      ],
      indices: [
        new TableIndex({ name: 'idx_scim_user_links_directory_status', columnNames: ['directory_id', 'status'] }),
        new TableIndex({ name: 'idx_scim_user_links_user', columnNames: ['user_id'] }),
      ],
    }));

    await createIfMissing(queryRunner, new Table({
      name: groups,
      columns: [
        { name: 'id', ...key, isPrimary: true },
        { name: 'tenant_id', ...key, isNullable: true },
        { name: 'directory_id', ...key },
        { name: 'external_id', ...document, isNullable: true },
        { name: 'external_id_identity', ...key },
        { name: 'display_name', ...document },
        { name: 'internal_group_id', ...key, isNullable: true },
        { name: 'status', ...key, default: stringDefault('active') },
        { name: 'version', ...integer, default: numberDefault(1) },
        { name: 'created_at', ...timestamp },
        { name: 'updated_at', ...timestamp },
        { name: 'archived_at', ...timestamp, isNullable: true },
      ],
      uniques: [new TableUnique({ name: 'uq_scim_group_links_external_identity', columnNames: ['external_id_identity'] })],
      indices: [
        new TableIndex({ name: 'idx_scim_group_links_directory_status', columnNames: ['directory_id', 'status'] }),
        new TableIndex({ name: 'idx_scim_group_links_internal_group', columnNames: ['internal_group_id'] }),
      ],
    }));

    await createIfMissing(queryRunner, new Table({
      name: memberships,
      columns: [
        { name: 'id', ...key, isPrimary: true },
        { name: 'tenant_id', ...key, isNullable: true },
        { name: 'directory_id', ...key },
        { name: 'group_link_id', ...key },
        { name: 'user_link_id', ...key },
        { name: 'membership_identity', ...key },
        { name: 'created_at', ...timestamp },
        { name: 'updated_at', ...timestamp },
      ],
      uniques: [new TableUnique({ name: 'uq_scim_group_memberships_identity', columnNames: ['membership_identity'] })],
      indices: [
        new TableIndex({ name: 'idx_scim_group_memberships_group', columnNames: ['group_link_id'] }),
        new TableIndex({ name: 'idx_scim_group_memberships_user', columnNames: ['user_link_id'] }),
      ],
    }));

    await createIfMissing(queryRunner, new Table({
      name: diagnostics,
      columns: [
        { name: 'id', ...key, isPrimary: true },
        { name: 'tenant_id', ...key, isNullable: true },
        { name: 'directory_id', ...key },
        { name: 'request_id', ...key },
        { name: 'event_type', ...key },
        { name: 'resource_type', ...key, isNullable: true },
        { name: 'resource_id', ...document, isNullable: true },
        { name: 'user_id', ...key, isNullable: true },
        { name: 'status', ...key },
        { name: 'code', ...key, isNullable: true },
        { name: 'message', ...document, isNullable: true },
        { name: 'details_json', ...document, default: stringDefault('{}') },
        { name: 'occurred_at', ...timestamp },
      ],
      indices: [
        new TableIndex({ name: 'idx_identity_provisioning_diagnostics_directory_time', columnNames: ['directory_id', 'occurred_at'] }),
        new TableIndex({ name: 'idx_identity_provisioning_diagnostics_request', columnNames: ['request_id'] }),
        new TableIndex({ name: 'idx_identity_provisioning_diagnostics_status', columnNames: ['status', 'occurred_at'] }),
        new TableIndex({ name: 'idx_identity_provisioning_diagnostics_resource', columnNames: ['resource_type', 'resource_id'] }),
      ],
    }));
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const tables = [
      tablePath(queryRunner, 'IdentityProvisioningDiagnostic', 'identity_provisioning_diagnostics'),
      tablePath(queryRunner, 'ScimGroupMembership', 'scim_group_memberships'),
      tablePath(queryRunner, 'ScimGroupLink', 'scim_group_links'),
      tablePath(queryRunner, 'ScimUserLink', 'scim_user_links'),
      tablePath(queryRunner, 'IdentityProvisioningCredential', 'identity_provisioning_credentials'),
      tablePath(queryRunner, 'IdentityProvisioningDirectory', 'identity_provisioning_directories'),
    ];
    for (const table of tables) {
      if (await queryRunner.hasTable(table)) await queryRunner.dropTable(table);
    }
  }
}
