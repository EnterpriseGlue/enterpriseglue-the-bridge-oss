import { describe, expect, it, vi } from 'vitest';
import { AddProvisioningCredentialIdempotency1700000000113 } from '@enterpriseglue/shared/db/migrations/1700000000113-add-provisioning-credential-idempotency.js';

describe('provisioning credential idempotency migration', () => {
  it.each(['postgres', 'mysql', 'mssql', 'oracle', 'spanner'])(
    'adds and removes portable at-most-once state on %s',
    async (database) => {
      const columns = new Set<string>();
      const columnMetadata = new Map<string, { name: string; isNullable: boolean }>();
      const indices: Array<{ name: string; columnNames: string[]; isUnique: boolean }> = [];
      const credentials = [{ id: 'credential-1', directoryId: 'directory-1', issuanceIdempotencyIdentity: null as string | null }];
      const runner = {
        connection: {
          options: { type: database },
          getMetadata: vi.fn(() => ({ tablePath: 'main.identity_provisioning_credentials' })),
        },
        hasTable: vi.fn(async () => true),
        hasColumn: vi.fn(async (_table: string, column: string) => columns.has(column)),
        addColumn: vi.fn(async (_table: string, column: { name: string; isNullable: boolean }) => {
          columns.add(column.name);
          columnMetadata.set(column.name, { name: column.name, isNullable: column.isNullable });
        }),
        changeColumn: vi.fn(async (_table: string, name: string, column: { name: string; isNullable: boolean }) => {
          columnMetadata.set(name, { name: column.name, isNullable: column.isNullable });
        }),
        dropColumn: vi.fn(async (_table: string, column: string) => { columns.delete(column); columnMetadata.delete(column); }),
        getTable: vi.fn(async () => ({
          indices,
          columns: [...columnMetadata.values()],
          findColumnByName: (name: string) => columnMetadata.get(name),
        })),
        manager: {
          getRepository: vi.fn(() => ({
            find: vi.fn().mockImplementation(() => Promise.resolve(credentials)),
            update: vi.fn().mockImplementation((_where, changes) => { Object.assign(credentials[0], changes); }),
          })),
        },
        createIndex: vi.fn(async (_table: string, index: { name: string; columnNames: string[]; isUnique: boolean }) => { indices.push(index); }),
        dropIndex: vi.fn(async (_table: string, name: string) => { indices.splice(indices.findIndex((index) => index.name === name), 1); }),
      } as any;

      const migration = new AddProvisioningCredentialIdempotency1700000000113();
      await migration.up(runner);
      await migration.up(runner);

      expect([...columns]).toEqual(['issuance_idempotency_key', 'issuance_request_hash', 'issuance_idempotency_identity']);
      expect(columnMetadata.get('issuance_idempotency_identity')).toMatchObject({ isNullable: false });
      expect(credentials[0].issuanceIdempotencyIdentity).toMatch(/^[a-f0-9]{64}$/);
      expect(indices).toHaveLength(1);
      expect(indices[0]).toMatchObject({
        name: 'uq_identity_provisioning_credentials_idempotency',
        columnNames: ['issuance_idempotency_identity'],
        isUnique: true,
      });

      await migration.down(runner);
      expect(columns.size).toBe(0);
      expect(indices).toHaveLength(0);
    },
  );
});
