import { TableColumn } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

const TABLE = 'file_snapshots';
const WORKING_FILES_TABLE = 'working_files';

function quoteIdentifier(value: string): string {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function buildTableRef(schema: string | undefined, name: string): string {
  const normalizedName = String(name);
  const source = normalizedName.includes('.')
    ? normalizedName
    : (schema ? `${schema}.${normalizedName}` : normalizedName);

  return source
    .split('.')
    .filter((part) => part.length > 0)
    .map((part) => quoteIdentifier(part))
    .join('.');
}

export class AddFileSnapshotsMainFileId1700000000010 implements MigrationInterface {
  name = 'AddFileSnapshotsMainFileId1700000000010';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable(TABLE);
    if (!table) return;

    if (!table.columns.some((column) => column.name === 'main_file_id')) {
      await queryRunner.addColumn(table, new TableColumn({
        name: 'main_file_id',
        type: 'text',
        isNullable: true,
      }));
    }

    const workingFilesTable = await queryRunner.getTable(WORKING_FILES_TABLE);
    if (!workingFilesTable) return;

    const tableRef = buildTableRef(table.schema, table.name);
    const workingFilesTableRef = buildTableRef(workingFilesTable.schema, workingFilesTable.name);
    const dbType = queryRunner.connection.options.type;

    if (dbType === 'oracle') {
      await queryRunner.query(`
        MERGE INTO ${tableRef} fs
        USING ${workingFilesTableRef} wf
        ON (fs."working_file_id" = wf."id" AND fs."main_file_id" IS NULL)
        WHEN MATCHED THEN UPDATE SET fs."main_file_id" = wf."main_file_id"
      `);
    } else {
      await queryRunner.query(`
        UPDATE ${tableRef} AS fs
        SET "main_file_id" = wf."main_file_id"
        FROM ${workingFilesTableRef} AS wf
        WHERE fs."main_file_id" IS NULL
          AND fs."working_file_id" = wf."id"
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable(TABLE))) return;
    if (await queryRunner.hasColumn(TABLE, 'main_file_id')) {
      await queryRunner.dropColumn(TABLE, 'main_file_id');
    }
  }
}
