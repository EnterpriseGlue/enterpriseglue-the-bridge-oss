import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataSource, QueryRunner } from 'typeorm';
import {
  grantSchemaEpochCloudPasskeyRuntimePrivileges,
  verifySchemaEpochCloudPasskeyRuntimePrivileges,
} from '@enterpriseglue/shared/db/schema-epoch-cloud-passkey-grant.js';
import {
  applySchemaEpochRuntimeTablePrivileges,
  inspectSchemaEpochRuntimeRole,
  readSchemaEpochRuntimeDirectTablePrivileges,
  readSchemaEpochRuntimeEffectiveTablePrivileges,
  readSchemaEpochRuntimeTableColumns,
} from '@enterpriseglue/shared/db/postgres-runtime-grants.js';

vi.mock('@enterpriseglue/shared/db/postgres-runtime-grants.js', () => ({
  applySchemaEpochRuntimeTablePrivileges: vi.fn().mockResolvedValue(undefined),
  inspectSchemaEpochRuntimeRole: vi.fn(),
  readSchemaEpochRuntimeDirectTablePrivileges: vi.fn(),
  readSchemaEpochRuntimeEffectiveTablePrivileges: vi.fn(),
  readSchemaEpochRuntimeTableColumns: vi.fn(),
}));

const tableColumns: Record<string, string[]> = {
  cloud_email_signups: ['id', 'email', 'email_hash', 'token_hash', 'expires_at', 'challenge', 'challenge_expires_at', 'created_at', 'updated_at'],
  cloud_passkeys: ['id', 'user_id', 'credential_id', 'credential_id_hash', 'public_key', 'counter', 'transports_json', 'created_at', 'last_used_at', 'revoked_at'],
  cloud_passkey_challenges: ['id', 'token_hash', 'challenge', 'expires_at', 'created_at'],
};
const grants: Record<string, string[]> = {
  cloud_email_signups: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
  cloud_passkeys: ['INSERT', 'SELECT', 'UPDATE'],
  cloud_passkey_challenges: ['DELETE', 'INSERT', 'SELECT'],
};
const appliedGrants: Record<string, string[]> = {
  cloud_email_signups: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  cloud_passkeys: ['SELECT', 'INSERT', 'UPDATE'],
  cloud_passkey_challenges: ['SELECT', 'INSERT', 'DELETE'],
};

function fixture() {
  const dataSource = {
    options: { schema: 'public' },
    getMetadata: vi.fn((entityName: string) => {
      const tableName = ({
        CloudEmailSignup: 'cloud_email_signups',
        CloudPasskey: 'cloud_passkeys',
        CloudPasskeyChallenge: 'cloud_passkey_challenges',
      } as Record<string, string>)[entityName];
      const tablePath = `public.${tableName}`;
      return {
        schema: 'public', tableName, tablePath,
        columns: tableColumns[tableName].map((databaseName) => ({ databaseName })),
      };
    }),
  } as unknown as DataSource;
  const runner = {
    connection: { options: { type: 'postgres' } },
  } as unknown as QueryRunner;
  return { dataSource, runner };
}

describe('signed Cloud passkey runtime grants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(inspectSchemaEpochRuntimeRole).mockResolvedValue([{ safe: true, schema_usage: true }]);
    vi.mocked(readSchemaEpochRuntimeTableColumns).mockImplementation(async (_runner, _schema, table) =>
      tableColumns[table].map((name) => ({ name })));
    vi.mocked(readSchemaEpochRuntimeDirectTablePrivileges).mockImplementation(async (_runner, _role, _schema, table) =>
      grants[table].map((privilege_type) => ({ privilege_type })));
    vi.mocked(readSchemaEpochRuntimeEffectiveTablePrivileges).mockImplementation(async (_runner, _role, _schema, table) => [{
      select_ok: grants[table].includes('SELECT'),
      insert_ok: grants[table].includes('INSERT'),
      update_ok: grants[table].includes('UPDATE'),
      delete_ok: grants[table].includes('DELETE'),
      truncate_ok: false, references_ok: false, trigger_ok: false,
      public_grant: false, column_grant: false,
    }]);
  });

  it('grants and verifies only the table-specific DML', async () => {
    const { dataSource, runner } = fixture();
    await grantSchemaEpochCloudPasskeyRuntimePrivileges(dataSource, runner, 'eg_runtime');
    expect(applySchemaEpochRuntimeTablePrivileges).toHaveBeenCalledTimes(3);
    for (const [tableName, privileges] of Object.entries(appliedGrants)) {
      expect(applySchemaEpochRuntimeTablePrivileges).toHaveBeenCalledWith(
        runner, 'public', tableName, 'eg_runtime', privileges,
      );
    }
    expect(readSchemaEpochRuntimeEffectiveTablePrivileges).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['unsafe role', () => vi.mocked(inspectSchemaEpochRuntimeRole).mockResolvedValue([{ safe: false, schema_usage: true }])],
    ['missing schema usage', () => vi.mocked(inspectSchemaEpochRuntimeRole).mockResolvedValue([{ safe: true, schema_usage: false }])],
  ])('rejects %s before applying grants', async (_name, arrange) => {
    arrange();
    const { dataSource, runner } = fixture();
    await expect(grantSchemaEpochCloudPasskeyRuntimePrivileges(dataSource, runner, 'eg_runtime'))
      .rejects.toThrow(/restricted, nonowning/);
    expect(applySchemaEpochRuntimeTablePrivileges).not.toHaveBeenCalled();
  });

  it('rejects a mismatched signed table shape before applying grants', async () => {
    const { dataSource, runner } = fixture();
    vi.mocked(readSchemaEpochRuntimeTableColumns).mockResolvedValueOnce([]);
    await expect(grantSchemaEpochCloudPasskeyRuntimePrivileges(dataSource, runner, 'eg_runtime'))
      .rejects.toThrow(/differs from the signed entity columns/);
    expect(applySchemaEpochRuntimeTablePrivileges).not.toHaveBeenCalled();
  });

  it.each(['DELETE', 'TRUNCATE', 'PUBLIC'])('rejects an excess %s privilege during read-only preflight', async (kind) => {
    const { dataSource, runner } = fixture();
    if (kind === 'DELETE') {
      vi.mocked(readSchemaEpochRuntimeDirectTablePrivileges).mockImplementation(async (_runner, _role, _schema, table) =>
        [...grants[table], ...(table === 'cloud_passkeys' ? ['DELETE'] : [])].sort().map((privilege_type) => ({ privilege_type })));
    } else {
      vi.mocked(readSchemaEpochRuntimeEffectiveTablePrivileges).mockImplementation(async (_runner, _role, _schema, table) => [{
        select_ok: true, insert_ok: true, update_ok: table !== 'cloud_passkey_challenges',
        delete_ok: table !== 'cloud_passkeys', truncate_ok: kind === 'TRUNCATE',
        references_ok: false, trigger_ok: false, public_grant: kind === 'PUBLIC', column_grant: false,
      }]);
    }
    await expect(verifySchemaEpochCloudPasskeyRuntimePrivileges(dataSource, runner, 'eg_runtime'))
      .rejects.toThrow(/incorrect direct|unexpected effective/);
    expect(applySchemaEpochRuntimeTablePrivileges).not.toHaveBeenCalled();
  });
});
