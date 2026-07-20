import { describe, expect, it, vi } from 'vitest';
import { DropLegacySsoMappingTables1700000000089 } from '@enterpriseglue/shared/db/migrations/1700000000089-drop-legacy-sso-mapping-tables.js';

describe('DropLegacySsoMappingTables1700000000089', () => {
  it('drops only the retired mapping tables that are present', async () => {
    const hasTable = vi.fn(async (name: string) => name !== 'sso_group_mappings');
    const dropTable = vi.fn();
    await new DropLegacySsoMappingTables1700000000089().up({ hasTable, dropTable } as never);
    expect(dropTable).toHaveBeenCalledTimes(2);
    expect(dropTable).toHaveBeenCalledWith('sso_assignment_mappings', true, true, true);
    expect(dropTable).toHaveBeenCalledWith('sso_claims_mappings', true, true, true);
  });

  it('is explicitly irreversible', async () => {
    await expect(new DropLegacySsoMappingTables1700000000089().down()).resolves.toBeUndefined();
  });
});
