import { Table, TableColumn, TableIndex, TableUnique } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';
import { Tenant } from '../../infrastructure/persistence/entities/Tenant.js';
import { TenantDiscoveryChallenge } from '../../infrastructure/persistence/entities/TenantDiscoveryChallenge.js';
import { TenantDiscoveryDomain } from '../../infrastructure/persistence/entities/TenantDiscoveryDomain.js';
import { TenantDomain } from '../../infrastructure/persistence/entities/TenantDomain.js';
import { TenantLoginPolicy } from '../../infrastructure/persistence/entities/TenantLoginPolicy.js';
import { RefreshToken } from '../../infrastructure/persistence/entities/RefreshToken.js';
import { Invitation } from '../../infrastructure/persistence/entities/Invitation.js';
import {
  portableBigint,
  portableNumberDefault,
  portableStringDefault,
  portableText,
} from './support/portable-columns.js';

const pathFor = (queryRunner: QueryRunner, entity: Function): string => queryRunner.connection.getMetadata(entity).tablePath;

async function addColumnIfMissing(queryRunner: QueryRunner, table: string, column: TableColumn): Promise<void> {
  if (await queryRunner.hasTable(table) && !await queryRunner.hasColumn(table, column.name)) {
    await queryRunner.addColumn(table, column);
  }
}

async function addIndexIfMissing(queryRunner: QueryRunner, table: string, index: TableIndex): Promise<void> {
  const current = await queryRunner.getTable(table);
  if (current && !current.indices.some((candidate) => String(candidate.name).toLowerCase() === String(index.name).toLowerCase())) {
    await queryRunner.createIndex(table, index);
  }
}

async function dropIndexIfPresent(queryRunner: QueryRunner, table: string, name: string): Promise<void> {
  const current = await queryRunner.getTable(table);
  const index = current?.indices.find((candidate) => String(candidate.name).toLowerCase() === name.toLowerCase());
  if (index) await queryRunner.dropIndex(table, index);
}

export class AddNativeSaasTenancy1700000000124 implements MigrationInterface {
  name = 'AddNativeSaasTenancy1700000000124';

  async up(queryRunner: QueryRunner): Promise<void> {
    const key = portableText(queryRunner, 'key');
    const document = portableText(queryRunner, 'document');
    const timestamp = portableBigint(queryRunner);
    const stringDefault = (value: string) => portableStringDefault(queryRunner, value);
    const numberDefault = (value: number) => portableNumberDefault(queryRunner, value);

    const tenants = pathFor(queryRunner, Tenant);
    if (!await queryRunner.hasTable(tenants)) {
      await queryRunner.createTable(new Table({
        name: tenants,
        columns: [
          { name: 'id', ...key, isPrimary: true },
          { name: 'name', ...document },
          { name: 'slug', ...key },
          { name: 'status', ...key, default: stringDefault('active') },
          { name: 'placement_key', ...key, isNullable: true },
          { name: 'placement_epoch', ...timestamp, default: numberDefault(1) },
          { name: 'created_by_user_id', ...key, isNullable: true },
          { name: 'created_at', ...timestamp },
          { name: 'updated_at', ...timestamp },
        ],
        uniques: [new TableUnique({ name: 'uq_tenants_slug', columnNames: ['slug'] })],
        indices: [new TableIndex({ name: 'idx_tenants_status', columnNames: ['status'] })],
      }), true);
    }

    const domains = pathFor(queryRunner, TenantDomain);
    if (!await queryRunner.hasTable(domains)) {
      await queryRunner.createTable(new Table({
        name: domains,
        columns: [
          { name: 'id', ...key, isPrimary: true },
          { name: 'tenant_id', ...key },
          { name: 'hostname', ...key },
          { name: 'status', ...key, default: stringDefault('pending') },
          { name: 'verification_token_hash', ...key, isNullable: true },
          { name: 'verified_at', ...timestamp, isNullable: true },
          { name: 'created_at', ...timestamp },
          { name: 'updated_at', ...timestamp },
        ],
        uniques: [new TableUnique({ name: 'uq_tenant_domains_hostname', columnNames: ['hostname'] })],
        indices: [new TableIndex({ name: 'idx_tenant_domains_tenant', columnNames: ['tenant_id', 'status'] })],
      }), true);
    }

    const discoveryDomains = pathFor(queryRunner, TenantDiscoveryDomain);
    if (!await queryRunner.hasTable(discoveryDomains)) {
      await queryRunner.createTable(new Table({
        name: discoveryDomains,
        columns: [
          { name: 'id', ...key, isPrimary: true },
          { name: 'tenant_id', ...key },
          { name: 'domain', ...key },
          { name: 'status', ...key, default: stringDefault('pending') },
          { name: 'verification_token_hash', ...key, isNullable: true },
          { name: 'verified_at', ...timestamp, isNullable: true },
          { name: 'created_at', ...timestamp },
          { name: 'updated_at', ...timestamp },
        ],
        indices: [
          new TableIndex({ name: 'uq_tenant_discovery_domains_tenant_domain', columnNames: ['tenant_id', 'domain'], isUnique: true }),
          new TableIndex({ name: 'idx_tenant_discovery_domains_lookup', columnNames: ['domain', 'status'] }),
          new TableIndex({ name: 'idx_tenant_discovery_domains_tenant', columnNames: ['tenant_id', 'status'] }),
        ],
      }), true);
    }

    const discoveryChallenges = pathFor(queryRunner, TenantDiscoveryChallenge);
    if (!await queryRunner.hasTable(discoveryChallenges)) {
      await queryRunner.createTable(new Table({
        name: discoveryChallenges,
        columns: [
          { name: 'id', ...key, isPrimary: true },
          { name: 'user_id', ...key },
          { name: 'token_hash', ...key },
          { name: 'expires_at', ...timestamp },
          { name: 'created_at', ...timestamp },
          { name: 'consumed_at', ...timestamp, isNullable: true },
        ],
        indices: [
          new TableIndex({ name: 'idx_tenant_discovery_challenges_token', columnNames: ['token_hash'], isUnique: true }),
          new TableIndex({ name: 'uq_tenant_discovery_challenges_user', columnNames: ['user_id'], isUnique: true }),
        ],
      }), true);
    }

    const policies = pathFor(queryRunner, TenantLoginPolicy);
    if (!await queryRunner.hasTable(policies)) {
      await queryRunner.createTable(new Table({
        name: policies,
        columns: [
          { name: 'id', ...key, isPrimary: true },
          { name: 'tenant_id', ...key },
          { name: 'local_password_mode', ...key, default: stringDefault('auto') },
          { name: 'provider_selection_mode', ...key, default: stringDefault('chooser') },
          { name: 'updated_by_user_id', ...key, isNullable: true },
          { name: 'created_at', ...timestamp },
          { name: 'updated_at', ...timestamp },
        ],
        indices: [new TableIndex({ name: 'uq_tenant_login_policies_tenant', columnNames: ['tenant_id'], isUnique: true })],
      }), true);
    }

    const refreshTokens = pathFor(queryRunner, RefreshToken);
    await addColumnIfMissing(queryRunner, refreshTokens, new TableColumn({ name: 'tenant_id', ...key, isNullable: true }));
    await addIndexIfMissing(queryRunner, refreshTokens, new TableIndex({
      name: 'idx_refresh_tokens_tenant', columnNames: ['tenant_id', 'user_id', 'revoked_at'],
    }));

    const invitations = pathFor(queryRunner, Invitation);
    await addColumnIfMissing(queryRunner, invitations, new TableColumn({ name: 'tenant_id', ...key, isNullable: true }));
    await addIndexIfMissing(queryRunner, invitations, new TableIndex({
      name: 'idx_invitations_tenant', columnNames: ['tenant_id', 'status'],
    }));
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const invitations = pathFor(queryRunner, Invitation);
    await dropIndexIfPresent(queryRunner, invitations, 'idx_invitations_tenant');
    if (await queryRunner.hasColumn(invitations, 'tenant_id')) await queryRunner.dropColumn(invitations, 'tenant_id');
    const refreshTokens = pathFor(queryRunner, RefreshToken);
    await dropIndexIfPresent(queryRunner, refreshTokens, 'idx_refresh_tokens_tenant');
    if (await queryRunner.hasColumn(refreshTokens, 'tenant_id')) await queryRunner.dropColumn(refreshTokens, 'tenant_id');
    for (const entity of [TenantDiscoveryChallenge, TenantDiscoveryDomain, TenantLoginPolicy, TenantDomain, Tenant]) {
      const table = pathFor(queryRunner, entity);
      if (await queryRunner.hasTable(table)) await queryRunner.dropTable(table);
    }
  }
}
