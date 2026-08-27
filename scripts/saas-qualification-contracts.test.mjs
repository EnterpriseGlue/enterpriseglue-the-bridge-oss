import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const recovery = readFileSync(new URL('./run-saas-upgrade-restore-rollback.sh', import.meta.url), 'utf8');
const pooled = readFileSync(new URL('./run-pooled-tenancy-e2e.sh', import.meta.url), 'utf8');

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
  assert.match(recovery, /pg_dump[\s\S]*current-upgraded\.dump/);
  assert.match(recovery, /pg_restore[\s\S]*--exit-on-error[\s\S]*--role="\$app_user"/);
  assert.match(recovery, /application_rollback=previous-v0\.18\.0-ready-on-expanded-schema/);
});

test('pooled qualification uses the real reference sidecar for every plugin delivery path', () => {
  assert.match(pooled, /eg-plugin-io-enterpriseglue-reference-health/);
  assert.match(pooled, /POOLED_TENANCY_REFERENCE_PLUGIN_DATA_DIR/);
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
