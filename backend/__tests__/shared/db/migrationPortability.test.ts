import { describe, expect, it, vi } from 'vitest';
import { TableColumn } from 'typeorm';
import {
  addRequiredColumnWithBackfill,
  portableBigint,
  portableBoolean,
  portableBooleanDefault,
  portableInteger,
  portableNumberDefault,
  portableStringDefault,
  portableText,
  sqlBooleanLiteral,
} from '@enterpriseglue/shared/db/migrations/support/portable-columns.js';
import { UpgradeLegacySamlSignatures1700000000065 } from '@enterpriseglue/shared/db/migrations/1700000000065-upgrade-legacy-saml-signatures.js';

function runner(database: string) {
  return {
    connection: {
      options: { type: database },
      driver: {
        escape: (value: string) => `\`${value}\``,
        createFullType: (column: TableColumn) => column.length
          ? `${column.type}(${column.length})`
          : column.type,
      },
    },
  } as any;
}

describe('portable migration columns', () => {
  it.each([
    ['postgres', { type: 'text' }, { type: 'boolean' }, { type: 'integer' }, { type: 'bigint' }],
    ['mysql', { type: 'varchar', length: '4000' }, { type: 'boolean' }, { type: 'integer' }, { type: 'bigint' }],
    ['mssql', { type: 'nvarchar', length: '4000' }, { type: 'bit' }, { type: 'integer' }, { type: 'bigint' }],
    ['oracle', { type: 'varchar2', length: '4000' }, { type: 'number', precision: 1, scale: 0 }, { type: 'number', precision: 10, scale: 0 }, { type: 'number', precision: 19, scale: 0 }],
    ['spanner', { type: 'string', length: '4096' }, { type: 'bool' }, { type: 'int64' }, { type: 'int64' }],
  ])('maps TypeORM migration columns for %s', (database, text, boolean, integer, bigint) => {
    const queryRunner = runner(database as string);
    expect(portableText(queryRunner)).toEqual(text);
    expect(portableBoolean(queryRunner)).toEqual(boolean);
    expect(portableInteger(queryRunner)).toEqual(integer);
    expect(portableBigint(queryRunner)).toEqual(bigint);
  });

  it('omits unsupported Spanner defaults and emits adapter-safe boolean literals', () => {
    const spanner = runner('spanner');
    expect(portableStringDefault(spanner, 'manual')).toBeUndefined();
    expect(portableBooleanDefault(spanner, false)).toBeUndefined();
    expect(portableNumberDefault(spanner, 0)).toBeUndefined();
    expect(sqlBooleanLiteral(spanner, false)).toBe('FALSE');

    expect(portableStringDefault(runner('mysql'), 'manual')).toBe("'manual'");
    expect(portableBooleanDefault(runner('mssql'), false)).toBe(0);
    expect(sqlBooleanLiteral(runner('oracle'), true)).toBe('1');
    expect(sqlBooleanLiteral(runner('postgres'), false)).toBe('FALSE');
  });

  it('uses a nullable-add/backfill/required sequence for Spanner upgrades', async () => {
    let storedColumn: TableColumn | undefined;
    const query = vi.fn(async () => undefined);
    const updateDDL = vi.fn(async () => undefined);
    const queryRunner = {
      ...runner('spanner'),
      hasColumn: vi.fn(async () => Boolean(storedColumn)),
      addColumn: vi.fn(async (_table: string, column: TableColumn) => {
        storedColumn = column.clone();
      }),
      getTable: vi.fn(async () => ({ columns: storedColumn ? [storedColumn.clone()] : [] })),
      query,
      updateDDL,
    } as any;

    await addRequiredColumnWithBackfill(
      queryRunner,
      'platform_settings',
      new TableColumn({ name: 'mode', type: 'string', length: '4096' }),
      "'manual'",
    );

    expect(queryRunner.addColumn).toHaveBeenCalledWith(
      'platform_settings',
      expect.objectContaining({ name: 'mode', isNullable: true, default: undefined }),
    );
    expect(query).toHaveBeenCalledWith(
      "UPDATE `platform_settings` SET `mode` = 'manual' WHERE `mode` IS NULL",
    );
    expect(updateDDL).toHaveBeenCalledWith(
      'ALTER TABLE `platform_settings` ALTER COLUMN `mode` string(4096) NOT NULL',
    );
  });
});

describe('portable data migrations', () => {
  it.each([
    ['postgres', 'tenant_auth.sso_providers', '"tenant_auth"."sso_providers"'],
    ['mysql', 'tenant_auth.sso_providers', '`tenant_auth`.`sso_providers`'],
    ['mssql', 'tenant_auth.sso_providers', '[tenant_auth].[sso_providers]'],
    ['oracle', 'TENANT_AUTH.SSO_PROVIDERS', '"TENANT_AUTH"."SSO_PROVIDERS"'],
  ])('targets the resolved %s schema-qualified table', async (database, resolvedName, escapedName) => {
    const escape = (value: string): string => {
      if (database === 'mysql') return `\`${value}\``;
      if (database === 'mssql') return `[${value}]`;
      return `"${value}"`;
    };
    const query = vi.fn(async () => undefined);
    const queryRunner = {
      connection: {
        getMetadata: vi.fn(() => { throw new Error('legacy table is not entity-backed'); }),
        driver: { escape },
      },
      getTable: vi.fn(async () => ({
        name: resolvedName,
        findColumnByName: (name: string) => name === 'signature_algorithm' ? { name } : undefined,
      })),
      query,
    } as any;

    await new UpgradeLegacySamlSignatures1700000000065().up(queryRunner);

    expect(queryRunner.getTable).toHaveBeenCalledWith('sso_providers');
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]?.[0]).toContain(`UPDATE ${escapedName}`);
  });

  it('is a no-op when the legacy table or signature column is absent', async () => {
    const query = vi.fn(async () => undefined);
    const queryRunner = {
      connection: {
        getMetadata: vi.fn(() => { throw new Error('legacy table is not entity-backed'); }),
        driver: { escape: (value: string) => `"${value}"` },
      },
      getTable: vi.fn(async () => undefined),
      query,
    } as any;

    await new UpgradeLegacySamlSignatures1700000000065().up(queryRunner);

    expect(query).not.toHaveBeenCalled();
  });
});
