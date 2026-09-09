import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const recovery = readFileSync(new URL('./run-saas-upgrade-restore-rollback.sh', import.meta.url), 'utf8');
const pooled = readFileSync(new URL('./run-pooled-tenancy-e2e.sh', import.meta.url), 'utf8');
const pooledCompose = readFileSync(
  new URL('../infra/docker/compose/docker-compose.pooled-tenancy-e2e.yml', import.meta.url),
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
  assert.match(recovery, /pg_restore[\s\S]*--exit-on-error[\s\S]*--role="\$app_user"/);
  assert.match(recovery, /application_rollback=previous-v0\.18\.0-ready-on-restored-pre-upgrade-schema/);
  assert.match(recovery, /rollback_limit=pre-upgrade-backup-required-post-backup-writes-not-preserved/);
  assert.doesNotMatch(recovery, /application_rollback=previous-v0\.18\.0-ready-on-expanded-schema/);
});

test('security upgrade verifies a nonowning runtime and denies historical missing-context reads', () => {
  assert.match(recovery, /runtime_user="enterpriseglue_recovery_runtime"/);
  assert.match(recovery, /database_identity="\$runtime_user"/);
  assert.match(recovery, /EG_POSTGRES_RUNTIME_ROLE=\$runtime_user/);
  assert.match(recovery, /run_migrations_from "\$baseline_source_dir" legacy-runtime-denial/);
  assert.match(recovery, /const source = await dataSource\.getDataSource\(\)/);
  assert.match(recovery, /Number\(rows\[0\]\?\.count\) !== 0/);
  assert.match(recovery, /current-upgraded-dump-verified-with-runtime-role/);
  assert.doesNotMatch(recovery, /--no-privileges/);
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
