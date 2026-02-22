import { TableColumn } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';
import { File } from '../entities/index.js';

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
    const fileTablePath = queryRunner.connection.getMetadata(File).tablePath;
    const hasFilesTable = await queryRunner.hasTable(fileTablePath);
    if (!hasFilesTable) {
      console.warn(`Migration ${this.name}: table "${fileTablePath}" not found; skipping.`);
      return;
    }

    const columnsToAdd: TableColumn[] = [];
    if (!(await queryRunner.hasColumn(fileTablePath, 'bpmn_process_id'))) {
      columnsToAdd.push(new TableColumn({ name: 'bpmn_process_id', type: 'text', isNullable: true }));
    }
    if (!(await queryRunner.hasColumn(fileTablePath, 'dmn_decision_id'))) {
      columnsToAdd.push(new TableColumn({ name: 'dmn_decision_id', type: 'text', isNullable: true }));
    }

    // Add columns using TypeORM's database-agnostic API
    if (columnsToAdd.length > 0) {
      await queryRunner.addColumns(fileTablePath, columnsToAdd);
    }

    const fileRepo = queryRunner.manager.getRepository(File);
    const files = await fileRepo.find({
      select: ['id', 'type', 'xml', 'bpmnProcessId', 'dmnDecisionId'],
    });

    // Backfill using TypeORM repository updates (database-agnostic)
    for (const file of files) {
      const type = String(file.type || '');
      if (type === 'bpmn') {
        const nextId = extractBpmnProcessId(String(file.xml || ''));
        if (nextId && nextId !== file.bpmnProcessId) {
          await fileRepo.update(file.id, { bpmnProcessId: nextId });
        }
      } else if (type === 'dmn') {
        const nextId = extractDmnDecisionId(String(file.xml || ''));
        if (nextId && nextId !== file.dmnDecisionId) {
          await fileRepo.update(file.id, { dmnDecisionId: nextId });
        }
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const fileTablePath = queryRunner.connection.getMetadata(File).tablePath;
    if (!(await queryRunner.hasTable(fileTablePath))) {
      return;
    }
    if (await queryRunner.hasColumn(fileTablePath, 'dmn_decision_id')) {
      await queryRunner.dropColumn(fileTablePath, 'dmn_decision_id');
    }
    if (await queryRunner.hasColumn(fileTablePath, 'bpmn_process_id')) {
      await queryRunner.dropColumn(fileTablePath, 'bpmn_process_id');
    }
  }
}
