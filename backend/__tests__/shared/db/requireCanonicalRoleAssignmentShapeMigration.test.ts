import { describe, expect, it, vi } from 'vitest';
import { RequireCanonicalRoleAssignmentShape1700000000084 } from '@enterpriseglue/shared/db/migrations/1700000000084-require-canonical-role-assignment-shape.js';

describe('RequireCanonicalRoleAssignmentShape1700000000084', () => {
  it('backfills canonical principal and scope fields before requiring them', async () => {
    const query = vi.fn(async (sql: string, _parameters?: unknown[]) => sql.startsWith('SELECT')
      ? [{ id: 'assignment-1', user_id: 'user-1', principal_type: null, principal_id: null, resource_type: 'engine', resource_id: 'engine-1', scope_type: null, scope_id: null }]
      : undefined);
    const changeColumn = vi.fn();
    await new RequireCanonicalRoleAssignmentShape1700000000084().up({
      getTable: vi.fn().mockResolvedValue({}), query, changeColumn,
      connection: { getMetadata: () => { throw new Error('metadata unavailable'); }, driver: { createParameter: (_name: string, index: number) => `$${index + 1}` } },
    } as any);

    expect(query).toHaveBeenCalledWith(expect.stringContaining('UPDATE role_assignments SET principal_type = $1'), ['user', 'user-1', 'engine', 'engine-1', 'assignment-1']);
    expect(changeColumn).toHaveBeenCalledWith('role_assignments', 'principal_type', expect.objectContaining({ isNullable: false }));
    expect(changeColumn).toHaveBeenCalledWith('role_assignments', 'principal_id', expect.objectContaining({ isNullable: false }));
    expect(changeColumn).toHaveBeenCalledWith('role_assignments', 'scope_type', expect.objectContaining({ isNullable: false }));
  });

  it('fails closed for a row without a derivable principal or scope', async () => {
    await expect(new RequireCanonicalRoleAssignmentShape1700000000084().up({
      getTable: vi.fn().mockResolvedValue({}),
      query: vi.fn().mockResolvedValue([{ id: 'broken', user_id: null, principal_type: null, principal_id: null, resource_type: null, resource_id: null, scope_type: null, scope_id: null }]),
      connection: { getMetadata: () => { throw new Error('metadata unavailable'); }, driver: { createParameter: (_name: string, index: number) => `$${index + 1}` } },
    } as any)).rejects.toThrow('Cannot derive canonical principal and scope');
  });
});
