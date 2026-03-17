import { TableColumn } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

const TABLE = 'working_files';
const FILES_TABLE = 'files';

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

export class AddWorkingFilesMainFileId1700000000009 implements MigrationInterface {
  name = 'AddWorkingFilesMainFileId1700000000009';

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

    const filesTable = await queryRunner.getTable(FILES_TABLE);
    if (!filesTable) return;

    const tableRef = buildTableRef(table.schema, table.name);
    const filesTableRef = buildTableRef(filesTable.schema, filesTable.name);

    await queryRunner.query(`
      UPDATE ${tableRef} AS wf
      SET "main_file_id" = f."id"
      FROM ${filesTableRef} AS f
      WHERE wf."main_file_id" IS NULL
        AND wf."project_id" = f."project_id"
        AND wf."name" = f."name"
        AND wf."type" = f."type"
        AND COALESCE(wf."folder_id", '') = COALESCE(f."folder_id", '')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable(TABLE))) return;
    if (await queryRunner.hasColumn(TABLE, 'main_file_id')) {
      await queryRunner.dropColumn(TABLE, 'main_file_id');
    }
  }
}
