import { describe, expect, it, vi } from 'vitest';
import { FinalizeLegacyRoleAssignmentProjections1700000000091 } from '@enterpriseglue/shared/db/migrations/1700000000091-finalize-legacy-role-assignment-projections.js';

describe('FinalizeLegacyRoleAssignmentProjections1700000000091', () => {
  it('creates the durable marker table only when it is absent', async () => {
    const hasTable = vi.fn().mockResolvedValue(false);
    const createTable = vi.fn();
    await new FinalizeLegacyRoleAssignmentProjections1700000000091().up({ hasTable, createTable } as never);

    expect(createTable).toHaveBeenCalledWith(expect.objectContaining({
      name: 'authz_migration_states',
    }), true);
  });

  it('does not recreate an existing marker table', async () => {
    const hasTable = vi.fn().mockResolvedValue(true);
    const createTable = vi.fn();
    await new FinalizeLegacyRoleAssignmentProjections1700000000091().up({ hasTable, createTable } as never);

    expect(createTable).not.toHaveBeenCalled();
  });

  it('is explicitly irreversible', async () => {
    await expect(new FinalizeLegacyRoleAssignmentProjections1700000000091().down()).resolves.toBeUndefined();
  });
});
