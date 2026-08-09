import { describe, expect, it, vi } from 'vitest';
import { AddUserAuthSessionVersion1700000000083 } from '@enterpriseglue/shared/db/migrations/1700000000083-add-user-auth-session-version.js';

describe('AddUserAuthSessionVersion1700000000083', () => {
  it('adds a non-null session version with a zero default', async () => {
    const addColumn = vi.fn();
    const queryRunner = {
      hasTable: vi.fn().mockResolvedValue(true), hasColumn: vi.fn().mockResolvedValue(false), addColumn,
      connection: { getMetadata: () => { throw new Error('metadata unavailable'); } },
    };

    await new AddUserAuthSessionVersion1700000000083().up(queryRunner as any);

    expect(addColumn).toHaveBeenCalledWith('users', expect.objectContaining({
      name: 'auth_session_version', type: 'integer', default: '0', isNullable: false,
    }));
  });
});
