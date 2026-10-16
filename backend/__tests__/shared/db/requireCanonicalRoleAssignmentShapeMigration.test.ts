import { describe, expect, it, vi } from 'vitest';
import { Table, TableColumn } from 'typeorm';
import { RequireCanonicalRoleAssignmentShape1700000000084 } from '@enterpriseglue/shared/db/migrations/1700000000084-require-canonical-role-assignment-shape.js';

function roleAssignmentsTable(type: string, length: string, nullable: boolean): Table {
  return new Table({
    name: 'role_assignments',
    columns: [
      { name: 'id', type, length, isPrimary: true },
      { name: 'user_id', type, length, isNullable: true },
      { name: 'principal_type', type, length, isNullable: nullable },
      { name: 'principal_id', type, length, isNullable: nullable },
      { name: 'resource_type', type, length, isNullable: true },
      { name: 'resource_id', type, length, isNullable: true },
      { name: 'scope_type', type, length, isNullable: nullable },
      { name: 'scope_id', type, length, isNullable: true },
    ],
  });
}

function queryRunnerFor(table: Table, query: ReturnType<typeof vi.fn>, changeColumn = vi.fn()) {
  return {
    getTable: vi.fn().mockResolvedValue(table), query, changeColumn,
    connection: {
      options: { type: 'oracle' },
      getMetadata: () => { throw new Error('metadata unavailable'); },
      driver: { escape: (name: string) => `"${name}"`, createParameter: (_name: string, index: number) => `:${index + 1}` },
    },
  };
}

describe('RequireCanonicalRoleAssignmentShape1700000000084', () => {
  it('backfills canonical principal and scope fields before requiring them', async () => {
    const query = vi.fn(async (sql: string, _parameters?: unknown[]) => sql.startsWith('SELECT')
      ? [{ id: 'assignment-1', user_id: 'user-1', principal_type: null, principal_id: null, resource_type: 'engine', resource_id: 'engine-1', scope_type: null, scope_id: null }]
      : undefined);
    const changeColumn = vi.fn();
    await new RequireCanonicalRoleAssignmentShape1700000000084().up(
      queryRunnerFor(roleAssignmentsTable('varchar2', '191', true), query, changeColumn) as any,
    );

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE "role_assignments" SET "principal_type" = :1'),
      ['user', 'user-1', 'engine', 'engine-1', 'assignment-1'],
    );
    for (const name of ['principal_type', 'principal_id', 'scope_type']) {
      expect(changeColumn).toHaveBeenCalledWith(
        'role_assignments',
        expect.objectContaining({ name, isNullable: true }),
        expect.objectContaining({ name, type: 'varchar2', length: '191', isNullable: false }),
      );
    }
  });

  it('tightens the live column in place so Oracle never drops and re-adds it on a populated table', async () => {
    const changeColumn = vi.fn();
    await new RequireCanonicalRoleAssignmentShape1700000000084().up(
      queryRunnerFor(roleAssignmentsTable('varchar2', '191', true), vi.fn().mockResolvedValue([]), changeColumn) as any,
    );

    expect(changeColumn).toHaveBeenCalledTimes(3);
    for (const [, oldColumn, newColumn] of changeColumn.mock.calls as [string, TableColumn, TableColumn][]) {
      expect(newColumn.type).toBe(oldColumn.type);
      expect(newColumn.length).toBe(oldColumn.length);
    }
  });

  it('leaves columns that are already required untouched', async () => {
    const changeColumn = vi.fn();
    await new RequireCanonicalRoleAssignmentShape1700000000084().up(
      queryRunnerFor(roleAssignmentsTable('varchar2', '191', false), vi.fn().mockResolvedValue([]), changeColumn) as any,
    );

    expect(changeColumn).not.toHaveBeenCalled();
  });

  it('fails closed for a row without a derivable principal or scope', async () => {
    const query = vi.fn().mockResolvedValue([{ id: 'broken', user_id: null, principal_type: null, principal_id: null, resource_type: null, resource_id: null, scope_type: null, scope_id: null }]);
    await expect(new RequireCanonicalRoleAssignmentShape1700000000084().up(
      queryRunnerFor(roleAssignmentsTable('varchar2', '191', true), query) as any,
    )).rejects.toThrow('Cannot derive canonical principal and scope');
  });
});
