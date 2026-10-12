import { describe, expect, it, vi } from 'vitest';
import { ExpandOracleAssignmentKeys1700000000134 } from '@enterpriseglue/shared/db/migrations/oracle/1700000000134-expand-oracle-assignment-keys.js';

describe('Oracle assignment-key upgrade', () => {
  const fixture = (length = '191') => ({
    connection: { options: { type: 'oracle' },
      getMetadata: (entity: string) => ({ schema: 'APP', tableName: entity, tablePath: `APP.${entity}` }),
      driver: { escape: (identifier: string) => `"${identifier}"` },
    },
    getTable: vi.fn().mockResolvedValue({ findColumnByName: () => ({ length }) }),
    query: vi.fn(), changeColumn: vi.fn(), dropColumn: vi.fn(),
  });
  it('widens existing keys in place while retaining indexes and data', async () => {
    const runner = fixture();
    await new ExpandOracleAssignmentKeys1700000000134().up(runner as any);
    expect(runner.query).toHaveBeenCalledWith('ALTER TABLE "APP"."RbacRoleAssignment" MODIFY ("assignment_key" VARCHAR2(4000 BYTE))');
    expect(runner.query).toHaveBeenCalledTimes(2);
    expect(runner.dropColumn).not.toHaveBeenCalled();
    expect(runner.changeColumn).not.toHaveBeenCalled();
  });
  it('does not rewrite an already wide schema', async () => {
    const runner = fixture('4000');
    await new ExpandOracleAssignmentKeys1700000000134().up(runner as any);
    expect(runner.query).not.toHaveBeenCalled();
  });
  it('refuses destructive automatic shrinking', async () => {
    await expect(new ExpandOracleAssignmentKeys1700000000134().down()).rejects.toThrow('cannot be automatically reversed');
  });
});
