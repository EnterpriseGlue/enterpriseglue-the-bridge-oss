import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Registered only by OracleAdapter; other databases keep their epoch inventory. */
export class ExpandOracleAssignmentKeys1700000000134 implements MigrationInterface {
  name = 'ExpandOracleAssignmentKeys1700000000134';

  async up(runner: QueryRunner): Promise<void> {
    if (runner.connection.options.type !== 'oracle') throw new Error('Oracle assignment-key migration requires the Oracle adapter');
    for (const entity of ['RbacRoleAssignment', 'ConfigRoleAssignmentOverride']) {
      const metadata = runner.connection.getMetadata(entity);
      const name = metadata.tablePath;
      const table = await runner.getTable(name);
      const column = table?.findColumnByName('assignment_key');
      if (!column) throw new Error('Oracle canonical assignment-key column is missing');
      if (Number(column.length) >= 4000) continue;
      // TypeORM's Oracle changeColumn drops/recreates length changes. Use a
      // narrowly isolated Oracle MODIFY to preserve existing keys and indexes.
      const reference = [metadata.schema, metadata.tableName].filter(Boolean)
        .map(identifier => runner.connection.driver.escape(identifier!)).join('.');
      await runner.query(`ALTER TABLE ${reference} MODIFY ("assignment_key" VARCHAR2(4000 BYTE))`);
    }
  }

  async down(): Promise<void> {
    // Shrinking could lose or invalidate assignments created after the upgrade.
    throw new Error('Oracle assignment-key widening cannot be automatically reversed; retain the wider columns when rolling back application code');
  }
}
