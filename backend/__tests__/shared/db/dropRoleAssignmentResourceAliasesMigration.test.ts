import { describe, expect, it, vi } from 'vitest';
import { DropRoleAssignmentResourceAliases1700000000094 } from '@enterpriseglue/shared/db/migrations/1700000000094-drop-role-assignment-resource-aliases.js';

describe('DropRoleAssignmentResourceAliases1700000000094', () => {
  it('removes the legacy resource index and alias columns', async () => {
    const table = { columns: [{ name: 'id' }, { name: 'resource_type' }, { name: 'resource_id' }, { name: 'scope_type' }, { name: 'scope_id' }], indices: [{ name: 'idx_role_assignments_resource' }] };
    const dropIndex = vi.fn();
    const dropColumn = vi.fn();
    await new DropRoleAssignmentResourceAliases1700000000094().up({ hasTable: vi.fn().mockResolvedValue(true), getTable: vi.fn().mockResolvedValue(table), dropIndex, dropColumn } as never);
    expect(dropIndex).toHaveBeenCalledWith(table, table.indices[0]);
    expect(dropColumn).toHaveBeenCalledWith(table, 'resource_type');
    expect(dropColumn).toHaveBeenCalledWith(table, 'resource_id');
  });
});
