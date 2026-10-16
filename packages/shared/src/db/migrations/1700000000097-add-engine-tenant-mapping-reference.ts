import { TableColumn } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

function portableDocumentText(queryRunner: QueryRunner): { type: string; length?: string } {
  const database = queryRunner.connection.options?.type || 'postgres';
  if (database === 'mssql') return { type: 'nvarchar', length: '4000' };
  if (database === 'oracle') return { type: 'varchar2', length: '4000' };
  if (database === 'spanner') return { type: 'string', length: '4096' };
  return { type: 'text' };
}

function tablePath(queryRunner: QueryRunner): string {
  try {
    return queryRunner.connection.getMetadata('EngineTenantMapping').tablePath;
  } catch {
    return 'engine_tenant_mappings';
  }
}

/**
 * Retains the authorized, sanitized tenant reference used to create a mapping.
 * The resolved tenant ID remains the runtime authority; this reference exists
 * so configuration export can round-trip stable tenant keys across installs.
 */
export class AddEngineTenantMappingReference1700000000097 implements MigrationInterface {
  name = 'AddEngineTenantMappingReference1700000000097';

  async up(queryRunner: QueryRunner): Promise<void> {
    const mappings = tablePath(queryRunner);
    if (
      await queryRunner.hasTable(mappings)
      && !(await queryRunner.hasColumn(mappings, 'tenant_reference_json'))
    ) {
      await queryRunner.addColumn(mappings, new TableColumn({
        name: 'tenant_reference_json',
        ...portableDocumentText(queryRunner),
        isNullable: true,
      }));
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const mappings = tablePath(queryRunner);
    if (
      await queryRunner.hasTable(mappings)
      && await queryRunner.hasColumn(mappings, 'tenant_reference_json')
    ) {
      await queryRunner.dropColumn(mappings, 'tenant_reference_json');
    }
  }
}
