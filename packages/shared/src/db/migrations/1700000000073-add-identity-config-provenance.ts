import { TableColumn } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';
export class AddIdentityConfigProvenance1700000000073 implements MigrationInterface {
  name = 'AddIdentityConfigProvenance1700000000073';
  async up(q: QueryRunner): Promise<void> { for (const table of ['identity_providers', 'identity_entitlement_mappings']) { if (!await q.hasTable(table)) continue; for (const [name, type] of [['source_hash', 'text'], ['last_applied_at', 'bigint'], ['drift_status', 'text']] as const) if (!await q.hasColumn(table, name)) await q.addColumn(table, new TableColumn({ name, type, isNullable: true })); } }
  async down(q: QueryRunner): Promise<void> { for (const table of ['identity_entitlement_mappings', 'identity_providers']) if (await q.hasTable(table)) for (const name of ['drift_status', 'last_applied_at', 'source_hash']) if (await q.hasColumn(table, name)) await q.dropColumn(table, name); }
}
