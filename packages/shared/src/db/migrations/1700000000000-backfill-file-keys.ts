import { TableColumn } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

const TABLE = 'files';

function quoteIdentifier(value: string): string {
  return `"${String(value).replace(/"/g, '""')}"`
}

function escapeLiteral(value: string): string {
  return String(value).replace(/'/g, "''")
}

function buildTableRef(schema: string | undefined, name: string): string {
  const normalizedName = String(name)
  const source = normalizedName.includes('.')
    ? normalizedName
    : (schema ? `${schema}.${normalizedName}` : normalizedName)

  return source
    .split('.')
    .filter((part) => part.length > 0)
    .map((part) => quoteIdentifier(part))
    .join('.')
}

function extractBpmnProcessId(xml: string): string | null {
  const match = String(xml || '').match(/<\s*(?:[a-zA-Z0-9_-]+:)?process\b[^>]*\bid\s*=\s*["']([^"']+)["'][^>]*>/i)
  return match?.[1] ? String(match[1]) : null
}

function extractDmnDecisionId(xml: string): string | null {
  const match = String(xml || '').match(/<\s*(?:[a-zA-Z0-9_-]+:)?decision\b[^>]*\bid\s*=\s*["']([^"']+)["'][^>]*>/i)
  return match?.[1] ? String(match[1]) : null
}

export class AddFileLinkColumns1700000000000 implements MigrationInterface {
  name = 'AddFileLinkColumns1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable(TABLE)
    if (!table) {
      console.warn(`Migration ${this.name}: table "${TABLE}" not found; skipping.`);
      return;
    }

    const tableRef = buildTableRef(table.schema, table.name)

    const columnsToAdd: TableColumn[] = [];
    if (!table.columns.some((column) => column.name === 'bpmn_process_id')) {
      columnsToAdd.push(new TableColumn({ name: 'bpmn_process_id', type: 'text', isNullable: true }));
    }
    if (!table.columns.some((column) => column.name === 'dmn_decision_id')) {
      columnsToAdd.push(new TableColumn({ name: 'dmn_decision_id', type: 'text', isNullable: true }));
    }

    if (columnsToAdd.length > 0) {
      await queryRunner.addColumns(table, columnsToAdd);
    }

    const files: Array<{ id: string; type: string; xml: string; bpmn_process_id: string | null; dmn_decision_id: string | null }> =
      await queryRunner.query(`SELECT "id", "type", "xml", "bpmn_process_id", "dmn_decision_id" FROM ${tableRef}`);

    for (const file of files) {
      const type = String(file.type || '');
      if (type === 'bpmn') {
        const nextId = extractBpmnProcessId(String(file.xml || ''));
        if (nextId && nextId !== file.bpmn_process_id) {
          await queryRunner.query(`UPDATE ${tableRef} SET "bpmn_process_id" = '${escapeLiteral(nextId)}' WHERE "id" = '${escapeLiteral(file.id)}'`);
        }
      } else if (type === 'dmn') {
        const nextId = extractDmnDecisionId(String(file.xml || ''));
        if (nextId && nextId !== file.dmn_decision_id) {
          await queryRunner.query(`UPDATE ${tableRef} SET "dmn_decision_id" = '${escapeLiteral(nextId)}' WHERE "id" = '${escapeLiteral(file.id)}'`);
        }
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable(TABLE))) return;
    if (await queryRunner.hasColumn(TABLE, 'dmn_decision_id')) {
      await queryRunner.dropColumn(TABLE, 'dmn_decision_id');
    }
    if (await queryRunner.hasColumn(TABLE, 'bpmn_process_id')) {
      await queryRunner.dropColumn(TABLE, 'bpmn_process_id');
    }
  }
}
