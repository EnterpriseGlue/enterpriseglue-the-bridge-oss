import { TableColumn } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

const TABLE = 'files';

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
    if (!(await queryRunner.hasTable(TABLE))) {
      console.warn(`Migration ${this.name}: table "${TABLE}" not found; skipping.`);
      return;
    }

    const columnsToAdd: TableColumn[] = [];
    if (!(await queryRunner.hasColumn(TABLE, 'bpmn_process_id'))) {
      columnsToAdd.push(new TableColumn({ name: 'bpmn_process_id', type: 'text', isNullable: true }));
    }
    if (!(await queryRunner.hasColumn(TABLE, 'dmn_decision_id'))) {
      columnsToAdd.push(new TableColumn({ name: 'dmn_decision_id', type: 'text', isNullable: true }));
    }

    if (columnsToAdd.length > 0) {
      await queryRunner.addColumns(TABLE, columnsToAdd);
    }

    const esc = (s: string) => String(s).replace(/'/g, "''");
    const files: Array<{ id: string; type: string; xml: string; bpmn_process_id: string | null; dmn_decision_id: string | null }> =
      await queryRunner.query(`SELECT "id", "type", "xml", "bpmn_process_id", "dmn_decision_id" FROM "${TABLE}"`);

    for (const file of files) {
      const type = String(file.type || '');
      if (type === 'bpmn') {
        const nextId = extractBpmnProcessId(String(file.xml || ''));
        if (nextId && nextId !== file.bpmn_process_id) {
          await queryRunner.query(`UPDATE "${TABLE}" SET "bpmn_process_id" = '${esc(nextId)}' WHERE "id" = '${esc(file.id)}'`);
        }
      } else if (type === 'dmn') {
        const nextId = extractDmnDecisionId(String(file.xml || ''));
        if (nextId && nextId !== file.dmn_decision_id) {
          await queryRunner.query(`UPDATE "${TABLE}" SET "dmn_decision_id" = '${esc(nextId)}' WHERE "id" = '${esc(file.id)}'`);
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
