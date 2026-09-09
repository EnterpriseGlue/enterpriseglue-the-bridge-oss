import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  assertSchemaEpochInvocation,
  bindDataSourceToSchemaEpoch,
  canonicalMigrationInventory,
  isSchemaEpochManifestApplicable,
  loadBundledSchemaEpochManifest,
  migrationInventorySha256,
  parseSchemaEpochManifest,
  resolveAcceptedDatabaseEpoch,
  resolveOwnerMigrationStartingEpoch,
} from '@enterpriseglue/shared/db/schema-epoch.js';
import {
  legacyPostgresTenantPolicyMatches,
  normalizeLegacyPostgresTenantPolicyExpression,
  verifyPostgresTenantRlsForPolicyProfile,
} from '@enterpriseglue/shared/db/postgres-tenant-rls.js';
import {
  RELEASE_EFFECT_INVENTORY_VERSION,
  RELEASE_EFFECT_SOURCES_V1,
} from '@enterpriseglue/shared/contracts/release-effect-inventory.js';

function registeredMigrations() {
  const directory = path.resolve(process.cwd(), '../packages/shared/src/db/migrations');
  return readdirSync(directory)
    .filter((file) => /^\d.*\.ts$/.test(file))
    .flatMap((file) => {
      const source = readFileSync(path.join(directory, file), 'utf8');
      return [...source.matchAll(/export class\s+([A-Za-z0-9_]+)\s+implements\s+MigrationInterface/g)]
        .map((match) => ({ name: match[1] }));
    });
}

describe('immutable schema-epoch compatibility bridge', () => {
  it('binds the executable inventory before enforcement while retaining two exact accepted epochs', () => {
    const manifest = loadBundledSchemaEpochManifest();
    const migrations = registeredMigrations();
    const dataSource = { migrations } as any;

    expect(manifest.executableMigrationInventory.through).toBe(1700000000131);
    expect(manifest.upgradeContract.minimumDatabaseEpoch).toEqual(manifest.roles.ownerMigration.from);
    expect(manifest.upgradeContract.freshDatabase).toBe('requires-separate-signed-bootstrap');
    expect(manifest.upgradeContract.emptyMigrationLedger).toBe('requires-separate-signed-recovery');
    expect(manifest.executableImplementationInventory).toMatchObject({
      algorithm: 'sha256-source-v1',
      purpose: 'owner-transition-1700000000131-closure/v1',
      count: 12,
    });
    expect(manifest.releaseEffectInventory).toEqual({
      version: RELEASE_EFFECT_INVENTORY_VERSION,
      sha256: createHash('sha256').update(JSON.stringify({
        version: RELEASE_EFFECT_INVENTORY_VERSION,
        sources: RELEASE_EFFECT_SOURCES_V1,
      }), 'utf8').digest('hex'),
    });
    expect(manifest.acceptedDatabaseEpochs.map((epoch) => epoch.through)).toEqual([
      1700000000131,
      1700000000132,
    ]);
    bindDataSourceToSchemaEpoch(dataSource, manifest);

    const executable = canonicalMigrationInventory(dataSource.migrations);
    expect(executable).toHaveLength(133);
    expect(executable.at(-1)?.timestamp).toBe(1700000000131);
    expect(migrationInventorySha256(executable)).toBe(manifest.executableMigrationInventory.sha256);
  });

  it('separates bounded owner apply from verify-only application startup', () => {
    const manifest = loadBundledSchemaEpochManifest();
    expect(() => assertSchemaEpochInvocation(manifest, 'application-startup', 'apply')).toThrow(
      /application startup only in verify mode/,
    );
    expect(() => assertSchemaEpochInvocation(manifest, 'application-startup', 'verify')).not.toThrow();
    expect(() => assertSchemaEpochInvocation(manifest, 'owner-migration', 'apply')).not.toThrow();
    expect(() => assertSchemaEpochInvocation(manifest, 'owner-migration', 'verify')).toThrow(
      /owner migration entrypoint only in bounded apply mode/,
    );
    expect(() => assertSchemaEpochInvocation(manifest, 'schema-epoch-preflight', 'verify')).not.toThrow();
    expect(() => assertSchemaEpochInvocation(manifest, 'schema-epoch-preflight', 'apply')).toThrow(
      /preflight only in verify mode/,
    );
  });

  it('leaves other databases and single-tenancy PostgreSQL on their ordinary migration contract', () => {
    const manifest = loadBundledSchemaEpochManifest();
    expect(isSchemaEpochManifestApplicable(manifest, {
      databaseType: 'postgres',
      tenancyMode: 'pooled',
    })).toBe(true);
    for (const databaseType of ['oracle', 'mysql', 'mssql', 'spanner']) {
      expect(isSchemaEpochManifestApplicable(manifest, {
        databaseType,
        tenancyMode: 'pooled',
      })).toBe(false);
    }
    expect(isSchemaEpochManifestApplicable(manifest, {
      databaseType: 'postgres',
      tenancyMode: 'single',
    })).toBe(false);
  });

  it('refuses a runtime inventory not signed by the manifest', () => {
    const manifest = loadBundledSchemaEpochManifest();

    const migrations = registeredMigrations();
    migrations[0] = { name: 'UnexpectedMigration1700000000000' };
    expect(() => bindDataSourceToSchemaEpoch({ migrations } as any, manifest)).toThrow(
      /differs from the immutable schema-epoch manifest/,
    );
  });

  it('accepts only the exact pre- and post-enforcement database ledgers', () => {
    const manifest = loadBundledSchemaEpochManifest();
    const all = canonicalMigrationInventory(registeredMigrations());
    expect(resolveAcceptedDatabaseEpoch(
      manifest,
      all.filter((migration) => migration.timestamp <= 1700000000131),
    )).toMatchObject({ id: 'pre-enforcement' });
    expect(resolveAcceptedDatabaseEpoch(manifest, all)).toMatchObject({ id: 'post-enforcement' });
    expect(() => resolveAcceptedDatabaseEpoch(manifest, all.slice(1))).toThrow(/not accepted/);
  });

  it('lets the owner start only from the exact predecessor or an already accepted epoch', () => {
    const manifest = loadBundledSchemaEpochManifest();
    const all = canonicalMigrationInventory(registeredMigrations());
    expect(resolveOwnerMigrationStartingEpoch(
      manifest,
      all.filter((migration) => migration.timestamp <= 1700000000130),
    )).toBe('owner-source');
    expect(resolveOwnerMigrationStartingEpoch(
      manifest,
      all.filter((migration) => migration.timestamp <= 1700000000131),
    )).toBe('pre-enforcement');
    expect(resolveOwnerMigrationStartingEpoch(manifest, all)).toBe('post-enforcement');
    expect(() => resolveOwnerMigrationStartingEpoch(manifest, [])).toThrow(
      /starting epoch is not accepted/,
    );
    expect(() => resolveOwnerMigrationStartingEpoch(manifest, all.slice(1))).toThrow(
      /starting epoch is not accepted/,
    );
  });

  it('rejects malformed or broadened manifest data', () => {
    const manifest = JSON.parse(readFileSync(
      path.resolve(process.cwd(), '../packages/shared/src/schema-epoch-manifest.json'),
      'utf8',
    ));
    manifest.acceptedDatabaseEpochs[1].through = 1700000000133;
    expect(() => parseSchemaEpochManifest(manifest)).toThrow(/bounded pre\/post enforcement bridge/);
  });

  it('recognizes only the exact legacy policy used before enforcement', async () => {
    const legacy = "((COALESCE(NULLIF(current_setting('enterpriseglue.tenancy_mode'::text, true), ''::text), 'single'::text) <> 'pooled'::text) OR (tenant_id = NULLIF(current_setting('enterpriseglue.tenant_id'::text, true), ''::text)))";
    const row = {
      policy_name: 'eg_tenant_isolation',
      command: 'ALL',
      permissive: 'PERMISSIVE',
      roles: ['public'],
      using_expression: legacy,
      check_expression: legacy,
    };
    expect(normalizeLegacyPostgresTenantPolicyExpression(legacy)).not.toContain('::text');
    expect(legacyPostgresTenantPolicyMatches(row)).toBe(true);
    expect(legacyPostgresTenantPolicyMatches({ ...row, check_expression: `${legacy} OR TRUE` })).toBe(false);

    const queryRunner = {
      connection: {
        options: { type: 'postgres', schema: 'main' },
        entityMetadatas: [{
          tableName: 'projects',
          tablePath: 'main.projects',
          schema: 'main',
          columns: [{ databaseName: 'tenant_id' }],
        }],
      },
      hasTable: vi.fn().mockResolvedValue(true),
      query: vi.fn().mockResolvedValue([{
        relrowsecurity: true,
        relforcerowsecurity: true,
        policies: [row],
      }]),
    } as any;
    await expect(
      verifyPostgresTenantRlsForPolicyProfile(queryRunner, 'legacy-explicit-runtime-compatible/v1'),
    ).resolves.toEqual({ expected: 1, enforced: 1 });
  });
});
