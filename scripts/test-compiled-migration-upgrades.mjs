import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Run only against a container created here, on a random loopback port. Both
// module trees deliberately exist, as they do in development/production images.
const root = process.cwd();
const name = `eg-compiled-upgrade-${randomUUID()}`;
const image = JSON.parse(readFileSync('test/database/engine-tenancy-database-matrix-contract.json')).databases.postgres.image;
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 120000 }).trim();
const requireBackend = createRequire(path.join(root, 'backend/package.json'));
const { DataSource } = requireBackend('typeorm');
const compiledRoot = path.join(root, 'backend/dist/packages/shared/src');
let dataSource;
let started = false;
try {
  docker('run', '--detach', '--rm', '--name', name, '-p', '127.0.0.1::5432',
    '-e', 'POSTGRES_USER=upgrade', '-e', 'POSTGRES_PASSWORD=upgrade-test', '-e', 'POSTGRES_DB=upgrade', image);
  started = true;
  const port = docker('port', name, '5432/tcp').split(':').at(-1);
  for (let attempt = 0; ; attempt += 1) {
    try { docker('exec', name, 'pg_isready', '-U', 'upgrade'); break; }
    catch (error) {
      if (attempt >= 30) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  Object.assign(process.env, {
    NODE_ENV: 'production', DATABASE_TYPE: 'postgres', POSTGRES_HOST: '127.0.0.1', POSTGRES_PORT: port,
    POSTGRES_USER: 'upgrade', POSTGRES_PASSWORD: 'upgrade-test', POSTGRES_DATABASE: 'upgrade', POSTGRES_SCHEMA: 'main',
    EG_TENANCY_MODE: 'single', POSTGRES_SSL: 'false',
  });
  delete process.env.POSTGRES_URL;
  const { PostgresAdapter } = await import(pathToFileURL(path.join(compiledRoot, 'infrastructure/persistence/adapters/PostgresAdapter.js')));
  for (const AdapterName of ['PostgresAdapter', 'MySQLAdapter', 'OracleAdapter', 'SqlServerAdapter', 'SpannerAdapter']) {
    for (const tree of [compiledRoot, path.join(root, 'packages/shared/dist')]) {
      const module = await import(pathToFileURL(path.join(tree, `infrastructure/persistence/adapters/${AdapterName}.js`)));
      assert.equal(new module[AdapterName]().getMigrationsPath(), path.join(tree, 'db/migrations'));
    }
  }
  console.log('PASS all five compiled backend and published-package adapters select colocated migrations');
  const adapter = new PostgresAdapter();
  assert.equal(adapter.getMigrationsPath(), path.join(compiledRoot, 'db/migrations'));
  // The separate shared build must not supply constructor-based migrations.
  const sharedTenant = await import(pathToFileURL(path.join(root, 'packages/shared/dist/infrastructure/persistence/entities/Tenant.js')));
  const backendTenant = await import(pathToFileURL(path.join(compiledRoot, 'infrastructure/persistence/entities/Tenant.js')));
  assert.notEqual(sharedTenant.Tenant, backendTenant.Tenant);
  dataSource = new DataSource({ ...adapter.getDataSourceOptions(), logging: false, subscribers: [] });
  await dataSource.initialize();
  assert.ok(dataSource.migrations.length >= 135, 'compiled migration discovery must retain the full inventory');
  const credentialMigration = dataSource.migrations.find(migration => migration.name.endsWith('1700000000113'));
  const tenancyMigration = dataSource.migrations.find(migration => migration.name.endsWith('1700000000124'));
  assert.ok(credentialMigration && tenancyMigration);
  assert.equal(dataSource.getMetadata(backendTenant.Tenant).target, backendTenant.Tenant);
  assert.throws(() => dataSource.getMetadata(sharedTenant.Tenant), /No metadata/);
  const allMigrations = dataSource.migrations;
  for (const baseline of ['pre-0113', 'pre-0124']) {
    await dataSource.query('DROP SCHEMA IF EXISTS main CASCADE');
    await dataSource.query('CREATE SCHEMA main');
    // Minimal historical tables: the migration adds the idempotency columns
    // and backfills an existing credential, rather than stamping a fresh ledger.
    await dataSource.query('CREATE TABLE main.identity_provisioning_credentials (id text PRIMARY KEY, directory_id text NOT NULL)');
    await dataSource.query("INSERT INTO main.identity_provisioning_credentials VALUES ('retained-credential', 'retained-directory')");
    await dataSource.query('CREATE TABLE main.refresh_tokens (id text PRIMARY KEY, user_id text, revoked_at bigint)');
    await dataSource.query('CREATE TABLE main.invitations (id text PRIMARY KEY, status text)');
    if (baseline === 'pre-0124') {
      const runner = dataSource.createQueryRunner();
      try { await credentialMigration.up(runner); } finally { await runner.release(); }
    }
    dataSource.migrations = baseline === 'pre-0113' ? [credentialMigration, tenancyMigration] : [tenancyMigration];
    const applied = await dataSource.runMigrations({ transaction: 'all' });
    assert.equal(applied.length, baseline === 'pre-0113' ? 2 : 1);
    assert.equal((await dataSource.query('SELECT id FROM main.tenants')).length, 0);
    const [credential] = await dataSource.query('SELECT id, issuance_idempotency_identity FROM main.identity_provisioning_credentials');
    assert.equal(credential.id, 'retained-credential');
    assert.match(credential.issuance_idempotency_identity, /^[a-f0-9]{64}$/);
    assert.equal((await dataSource.runMigrations()).length, 0, 'upgrade is idempotent');
    console.log(`PASS compiled PostgreSQL upgrade ${baseline}: historical rows retained, migrations applied and repeat is a no-op`);
  }
  dataSource.migrations = allMigrations;
} finally {
  if (dataSource?.isInitialized) await dataSource.destroy();
  if (started) docker('rm', '--force', '--volumes', name);
}
