import { TableColumn } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

function text(queryRunner: QueryRunner): { type: string; length?: string } {
  const database = queryRunner.connection?.options?.type || 'postgres';
  if (database === 'mysql') return { type: 'varchar', length: '191' };
  if (database === 'mssql') return { type: 'nvarchar', length: '191' };
  if (database === 'oracle') return { type: 'varchar2', length: '191' };
  if (database === 'spanner') return { type: 'string', length: '191' };
  return { type: 'text' };
}

/** Persists only the opaque config secret-reference used to reconcile a mapping. */
export class AddEngineBackstopConfigSecretReference1700000000103 implements MigrationInterface {
  name = 'AddEngineBackstopConfigSecretReference1700000000103';

  async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('engine_backstop_group_mappings');
    if (!table || table.columns.some((column) => column.name === 'native_group_secret_ref')) return;
    await queryRunner.addColumn('engine_backstop_group_mappings', new TableColumn({ name: 'native_group_secret_ref', ...text(queryRunner), isNullable: true }));
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('engine_backstop_group_mappings');
    if (table?.columns.some((column) => column.name === 'native_group_secret_ref')) {
      await queryRunner.dropColumn('engine_backstop_group_mappings', 'native_group_secret_ref');
    }
  }
}
