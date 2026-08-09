import { describe, expect, it, vi } from 'vitest';
import { DropLegacySsoProviders1700000000090 } from '@enterpriseglue/shared/db/migrations/1700000000090-drop-legacy-sso-providers.js';

describe('DropLegacySsoProviders1700000000090', () => {
  it('drops the retired provider table only when present', async () => {
    const hasTable = vi.fn().mockResolvedValue(true);
    const dropTable = vi.fn();
    await new DropLegacySsoProviders1700000000090().up({ hasTable, dropTable } as never);
    expect(dropTable).toHaveBeenCalledWith('sso_providers', true, true, true);
  });

  it('is explicitly irreversible', async () => {
    await expect(new DropLegacySsoProviders1700000000090().down()).resolves.toBeUndefined();
  });
});
