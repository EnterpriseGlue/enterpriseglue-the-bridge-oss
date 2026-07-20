import { describe, expect, it, vi } from 'vitest';
import { DropLegacyUserIdentityColumns1700000000092 } from '@enterpriseglue/shared/db/migrations/1700000000092-drop-legacy-user-identity-columns.js';

describe('DropLegacyUserIdentityColumns1700000000092', () => {
  it('drops only the retired provider-specific user identity columns', async () => {
    const table = { columns: [
      { name: 'id' },
      { name: 'entra_id' },
      { name: 'entra_email' },
      { name: 'google_id' },
    ] };
    const hasTable = vi.fn().mockResolvedValue(true);
    const getTable = vi.fn().mockResolvedValue(table);
    const dropColumn = vi.fn();

    await new DropLegacyUserIdentityColumns1700000000092().up({ hasTable, getTable, dropColumn } as never);

    expect(dropColumn).toHaveBeenNthCalledWith(1, table, 'entra_id');
    expect(dropColumn).toHaveBeenNthCalledWith(2, table, 'entra_email');
    expect(dropColumn).toHaveBeenNthCalledWith(3, table, 'google_id');
  });

  it('is explicitly irreversible', async () => {
    await expect(new DropLegacyUserIdentityColumns1700000000092().down()).resolves.toBeUndefined();
  });
});
