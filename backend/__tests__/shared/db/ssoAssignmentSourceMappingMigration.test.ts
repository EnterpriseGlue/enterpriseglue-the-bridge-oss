import { describe, expect, it, vi } from 'vitest';
import { BackfillSsoAssignmentSourceMapping1700000000081 } from '@enterpriseglue/shared/db/migrations/1700000000081-backfill-sso-assignment-source-mapping.js';

describe('BackfillSsoAssignmentSourceMapping1700000000081', () => {
  it('backfills the cleanup lineage only for SSO assignments that have a source reference', async () => {
    const query = vi.fn();
    const queryRunner = {
      getTable: vi.fn().mockResolvedValue({ columns: [{ name: 'source_mapping_id' }, { name: 'source_ref' }] }),
      query,
      connection: {
        getMetadata: () => { throw new Error('metadata unavailable'); },
        driver: { createParameter: (_name: string, index: number) => `$${index + 1}` },
      },
    };

    await new BackfillSsoAssignmentSourceMapping1700000000081().up(queryRunner as any);

    expect(query).toHaveBeenCalledWith(
      'UPDATE role_assignments SET source_mapping_id = source_ref WHERE source = $1 AND source_mapping_id IS NULL AND source_ref IS NOT NULL',
      ['sso'],
    );
  });

  it('does nothing when an older database does not have both lineage columns', async () => {
    const query = vi.fn();
    const queryRunner = {
      getTable: vi.fn().mockResolvedValue({ columns: [{ name: 'source_ref' }] }),
      query,
      connection: { getMetadata: () => { throw new Error('metadata unavailable'); }, driver: { createParameter: vi.fn() } },
    };

    await new BackfillSsoAssignmentSourceMapping1700000000081().up(queryRunner as any);

    expect(query).not.toHaveBeenCalled();
  });
});
