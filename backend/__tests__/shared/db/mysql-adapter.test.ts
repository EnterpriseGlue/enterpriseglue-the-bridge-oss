import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMetadataArgsStorage } from 'typeorm';
import { MySQLAdapter } from '@enterpriseglue/shared/infrastructure/persistence/adapters/MySQLAdapter.js';

vi.mock('@enterpriseglue/shared/config/index.js', () => ({
  shouldUseSecureCookies: () => false,
  config: {
    nodeEnv: 'test', mysqlHost: 'db', mysqlPort: 3306, mysqlUser: 'user', mysqlPassword: 'password', mysqlDatabase: 'enterpriseglue',
  },
}));

describe('MySQLAdapter native-grant evidence mapping', () => {
  const snapshots: Array<{ column: any; type: any; length: any }> = [];

  beforeEach(() => {
    snapshots.splice(0, snapshots.length, ...getMetadataArgsStorage().columns.map((column) => ({
      column, type: column.options.type, length: column.options.length,
    })));
  });

  afterEach(() => {
    for (const snapshot of snapshots) {
      snapshot.column.options.type = snapshot.type;
      snapshot.column.options.length = snapshot.length;
    }
  });

  it('uses LONGTEXT for bounded native-grant and backstop evidence instead of the 64 KiB TEXT limit', () => {
    new MySQLAdapter();
    const metadata = getMetadataArgsStorage();
    for (const entity of ['CamundaNativeGrantImportRun', 'EngineBackstopSyncRun']) {
      for (const propertyName of ['classificationsJson', 'encryptedDetailedSnapshot']) {
        const column = metadata.columns.find((candidate) => (candidate.target as any)?.name === entity
          && candidate.propertyName === propertyName);
        expect(column?.options.type).toBe('longtext');
      }
    }
  });

  it('keeps the EngineHealth BIGINT timestamp transformer active', () => {
    new MySQLAdapter();

    const checkedAtColumn = getMetadataArgsStorage().columns.find(
      (column: any) => column.target?.name === 'EngineHealth' && column.propertyName === 'checkedAt',
    );
    const transformer = Array.isArray(checkedAtColumn?.options.transformer)
      ? checkedAtColumn?.options.transformer[0]
      : checkedAtColumn?.options.transformer;

    expect(checkedAtColumn?.options.type).toBe('bigint');
    expect(transformer?.from('1700000000000')).toBe(1700000000000);
  });
});
