import { describe, expect, it, vi } from 'vitest';
import { DropRoleAssignmentSourceMappingAlias1700000000093 } from '@enterpriseglue/shared/db/migrations/1700000000093-drop-role-assignment-source-mapping-alias.js';

describe('DropRoleAssignmentSourceMappingAlias1700000000093', () => {
  it('removes the legacy lineage index and alias column', async () => {
    const table = { columns: [{ name: 'id' }, { name: 'source_mapping_id' }, { name: 'source_ref' }], indices: [{ name: 'idx_role_assignments_source' }] };
    const dropIndex = vi.fn();
    const dropColumn = vi.fn();
    await new DropRoleAssignmentSourceMappingAlias1700000000093().up({ hasTable: vi.fn().mockResolvedValue(true), getTable: vi.fn().mockResolvedValue(table), dropIndex, dropColumn } as never);
    expect(dropIndex).toHaveBeenCalledWith(table, table.indices[0]);
    expect(dropColumn).toHaveBeenCalledWith(table, 'source_mapping_id');
  });

  it('is explicitly irreversible', async () => {
    await expect(new DropRoleAssignmentSourceMappingAlias1700000000093().down()).resolves.toBeUndefined();
  });
});
