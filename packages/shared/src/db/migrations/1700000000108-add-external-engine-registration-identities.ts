import { createHash } from 'node:crypto';
import { TableColumn, TableIndex } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';
import { addRequiredColumnWithBackfill, portableText, sqlIdentifier, sqlStringLiteral, sqlTablePath } from './support/portable-columns.js';

function tablePath(queryRunner: QueryRunner): string {
  try { return queryRunner.connection.getMetadata('ExternalEngineRegistration').tablePath; } catch { return 'external_engine_registrations'; }
}

function identity(domain: string, ...values: string[]): string {
  return createHash('sha256').update([domain, ...values].join('\u0000')).digest('hex');
}

function sourceOwner(row: {
  engine_id: string;
  registration_source: string;
  api_client_id: string | null;
  external_system_id: string | null;
}): string {
  if (row.external_system_id) return `external-system:${row.external_system_id}`;
  if (row.registration_source === 'external_api' && row.api_client_id) return `api-client:${row.api_client_id}`;
  return `${row.registration_source || 'unknown'}:${row.engine_id}`;
}

/** Adds portable unique ownership and active-id claims for atomic external registration. */
export class AddExternalEngineRegistrationIdentities1700000000108 implements MigrationInterface {
  name = 'AddExternalEngineRegistrationIdentities1700000000108';

  async up(queryRunner: QueryRunner): Promise<void> {
    const tableName = tablePath(queryRunner);
    const table = await queryRunner.getTable(tableName);
    if (!table) return;
    if (!table.columns.some((column) => column.name === 'source_identity')) {
      await queryRunner.addColumn(tableName, new TableColumn({ name: 'source_identity', ...portableText(queryRunner, 'key'), isNullable: true }));
    }
    if (!table.columns.some((column) => column.name === 'active_external_id_identity')) {
      await queryRunner.addColumn(tableName, new TableColumn({ name: 'active_external_id_identity', ...portableText(queryRunner, 'key'), isNullable: true }));
    }

    const escapedTable = sqlTablePath(queryRunner, tableName);
    const columns = ['id', 'engine_id', 'external_id', 'registration_source', 'api_client_id', 'external_system_id', 'lifecycle_status']
      .map((column) => sqlIdentifier(queryRunner, column))
      .join(', ');
    const rawRows = await queryRunner.query(
      `SELECT ${columns} FROM ${escapedTable}`,
    ) as Array<Record<string, string | null>>;
    const rows = rawRows.map((row) => ({
      id: String(row.id ?? row.ID),
      engine_id: String(row.engine_id ?? row.ENGINE_ID),
      external_id: String(row.external_id ?? row.EXTERNAL_ID),
      registration_source: String(row.registration_source ?? row.REGISTRATION_SOURCE ?? ''),
      api_client_id: row.api_client_id ?? row.API_CLIENT_ID ?? null,
      external_system_id: row.external_system_id ?? row.EXTERNAL_SYSTEM_ID ?? null,
      lifecycle_status: row.lifecycle_status ?? row.LIFECYCLE_STATUS ?? null,
    })) as Array<{
      id: string;
      engine_id: string;
      external_id: string;
      registration_source: string;
      api_client_id: string | null;
      external_system_id: string | null;
      lifecycle_status: string | null;
    }>;
    const activeClaims = new Map<string, string>();
    const sourceClaims = new Map<string, string>();
    for (const row of rows.filter((candidate) => candidate.lifecycle_status !== 'decommissioned')) {
      const activeClaim = identity('external-engine-active-v1', row.external_id);
      const sourceClaim = identity('external-engine-source-v1', sourceOwner(row), row.external_id);
      if (activeClaims.has(activeClaim)) {
        throw new Error(`External engine registration identity migration blocked: duplicate active externalId ${JSON.stringify(row.external_id)}. Decommission or rename duplicate registrations before upgrading.`);
      }
      if (sourceClaims.has(sourceClaim)) {
        throw new Error(`External engine registration identity migration blocked: duplicate source claim for externalId ${JSON.stringify(row.external_id)}.`);
      }
      activeClaims.set(activeClaim, row.id);
      sourceClaims.set(sourceClaim, row.id);
    }
    for (const row of rows) {
      const active = row.lifecycle_status !== 'decommissioned';
      const sourceIdentity = active
        ? identity('external-engine-source-v1', sourceOwner(row), row.external_id)
        : identity('external-engine-retired-source-v1', row.id);
      const activeExternalIdIdentity = active
        ? identity('external-engine-active-v1', row.external_id)
        : identity('external-engine-retired-active-v1', row.id);
      const sourceParameter = queryRunner.connection.driver.createParameter('sourceIdentity', 0);
      const activeParameter = queryRunner.connection.driver.createParameter('activeExternalIdIdentity', 1);
      const idParameter = queryRunner.connection.driver.createParameter('registrationId', 2);
      const sourceColumn = sqlIdentifier(queryRunner, 'source_identity');
      const activeColumn = sqlIdentifier(queryRunner, 'active_external_id_identity');
      const idColumn = sqlIdentifier(queryRunner, 'id');
      await queryRunner.query(
        `UPDATE ${escapedTable} SET ${sourceColumn} = ${sourceParameter}, ${activeColumn} = ${activeParameter} WHERE ${idColumn} = ${idParameter}`,
        [sourceIdentity, activeExternalIdIdentity, row.id],
      );
    }

    await addRequiredColumnWithBackfill(
      queryRunner,
      tableName,
      new TableColumn({ name: 'source_identity', ...portableText(queryRunner, 'key'), isNullable: false }),
      sqlStringLiteral('migration-unassigned-source'),
    );
    await addRequiredColumnWithBackfill(
      queryRunner,
      tableName,
      new TableColumn({ name: 'active_external_id_identity', ...portableText(queryRunner, 'key'), isNullable: false }),
      sqlStringLiteral('migration-unassigned-active'),
    );
    const constrained = await queryRunner.getTable(tableName);
    if (!constrained) return;
    if (![...constrained.uniques, ...constrained.indices].some((candidate) => candidate.name === 'uq_external_engine_registrations_source_identity')) {
      await queryRunner.createIndex(tableName, new TableIndex({
        name: 'uq_external_engine_registrations_source_identity',
        columnNames: ['source_identity'],
        isUnique: true,
      }));
    }
    const withSourceUnique = await queryRunner.getTable(tableName);
    if (withSourceUnique && ![...withSourceUnique.uniques, ...withSourceUnique.indices].some((candidate) => candidate.name === 'uq_external_engine_registrations_active_external_identity')) {
      await queryRunner.createIndex(tableName, new TableIndex({
        name: 'uq_external_engine_registrations_active_external_identity',
        columnNames: ['active_external_id_identity'],
        isUnique: true,
      }));
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const tableName = tablePath(queryRunner);
    const table = await queryRunner.getTable(tableName);
    if (!table) return;
    const activeIndex = table.indices.find((index) => index.name === 'uq_external_engine_registrations_active_external_identity');
    const activeUnique = table.uniques.find((unique) => unique.name === 'uq_external_engine_registrations_active_external_identity');
    if (activeIndex) await queryRunner.dropIndex(tableName, activeIndex);
    else if (activeUnique) await queryRunner.dropUniqueConstraint(tableName, activeUnique);
    const sourceIndex = table.indices.find((index) => index.name === 'uq_external_engine_registrations_source_identity');
    const sourceUnique = table.uniques.find((unique) => unique.name === 'uq_external_engine_registrations_source_identity');
    if (sourceIndex) await queryRunner.dropIndex(tableName, sourceIndex);
    else if (sourceUnique) await queryRunner.dropUniqueConstraint(tableName, sourceUnique);
    if (await queryRunner.hasColumn(tableName, 'active_external_id_identity')) await queryRunner.dropColumn(tableName, 'active_external_id_identity');
    if (await queryRunner.hasColumn(tableName, 'source_identity')) await queryRunner.dropColumn(tableName, 'source_identity');
  }
}
