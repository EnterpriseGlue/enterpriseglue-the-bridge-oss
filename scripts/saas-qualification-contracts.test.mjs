import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const recovery = readFileSync(new URL('./run-saas-upgrade-restore-rollback.sh', import.meta.url), 'utf8');
const pooled = readFileSync(new URL('./run-pooled-tenancy-e2e.sh', import.meta.url), 'utf8');
const pooledCompose = readFileSync(
  new URL('../infra/docker/compose/docker-compose.pooled-tenancy-e2e.yml', import.meta.url),
  'utf8',
);
const databaseInitialization = readFileSync(
  new URL('../packages/shared/src/db/run-migrations.ts', import.meta.url),
  'utf8',
);
const backendServer = readFileSync(
  new URL('../packages/backend-host/src/server.ts', import.meta.url),
  'utf8',
);

test('recovery rehearsal binds the published application and authoritative schema to v0.18.0', () => {
  assert.match(recovery, /backend:v0\.18\.0/);
  assert.match(recovery, /git -C "\$root_dir" archive v0\.18\.0/);
  assert.match(recovery, /baseline_digest=.*RepoDigests/);
  assert.match(recovery, /docker run[\s\S]*"\$baseline_digest"/);
  assert.doesNotMatch(recovery, /backend:latest/);
});

test('recovery rehearsal preserves segregated SSO and tenant plugin states', () => {
  for (const protocol of ["'oidc'", "'saml'", "'ldap'"]) assert.match(recovery, new RegExp(protocol));
  assert.match(recovery, /alpha-bravo-active,charlie-inactive/);
  assert.match(recovery, /\(id, tenant_id, key, protocol, is_enabled\) IN/);
  assert.match(recovery, /\(id, plugin_id, tenant_ref, enabled\) IN/);
  assert.match(recovery, /\^3,3,2,1,3,3,/);
  assert.match(recovery, /pg_dump[\s\S]*current-upgraded\.dump/);
  assert.match(recovery, /pg_restore[\s\S]*--exit-on-error[\s\S]*--role="\$migration_owner_user"/);
  assert.match(recovery, /application_rollback=previous-v0\.18\.0-ready-on-restored-pre-upgrade-schema/);
  assert.match(recovery, /rollback_limit=pre-upgrade-backup-required-post-backup-writes-not-preserved/);
  assert.doesNotMatch(recovery, /application_rollback=previous-v0\.18\.0-ready-on-expanded-schema/);
});

test('security upgrade verifies a nonowning runtime without crossing the enforcement epoch', () => {
  assert.match(recovery, /runtime_user="enterpriseglue_recovery_runtime"/);
  assert.match(recovery, /migration_owner_user="enterpriseglue_recovery_owner"/);
  assert.match(recovery, /database_identity="\$runtime_user"/);
  assert.match(recovery, /EG_POSTGRES_RUNTIME_ROLE="\$runtime_user"/);
  assert.match(recovery, /policy_epoch=pre-enforcement-dual-context-compatible/);
  assert.match(recovery, /current-upgraded-dump-verified-with-runtime-role/);
  assert.doesNotMatch(recovery, /--no-privileges/);
});

test('recovery stages through the exact published 0130 predecessor before bounded 0131 owner migration', () => {
  assert.match(recovery, /predecessor_tag=v0\.24\.2/);
  assert.match(recovery, /predecessor_revision=785b5ab890aba315f6c3944ace0edcc3ff99d20f/);
  assert.match(recovery, /backend@sha256:21b196a9ece726dac9f6a492cbb030c9dab6efadedf1f3f5ac842219027a3646/);
  assert.match(recovery, /count: 132/);
  assert.match(recovery, /through: 1700000000130/);
  assert.match(recovery, /e525e9f9fe8d66498aeea6beb03d6257274de3a38a7b48819de6edccf02ecb16/);
  assert.doesNotMatch(recovery, /SAAS_SCHEMA_PREDECESSOR_BACKEND_IMAGE/);
  assert.match(recovery, /runSchemaEpochOwnerMigrations\(\)/);
  const predecessorBody = recovery.slice(
    recovery.indexOf('run_predecessor_migrations()'),
    recovery.indexOf('run_current_owner_migration()'),
  );
  assert.ok(predecessorBody.indexOf("assertInventory('Published runtime', registered)")
    < predecessorBody.indexOf("runMigrations({ mode: 'apply' })"));
  assert.ok(predecessorBody.indexOf("assertInventory('Executed ledger', executed)")
    > predecessorBody.indexOf("runMigrations({ mode: 'apply' })"));
  assert.doesNotMatch(recovery, /run_migrations_from "\$root_dir" apply/);
  const predecessor = recovery.indexOf('run_predecessor_migrations \\\n');
  const owner = recovery.indexOf('run_current_owner_migration \\\n');
  const applicationVerify = recovery.indexOf('run_migrations_from "$root_dir" verify \\\n');
  assert.ok(predecessor > 0 && owner > predecessor && applicationVerify > owner);
  assert.doesNotMatch(recovery, /1700000000132/);
  assert.match(recovery, /run_predecessor_overlap verify/);
  assert.match(recovery, /EG_DATABASE_STARTUP_MODE=verify/);
  assert.match(recovery, /published-predecessor-overlap=verify-only-legacy-tenant-access/);
  assert.match(recovery, /may overlap 0131 only in verify mode; apply would recreate the legacy policy/);
  const postOwner = recovery.slice(owner);
  assert.doesNotMatch(postOwner, /run_predecessor_migrations/);
});

test('recovery rehearsal waits through the PostgreSQL initialization restart', () => {
  assert.match(recovery, /postgres_ready_streak=0/);
  assert.match(recovery, /postgres_ready_streak=\$\(\(postgres_ready_streak \+ 1\)\)/);
  assert.match(recovery, /postgres_ready_streak" -ge 3/);
  assert.match(recovery, /PostgreSQL did not remain ready after initialization/);
});

test('pooled qualification uses the real reference sidecar for every plugin delivery path', () => {
  assert.match(pooled, /eg-plugin-io-enterpriseglue-reference-health/);
  assert.match(pooled, /POOLED_TENANCY_REFERENCE_PLUGIN_DATA_DIR/);
  assert.match(pooled, /POOLED_TENANCY_REFERENCE_PLUGIN_UID/);
  assert.match(pooled, /POOLED_TENANCY_REFERENCE_PLUGIN_GID/);
  assert.match(
    pooledCompose,
    /user: "\$\{POOLED_TENANCY_REFERENCE_PLUGIN_UID\}:\$\{POOLED_TENANCY_REFERENCE_PLUGIN_GID\}"/,
  );
  assert.match(pooled, /actual-plugin-gateway/);
  assert.match(pooled, /plugin-storage/);
  assert.match(pooled, /plugin-schedule-delivery/);
  assert.match(pooled, /plugin-event-delivery/);
});

test('fresh pooled qualification separates exact published bootstrap, bounded owner, and verify-only runtime', () => {
  assert.match(pooled, /schema_predecessor_tag=v0\.24\.2/);
  assert.match(pooled, /schema_predecessor_revision=785b5ab890aba315f6c3944ace0edcc3ff99d20f/);
  assert.match(pooled, /backend@sha256:21b196a9ece726dac9f6a492cbb030c9dab6efadedf1f3f5ac842219027a3646/);
  assert.doesNotMatch(pooled, /\$\{POOLED_TENANCY_SCHEMA_PREDECESSOR_IMAGE:-/);
  assert.match(pooledCompose, /^  schema-predecessor:/m);
  assert.match(pooledCompose, /^  schema-owner-migration:/m);
  assert.match(pooledCompose, /^  schema-runtime-verify:/m);
  assert.match(pooledCompose, /schema-predecessor:[\s\S]*?count: 132[\s\S]*?through: 1700000000130/);
  const predecessorService = pooledCompose.slice(
    pooledCompose.indexOf('  schema-predecessor:'),
    pooledCompose.indexOf('  schema-owner-migration:'),
  );
  assert.ok(predecessorService.indexOf("assertInventory('Published runtime', registered)")
    < predecessorService.indexOf("runMigrations({ mode: 'apply' })"));
  assert.match(predecessorService, /seedInitialData\(\)[\s\S]*?bootstrapAdmin\(\)/);
  assert.match(predecessorService, /getRepository\('GitProvider'\)\.count\(\)[\s\S]*?providerCount !== 4/);
  assert.match(predecessorService, /getRepository\('TenantLoginPolicy'\)\.findOneBy/);
  assert.match(pooledCompose, /schema-owner-migration:[\s\S]*?runSchemaEpochOwnerMigrations\(\)/);
  assert.match(pooledCompose, /schema-runtime-verify:[\s\S]*?runMigrations\(\{ mode: 'verify' \}\)/);
  assert.match(pooledCompose, /backend:[\s\S]*?EG_DATABASE_STARTUP_MODE: verify/);
  assert.match(pooledCompose, /backend:[\s\S]*?schema-runtime-verify:[\s\S]*?condition: service_completed_successfully/);
  assert.match(pooled, /CREATE DATABASE \$\{appDatabase\} OWNER \$\{migrationOwnerUser\}/);
  assert.doesNotMatch(pooledCompose, /1700000000132/);
});

test('verify-only application startup cannot run implicit database seed writers', () => {
  assert.match(databaseInitialization, /if \(mode === 'apply'\) await operations\.seed\(\)/);
  assert.match(backendServer, /runDatabaseStartupBootstraps\(config\.databaseStartupMode/);
  assert.match(backendServer, /migrateEnterpriseDatabase:[\s\S]*?bootstrapAdmin:[\s\S]*?bootstrapDefaultEmailConfig,[\s\S]*?applyConfigBundle:[\s\S]*?seedGitProviders:[\s\S]*?seedEnvironmentTags:/);
});

test('cloud-ready migrations resolve metadata by stable names rather than class identity', () => {
  for (const file of [
    '../packages/shared/src/db/migrations/1700000000127-add-tenant-workload-lifecycle.ts',
    '../packages/shared/src/db/migrations/1700000000128-add-tenant-application-marketplace.ts',
    '../packages/shared/src/db/migrations/1700000000129-add-tenant-plugin-eligibility.ts',
  ]) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /getMetadata\(entityName\)/);
    assert.doesNotMatch(source, /getMetadata\(entity\)/);
  }
});
