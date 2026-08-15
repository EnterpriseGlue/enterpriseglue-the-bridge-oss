import { describe, expect, it, vi } from 'vitest';
import { AddFederatedSessionLineage1700000000112 } from '@enterpriseglue/shared/db/migrations/1700000000112-add-federated-session-lineage.js';

describe('federated session lineage migration', () => {
  it.each(['postgres', 'mysql', 'mssql', 'oracle', 'spanner'])(
    'adds and removes portable provider logout columns and indexes on %s',
    async (database) => {
      const columns = new Set(['id', 'identity_provider_id', 'revoked_at']);
      const indices: Array<{ name: string }> = [];
      const addColumn = vi.fn(async (_table: string, column: { name: string }) => { columns.add(column.name); });
      const dropColumn = vi.fn(async (_table: string, name: string) => { columns.delete(name); });
      const createIndex = vi.fn(async (_table: string, index: { name: string }) => { indices.push(index); });
      const dropIndex = vi.fn(async (_table: string, name: string) => {
        const position = indices.findIndex((index) => index.name === name);
        if (position >= 0) indices.splice(position, 1);
      });
      const runner = {
        connection: { options: { type: database }, getMetadata: vi.fn(() => ({ tablePath: 'main.refresh_tokens' })) },
        hasTable: vi.fn(async () => true),
        hasColumn: vi.fn(async (_table: string, name: string) => columns.has(name)),
        getTable: vi.fn(async () => ({ indices: [...indices] })),
        addColumn, dropColumn, createIndex, dropIndex,
      } as any;

      const migration = new AddFederatedSessionLineage1700000000112();
      await migration.up(runner);
      await migration.up(runner);

      expect([...columns]).toEqual(expect.arrayContaining(['provider_subject_id', 'provider_session_id', 'provider_name_id_format']));
      expect(indices.map((index) => index.name)).toEqual(['idx_refresh_tokens_provider_subject', 'idx_refresh_tokens_provider_session']);
      expect(addColumn).toHaveBeenCalledTimes(3);
      expect(createIndex).toHaveBeenCalledTimes(2);

      await migration.down(runner);
      expect([...columns]).not.toEqual(expect.arrayContaining(['provider_subject_id', 'provider_session_id', 'provider_name_id_format']));
      expect(indices).toHaveLength(0);
    },
  );
});
