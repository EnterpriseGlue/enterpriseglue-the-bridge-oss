import { describe, expect, it, vi } from 'vitest';
import { DropRoleAssignmentUserAlias1700000000095 } from '@enterpriseglue/shared/db/migrations/1700000000095-drop-role-assignment-user-alias.js';

describe('DropRoleAssignmentUserAlias1700000000095', () => {
  it('removes the legacy user index and alias column', async () => {
    const table = { columns: [{ name: 'id' }, { name: 'user_id' }, { name: 'principal_type' }, { name: 'principal_id' }], indices: [{ name: 'idx_role_assignments_user' }] };
    const dropIndex = vi.fn();
    const dropColumn = vi.fn();
    await new DropRoleAssignmentUserAlias1700000000095().up({ hasTable: vi.fn().mockResolvedValue(true), getTable: vi.fn().mockResolvedValue(table), dropIndex, dropColumn } as never);
    expect(dropIndex).toHaveBeenCalledWith(table, table.indices[0]);
    expect(dropColumn).toHaveBeenCalledWith(table, 'user_id');
  });
});
