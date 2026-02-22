import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { runMigrations } from '../../../src/shared/db/run-migrations.js';
import { getDataSource, adapter } from '../../../src/shared/db/data-source.js';

vi.mock('../../../src/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
  adapter: {
    getDatabaseType: vi.fn().mockReturnValue('oracle'),
    getSchemaName: vi.fn().mockReturnValue('public'),
  },
}));

describe('runMigrations bootstrap behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (adapter.getSchemaName as unknown as Mock).mockReturnValue('public');
    (adapter.getDatabaseType as unknown as Mock).mockReturnValue('oracle');
  });

  it('runs synchronize when any core bootstrap table is missing', async () => {
    const queryRunner = {
      hasTable: vi.fn(async (tablePath: string) => tablePath !== 'main.sso_providers'),
      release: vi.fn().mockResolvedValue(undefined),
    };

    const dataSource = {
      createQueryRunner: vi.fn(() => queryRunner),
      getMetadata: vi.fn((entity: any) => {
        const byName: Record<string, string> = {
          User: 'main.users',
          SsoProvider: 'main.sso_providers',
          RefreshToken: 'main.refresh_tokens',
          EnvironmentTag: 'main.environment_tags',
          PlatformSettings: 'main.platform_settings',
          EmailTemplate: 'main.email_templates',
          SsoClaimsMapping: 'main.sso_claims_mappings',
          GitProvider: 'main.git_providers',
        };
        return { tablePath: byName[entity.name] ?? `main.${String(entity.name).toLowerCase()}` };
      }),
      synchronize: vi.fn().mockResolvedValue(undefined),
      showMigrations: vi.fn().mockResolvedValue(false),
      runMigrations: vi.fn().mockResolvedValue(undefined),
    };

    (getDataSource as unknown as Mock).mockResolvedValue(dataSource);

    await runMigrations();

    expect(dataSource.synchronize).toHaveBeenCalledTimes(1);
    expect(dataSource.runMigrations).not.toHaveBeenCalled();
    expect(queryRunner.release).toHaveBeenCalledTimes(1);
  });

  it('skips synchronize when all core bootstrap tables already exist', async () => {
    const queryRunner = {
      hasTable: vi.fn().mockResolvedValue(true),
      release: vi.fn().mockResolvedValue(undefined),
    };

    const dataSource = {
      createQueryRunner: vi.fn(() => queryRunner),
      getMetadata: vi.fn((entity: any) => ({ tablePath: `main.${String(entity.name).toLowerCase()}` })),
      synchronize: vi.fn().mockResolvedValue(undefined),
      showMigrations: vi.fn().mockResolvedValue(true),
      runMigrations: vi.fn().mockResolvedValue(undefined),
    };

    (getDataSource as unknown as Mock).mockResolvedValue(dataSource);

    await runMigrations();

    expect(dataSource.synchronize).not.toHaveBeenCalled();
    expect(dataSource.runMigrations).toHaveBeenCalledTimes(1);
    expect(queryRunner.release).toHaveBeenCalledTimes(1);
  });

  it('self-heals a partial bootstrap on first run and remains stable on second run', async () => {
    const queryRunner = {
      hasTable: vi
        .fn()
        // first run: first table missing triggers synchronize path
        .mockResolvedValueOnce(false)
        // first run remaining checks
        .mockResolvedValue(true),
      release: vi.fn().mockResolvedValue(undefined),
    };

    const dataSource = {
      createQueryRunner: vi.fn(() => queryRunner),
      getMetadata: vi.fn((entity: any) => ({ tablePath: `main.${String(entity.name).toLowerCase()}` })),
      synchronize: vi.fn().mockResolvedValue(undefined),
      showMigrations: vi.fn().mockResolvedValue(false),
      runMigrations: vi.fn().mockResolvedValue(undefined),
    };

    (getDataSource as unknown as Mock).mockResolvedValue(dataSource);

    await runMigrations();
    expect(dataSource.synchronize).toHaveBeenCalledTimes(1);

    // second run: everything exists
    queryRunner.hasTable.mockReset();
    queryRunner.hasTable.mockResolvedValue(true);
    dataSource.showMigrations.mockResolvedValue(true);

    await runMigrations();

    expect(dataSource.synchronize).toHaveBeenCalledTimes(1);
    expect(dataSource.runMigrations).toHaveBeenCalledTimes(1);
    expect(queryRunner.release).toHaveBeenCalledTimes(2);
  });
});
