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

  it('uses LONGTEXT for bounded native-grant evidence instead of the 64 KiB TEXT limit', () => {
    new MySQLAdapter();
    const metadata = getMetadataArgsStorage();
    for (const propertyName of ['classificationsJson', 'encryptedDetailedSnapshot']) {
      const column = metadata.columns.find((candidate) => (candidate.target as any)?.name === 'CamundaNativeGrantImportRun'
        && candidate.propertyName === propertyName);
      expect(column?.options.type).toBe('longtext');
    }
  });
});
