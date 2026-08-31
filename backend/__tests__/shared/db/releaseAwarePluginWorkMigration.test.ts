import { describe, expect, it, vi } from 'vitest';
import { TableColumn } from 'typeorm';

import { AddReleaseAwarePluginWork1700000000130 } from '@enterpriseglue/shared/db/migrations/1700000000130-add-release-aware-plugin-work.js';

function runner(database: string) {
  const columns = new Map<string, TableColumn[]>();
  const createdTables: any[] = [];
  const path = (entity: string | { name?: string }) => {
    const name = typeof entity === 'string' ? entity : entity.name;
    return `main.${name === 'PluginEventDelivery' ? 'plugin_event_deliveries' : name === 'PluginScheduledJob' ? 'plugin_scheduled_jobs' : 'tenant_release_work_assignments'}`;
  };
  return {
    connection: { options: { type: database }, getMetadata: vi.fn((entity: string | { name?: string }) => ({ tablePath: path(entity) })) },
    hasColumn: vi.fn(async (table: string, name: string) => (columns.get(table) ?? []).some((column) => column.name === name)),
    addColumn: vi.fn(async (table: string, column: TableColumn) => columns.set(table, [...(columns.get(table) ?? []), column.clone()])),
    hasTable: vi.fn(async (table: string) => !table.endsWith('tenant_release_work_assignments')),
    createTable: vi.fn(async (table: any) => { createdTables.push(table); }),
    dropTable: vi.fn(async () => undefined),
    dropColumn: vi.fn(async () => undefined),
    columns,
    createdTables,
  } as any;
}

describe('AddReleaseAwarePluginWork1700000000130', () => {
  it.each(['postgres', 'mysql', 'mssql', 'oracle', 'spanner'])(
    'adds nullable release affinity and a portable assignment table on %s',
    async (database) => {
      const queryRunner = runner(database);
      await new AddReleaseAwarePluginWork1700000000130().up(queryRunner);
      for (const table of ['main.plugin_event_deliveries', 'main.plugin_scheduled_jobs']) {
        expect(queryRunner.columns.get(table)?.map((column: TableColumn) => ({ name: column.name, nullable: column.isNullable }))).toEqual([
          { name: 'release_id', nullable: true },
          { name: 'assignment_epoch', nullable: true },
        ]);
      }
      expect(queryRunner.createdTables).toHaveLength(1);
      expect(queryRunner.createdTables[0].name).toBe('main.tenant_release_work_assignments');
      expect(queryRunner.createdTables[0].columns.map((column: { name: string }) => column.name)).toEqual(['id', 'tenant_ref', 'release_id', 'assignment_epoch', 'updated_at']);
      expect(queryRunner.createdTables[0].indices).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'idx_tenant_release_work_assignment_release' })]));
    },
  );
});
