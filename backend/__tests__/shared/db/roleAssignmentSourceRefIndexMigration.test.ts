import { describe, expect, it, vi } from 'vitest';
import { AddRoleAssignmentSourceRefIndex1700000000085 } from '@enterpriseglue/shared/db/migrations/1700000000085-add-role-assignment-source-ref-index.js';

describe('AddRoleAssignmentSourceRefIndex1700000000085', () => {
  it('adds the canonical source-ref lookup index when absent', async () => {
    const createIndex = vi.fn().mockResolvedValue(undefined);
    await new AddRoleAssignmentSourceRefIndex1700000000085().up({
      getTable: vi.fn().mockResolvedValue({ indices: [] }),
      createIndex,
      connection: { getMetadata: () => { throw new Error('metadata unavailable'); } },
    } as any);

    expect(createIndex).toHaveBeenCalledWith('role_assignments', expect.objectContaining({
      name: 'idx_role_assignments_source_ref',
      columnNames: ['source', 'source_ref'],
    }));
  });

  it('does not duplicate the canonical index', async () => {
    const createIndex = vi.fn();
    await new AddRoleAssignmentSourceRefIndex1700000000085().up({
      getTable: vi.fn().mockResolvedValue({ indices: [{ name: 'idx_role_assignments_source_ref' }] }),
      createIndex,
      connection: { getMetadata: () => { throw new Error('metadata unavailable'); } },
    } as any);

    expect(createIndex).not.toHaveBeenCalled();
  });
});
