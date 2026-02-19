import { TableColumn } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';
import { File } from '../entities/File.js';

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
    // Add columns using TypeORM's database-agnostic API
    await queryRunner.addColumns('files', [
      new TableColumn({ name: 'bpmn_process_id', type: 'text', isNullable: true }),
      new TableColumn({ name: 'dmn_decision_id', type: 'text', isNullable: true }),
    ]);

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
    await queryRunner.dropColumn('files', 'dmn_decision_id');
    await queryRunner.dropColumn('files', 'bpmn_process_id');
  }
}
