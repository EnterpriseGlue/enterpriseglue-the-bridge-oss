import { describe, it, expect, vi } from 'vitest';
import { AddGitLockSessionState1700000000014 } from '../../../../../packages/shared/src/db/migrations/1700000000014-add-git-lock-session-state.js';

type CapturedQuery = { sql: string };

function createQueryRunner(options: {
  tablePath: string;
  dialect: 'oracle' | 'postgres' | 'mysql' | 'mssql';
  existingColumns?: string[];
}) {
  const queries: CapturedQuery[] = [];
  const existingColumns = new Set(options.existingColumns ?? []);

  const quoteFns: Record<typeof options.dialect, (name: string) => string> = {
    oracle: (name) => `"${name}"`,
    postgres: (name) => `"${name}"`,
    mysql: (name) => `\`${name}\``,
    mssql: (name) => `[${name}]`,
  };

  const runner = {
    connection: {
      getMetadata: (_entity: string) => ({ tablePath: options.tablePath }),
      driver: {
        escape: quoteFns[options.dialect],
      },
    },
    hasTable: vi.fn().mockResolvedValue(true),
    hasColumn: vi.fn(async (_table: string, column: string) => existingColumns.has(column)),
    addColumn: vi.fn(async (_table: string, column: { name: string }) => {
      existingColumns.add(column.name);
    }),
    query: vi.fn(async (sql: string) => {
      queries.push({ sql });
      return [];
    }),
  };

  return { runner, queries };
}

describe('AddGitLockSessionState1700000000014', () => {
  it('returns early when the git_locks table does not exist', async () => {
    const { runner, queries } = createQueryRunner({
      tablePath: 'ENTERPRISEGLUE.git_locks',
      dialect: 'oracle',
    });
    runner.hasTable.mockResolvedValueOnce(false);

    const migration = new AddGitLockSessionState1700000000014();
    await migration.up(runner as any);

    expect(queries).toHaveLength(0);
    expect(runner.addColumn).not.toHaveBeenCalled();
  });

  it('adds the session-state columns when they are missing', async () => {
    const { runner } = createQueryRunner({
      tablePath: 'ENTERPRISEGLUE.git_locks',
      dialect: 'oracle',
      existingColumns: [],
    });

    const migration = new AddGitLockSessionState1700000000014();
    await migration.up(runner as any);

    const added = runner.addColumn.mock.calls.map((call) => (call[1] as { name: string }).name);
    expect(added).toEqual(['last_interaction_at', 'visibility_state', 'visibility_changed_at']);
  });

  it('skips addColumn when synchronize already created the columns', async () => {
    const { runner } = createQueryRunner({
      tablePath: 'ENTERPRISEGLUE.git_locks',
      dialect: 'oracle',
      existingColumns: ['last_interaction_at', 'visibility_state', 'visibility_changed_at'],
    });

    const migration = new AddGitLockSessionState1700000000014();
    await migration.up(runner as any);

    expect(runner.addColumn).not.toHaveBeenCalled();
  });

  it('quotes schema-qualified tablePath segments on Oracle', async () => {
    const { runner, queries } = createQueryRunner({
      tablePath: 'ENTERPRISEGLUE.git_locks',
      dialect: 'oracle',
      existingColumns: ['last_interaction_at', 'visibility_state', 'visibility_changed_at'],
    });

    const migration = new AddGitLockSessionState1700000000014();
    await migration.up(runner as any);

    expect(queries).toHaveLength(3);
    for (const { sql } of queries) {
      expect(sql).toContain('UPDATE "ENTERPRISEGLUE"."git_locks"');
      expect(sql).not.toContain('UPDATE ENTERPRISEGLUE.git_locks');
    }
  });

  it('quotes all referenced column identifiers on Oracle', async () => {
    const { runner, queries } = createQueryRunner({
      tablePath: 'ENTERPRISEGLUE.git_locks',
      dialect: 'oracle',
      existingColumns: ['last_interaction_at', 'visibility_state', 'visibility_changed_at'],
    });

    const migration = new AddGitLockSessionState1700000000014();
    await migration.up(runner as any);

    const combined = queries.map((entry) => entry.sql).join('\n');
    for (const column of [
      'last_interaction_at',
      'visibility_state',
      'visibility_changed_at',
      'heartbeat_at',
      'acquired_at',
    ]) {
      expect(combined).toContain(`"${column}"`);
    }
    expect(combined).not.toMatch(/SET last_interaction_at\b/);
    expect(combined).not.toMatch(/COALESCE\(last_interaction_at\b/);
    expect(combined).not.toMatch(/\bheartbeat_at\b(?!")/);
  });

  it('quotes identifiers with unquoted tablePath (Postgres, no schema prefix)', async () => {
    const { runner, queries } = createQueryRunner({
      tablePath: 'git_locks',
      dialect: 'postgres',
      existingColumns: ['last_interaction_at', 'visibility_state', 'visibility_changed_at'],
    });

    const migration = new AddGitLockSessionState1700000000014();
    await migration.up(runner as any);

    for (const { sql } of queries) {
      expect(sql).toContain('UPDATE "git_locks"');
    }
  });

  it('uses backticks on MySQL', async () => {
    const { runner, queries } = createQueryRunner({
      tablePath: 'git_locks',
      dialect: 'mysql',
      existingColumns: ['last_interaction_at', 'visibility_state', 'visibility_changed_at'],
    });

    const migration = new AddGitLockSessionState1700000000014();
    await migration.up(runner as any);

    for (const { sql } of queries) {
      expect(sql).toContain('UPDATE `git_locks`');
    }
    const combined = queries.map((entry) => entry.sql).join('\n');
    expect(combined).toContain('`last_interaction_at`');
    expect(combined).toContain('`visibility_state`');
    expect(combined).toContain('`visibility_changed_at`');
    expect(combined).toContain('`heartbeat_at`');
    expect(combined).toContain('`acquired_at`');
  });
});
