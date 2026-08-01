import { TableColumn, TableIndex } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';
import {
  addNullableColumnIfMissing,
  addRequiredColumnWithBackfill,
  portableBoolean,
  portableBooleanDefault,
  portableText,
  sqlBooleanLiteral,
  sqlIdentifier,
  sqlStringLiteral,
  sqlTablePath,
} from './support/portable-columns.js';

function tablePath(queryRunner: QueryRunner, entity: string, fallback: string): string {
  try { return queryRunner.connection.getMetadata(entity).tablePath; } catch { return fallback; }
}

function persistedBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true';
}

export class ConsolidateLoginProviderPreference1700000000107 implements MigrationInterface {
  name = 'ConsolidateLoginProviderPreference1700000000107';

  async up(queryRunner: QueryRunner): Promise<void> {
    const providerTable = tablePath(queryRunner, 'IdentityProvider', 'identity_providers');
    if (await queryRunner.hasTable(providerTable)) {
      await addNullableColumnIfMissing(queryRunner, providerTable, new TableColumn({
        name: 'preferred_scope_identity',
        ...portableText(queryRunner, 'key'),
        isNullable: true,
      }));

      const table = sqlTablePath(queryRunner, providerTable);
      const idColumn = sqlIdentifier(queryRunner, 'id');
      const tenantColumn = sqlIdentifier(queryRunner, 'tenant_id');
      const preferredColumn = sqlIdentifier(queryRunner, 'is_preferred');
      const identityColumn = sqlIdentifier(queryRunner, 'preferred_scope_identity');
      const rows = await queryRunner.query(
        `SELECT ${idColumn} AS ${idColumn}, ${tenantColumn} AS ${tenantColumn}, ${preferredColumn} AS ${preferredColumn} FROM ${table}`,
      ) as Array<{ id: string; tenant_id: string | null; is_preferred: unknown }>;
      const preferredScopes = new Set<string>();

      for (const row of [...rows].sort((left, right) => String(left.id).localeCompare(String(right.id)))) {
        const scope = row.tenant_id || 'platform';
        const keepPreferred = persistedBoolean(row.is_preferred) && !preferredScopes.has(scope);
        if (keepPreferred) preferredScopes.add(scope);
        const identity = keepPreferred ? `preferred:${scope}` : `provider:${row.id}`;
        await queryRunner.query(
          `UPDATE ${table} SET ${identityColumn} = ${sqlStringLiteral(identity)}, ${preferredColumn} = ${sqlBooleanLiteral(queryRunner, keepPreferred)} WHERE ${idColumn} = ${sqlStringLiteral(String(row.id))}`,
        );
      }

      await addRequiredColumnWithBackfill(
        queryRunner,
        providerTable,
        new TableColumn({ name: 'preferred_scope_identity', ...portableText(queryRunner, 'key') }),
        sqlStringLiteral('provider:migration-unassigned'),
      );
      const refreshed = await queryRunner.getTable(providerTable);
      if (!refreshed?.indices.some((index) => index.name === 'uq_identity_providers_preferred_scope_identity')) {
        await queryRunner.createIndex(providerTable, new TableIndex({
          name: 'uq_identity_providers_preferred_scope_identity',
          columnNames: ['preferred_scope_identity'],
          isUnique: true,
        }));
      }
    }

    const settingsTable = tablePath(queryRunner, 'PlatformSettings', 'platform_settings');
    if (await queryRunner.hasTable(settingsTable) && await queryRunner.hasColumn(settingsTable, 'sso_auto_redirect_single_provider')) {
      await queryRunner.dropColumn(settingsTable, 'sso_auto_redirect_single_provider');
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const settingsTable = tablePath(queryRunner, 'PlatformSettings', 'platform_settings');
    if (await queryRunner.hasTable(settingsTable)) {
      await addRequiredColumnWithBackfill(
        queryRunner,
        settingsTable,
        new TableColumn({
          name: 'sso_auto_redirect_single_provider',
          ...portableBoolean(queryRunner),
          default: portableBooleanDefault(queryRunner, false),
        }),
        sqlBooleanLiteral(queryRunner, false),
      );
    }

    const providerTable = tablePath(queryRunner, 'IdentityProvider', 'identity_providers');
    if (await queryRunner.hasTable(providerTable)) {
      const table = await queryRunner.getTable(providerTable);
      const index = table?.indices.find((candidate) => candidate.name === 'uq_identity_providers_preferred_scope_identity');
      if (index) await queryRunner.dropIndex(providerTable, index);
      if (await queryRunner.hasColumn(providerTable, 'preferred_scope_identity')) {
        await queryRunner.dropColumn(providerTable, 'preferred_scope_identity');
      }
    }
  }
}
