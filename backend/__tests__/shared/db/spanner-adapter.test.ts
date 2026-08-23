import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMetadataArgsStorage } from 'typeorm';
import { SpannerAdapter } from '@enterpriseglue/shared/db/adapters/SpannerAdapter.js';

vi.mock('@enterpriseglue/shared/config/index.js', () => ({
  shouldUseSecureCookies: () => false,
  config: {
    nodeEnv: 'test',
    spannerProjectId: 'local-project',
    spannerInstanceId: 'local-instance',
    spannerDatabaseId: 'local-database',
  },
}));

describe('SpannerAdapter metadata normalization', () => {
  let columnSnapshots: Array<{
    column: any;
    type: any;
    length: any;
  }> = [];
  let tableSnapshots: Array<{
    table: any;
    schema: any;
  }> = [];
  let indexSnapshots: Array<{
    index: any;
    nullFiltered: any;
  }> = [];

  beforeEach(() => {
    const metadata = getMetadataArgsStorage();
    columnSnapshots = metadata.columns.map((column) => ({
      column,
      type: column.options.type,
      length: column.options.length,
    }));
    tableSnapshots = metadata.tables.map((table) => ({ table, schema: table.schema }));
    indexSnapshots = metadata.indices.map((index) => ({
      index,
      nullFiltered: index.nullFiltered,
    }));
  });

  afterEach(() => {
    for (const snapshot of columnSnapshots) {
      snapshot.column.options.type = snapshot.type;
      snapshot.column.options.length = snapshot.length;
    }
    for (const snapshot of tableSnapshots) {
      snapshot.table.schema = snapshot.schema;
    }
    for (const snapshot of indexSnapshots) {
      snapshot.index.nullFiltered = snapshot.nullFiltered;
    }
  });

  it('removes relational schemas and maps shared types to Spanner types', () => {
    new SpannerAdapter();

    const metadata = getMetadataArgsStorage();
    const usersTable = metadata.tables.find((table) => table.name === 'users');
    const idColumn = metadata.columns.find(
      (column) => (column.target as any)?.name === 'AppBaseEntity'
        && column.propertyName === 'id',
    );
    const descriptionColumn = metadata.columns.find(
      (column) => (column.target as any)?.name === 'AuthzGroup'
        && column.propertyName === 'description',
    );
    const activeColumn = metadata.columns.find(
      (column) => (column.target as any)?.name === 'RuntimeResource'
        && column.propertyName === 'isActive',
    );
    const observedAtColumn = metadata.columns.find(
      (column) => (column.target as any)?.name === 'RuntimeResource'
        && column.propertyName === 'observedAt',
    );
    const versionColumn = metadata.columns.find(
      (column) => (column.target as any)?.name === 'RuntimeResource'
        && column.propertyName === 'tenantMappingVersion',
    );

    expect(usersTable?.schema).toBeUndefined();
    expect(idColumn?.options).toMatchObject({ type: 'string', length: 191 });
    expect(descriptionColumn?.options).toMatchObject({ type: 'string', length: 'max' });
    expect(activeColumn?.options.type).toBe('bool');
    expect(observedAtColumn?.options.type).toBe('int64');
    expect(versionColumn?.options.type).toBe('int64');
  });

  it('null-filters unique indexes over nullable natural keys', () => {
    new SpannerAdapter();

    const configKeyIndex = getMetadataArgsStorage().indices.find(
      (index) => (index.target as any)?.name === 'Engine'
        && index.name === 'uq_engines_config_key_identity',
    );
    expect(configKeyIndex?.unique).toBe(true);
    expect(configKeyIndex?.nullFiltered).toBe(true);
  });

  it('uses STRING(MAX) for bounded native-grant and backstop evidence', () => {
    new SpannerAdapter();
    const metadata = getMetadataArgsStorage();
    for (const entity of ['CamundaNativeGrantImportRun', 'EngineBackstopSyncRun']) {
      for (const propertyName of ['classificationsJson', 'encryptedDetailedSnapshot']) {
        const column = metadata.columns.find((candidate) => (candidate.target as any)?.name === entity
          && candidate.propertyName === propertyName);
        expect(column?.options).toMatchObject({ type: 'string', length: 'max' });
      }
    }
  });
});
