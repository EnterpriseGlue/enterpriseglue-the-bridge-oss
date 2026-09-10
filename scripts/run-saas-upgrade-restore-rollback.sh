#!/usr/bin/env bash
set -Eeuo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
artifact_dir="${SAAS_RECOVERY_ARTIFACT_DIR:-$root_dir/.artifacts/saas-upgrade-restore-rollback}"
temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/enterpriseglue-saas-recovery.XXXXXX")"
postgres_name="eg-saas-recovery-db-${RANDOM}${RANDOM}"
baseline_name="eg-saas-recovery-baseline-${RANDOM}${RANDOM}"
predecessor_overlap_name="eg-saas-recovery-predecessor-${RANDOM}${RANDOM}"
network_name="eg-saas-recovery-${RANDOM}${RANDOM}"
baseline_image="${SAAS_BASELINE_BACKEND_IMAGE:-ghcr.io/enterpriseglue/enterpriseglue-the-bridge-oss-backend:v0.18.0}"
predecessor_image="ghcr.io/enterpriseglue/enterpriseglue-the-bridge-oss-backend@sha256:21b196a9ece726dac9f6a492cbb030c9dab6efadedf1f3f5ac842219027a3646"
predecessor_tag=v0.24.2
predecessor_revision=785b5ab890aba315f6c3944ace0edcc3ff99d20f
baseline_source_dir="$temp_dir/v0.18.0-source"
database_name="enterpriseglue_recovery"
migration_owner_user="enterpriseglue_recovery_owner"
migration_owner_password="disposable-recovery-owner-password"
# The published historical baseline migrates with its owner identity. Current
# application verification must use a separate, nonowning runtime identity.
runtime_user="enterpriseglue_recovery_runtime"
runtime_password="disposable-recovery-runtime-password"
bootstrap_password="disposable-recovery-bootstrap-password"
database_port=""

free_loopback_port() {
  node --input-type=module <<'NODE'
import net from 'node:net';
const server = net.createServer();
server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (!address || typeof address === 'string') process.exit(1);
  process.stdout.write(String(address.port));
  server.close();
});
NODE
}

capture_diagnostics() {
  docker logs "$postgres_name" > "$artifact_dir/postgres.log" 2>&1 || true
  docker logs "$baseline_name" > "$artifact_dir/baseline-application.log" 2>&1 || true
  docker logs "$predecessor_overlap_name" > "$artifact_dir/predecessor-overlap-application.log" 2>&1 || true
}

cleanup() {
  local status=$?
  trap - EXIT
  capture_diagnostics
  docker rm -f "$baseline_name" "$predecessor_overlap_name" "$postgres_name" >/dev/null 2>&1 || true
  docker network rm "$network_name" >/dev/null 2>&1 || true
  rm -rf "$temp_dir"
  exit "$status"
}
trap cleanup EXIT

if ! docker info >/dev/null 2>&1; then
  echo '[saas-recovery] Docker is required.' >&2
  exit 2
fi

mkdir -p "$artifact_dir"
chmod 700 "$artifact_dir"
database_port="$(free_loopback_port)"

echo "[saas-recovery] Pulling immutable baseline ${baseline_image}."
docker pull "$baseline_image" >/dev/null
baseline_digest="$(docker image inspect "$baseline_image" --format '{{index .RepoDigests 0}}')"
if [[ "$baseline_digest" != *@sha256:* ]]; then
  echo '[saas-recovery] Baseline image did not resolve to a digest.' >&2
  exit 1
fi
if [[ "$predecessor_image" != *@sha256:* ]]; then
  echo '[saas-recovery] Schema predecessor must be pinned by digest.' >&2
  exit 1
fi
if [[ "$(git -C "$root_dir" rev-parse "${predecessor_tag}^{commit}")" != "$predecessor_revision" ]]; then
  echo '[saas-recovery] Local schema-predecessor tag does not resolve to the published release revision.' >&2
  exit 1
fi
echo "[saas-recovery] Pulling exact published schema predecessor ${predecessor_image}."
docker pull "$predecessor_image" >/dev/null
predecessor_labels="$(docker image inspect "$predecessor_image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}} {{index .Config.Labels "org.opencontainers.image.version"}}')"
if [[ "$predecessor_labels" != "$predecessor_revision $predecessor_tag" ]]; then
  echo '[saas-recovery] Schema-predecessor image labels do not bind the expected release source.' >&2
  exit 1
fi

docker network create "$network_name" >/dev/null
docker run --name "$postgres_name" \
  --network "$network_name" \
  --network-alias db \
  -e POSTGRES_PASSWORD="$bootstrap_password" \
  -e POSTGRES_DB=postgres \
  -p "127.0.0.1:${database_port}:5432" \
  -d postgres:18-alpine >/dev/null

postgres_ready_streak=0
for _ in $(seq 1 60); do
  if docker exec "$postgres_name" pg_isready -U postgres -d postgres >/dev/null 2>&1; then
    postgres_ready_streak=$((postgres_ready_streak + 1))
    if [[ "$postgres_ready_streak" -ge 3 ]]; then
      break
    fi
  else
    postgres_ready_streak=0
  fi
  sleep 1
done
if [[ "$postgres_ready_streak" -lt 3 ]]; then
  docker logs "$postgres_name" >&2 || true
  echo '[saas-recovery] PostgreSQL did not remain ready after initialization.' >&2
  exit 1
fi
docker exec "$postgres_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "CREATE ROLE ${migration_owner_user} LOGIN PASSWORD '${migration_owner_password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS" >/dev/null
docker exec "$postgres_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "CREATE ROLE ${runtime_user} LOGIN PASSWORD '${runtime_password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS" >/dev/null
docker exec "$postgres_name" createdb -U postgres -O "$migration_owner_user" "$database_name"

start_baseline() {
  docker rm -f "$baseline_name" >/dev/null 2>&1 || true
  docker run --name "$baseline_name" \
    --network "$network_name" \
    -e NODE_ENV=production \
    -e API_PORT=8787 \
    -e FRONTEND_URL=http://frontend.invalid \
    -e DATABASE_TYPE=postgres \
    -e POSTGRES_HOST=db \
    -e POSTGRES_PORT=5432 \
    -e POSTGRES_USER="$migration_owner_user" \
    -e POSTGRES_PASSWORD="$migration_owner_password" \
    -e POSTGRES_DATABASE="$database_name" \
    -e POSTGRES_SCHEMA=main \
    -e POSTGRES_SSL=false \
    -e JWT_SECRET=disposable-recovery-jwt-secret-0123456789abcdef \
    -e ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
    -e ADMIN_EMAIL=recovery-admin@example.test \
    -e ADMIN_PASSWORD=Disposable-Recovery-Admin-Password-2026 \
    -e ADMIN_EMAIL_VERIFICATION_EXEMPT=true \
    -e GIT_REPOS_PATH=/tmp/enterpriseglue-recovery-repos \
    -e EG_TENANCY_MODE=pooled \
    -e EG_TENANT_RLS_ENFORCED=true \
    -e EG_TENANT_PLACEMENT_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
    -d "$baseline_digest" >/dev/null
  for _ in $(seq 1 120); do
    if docker exec "$baseline_name" node -e \
      "require('http').get('http://127.0.0.1:8787/ready',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))" \
      >/dev/null 2>&1; then
      return
    fi
    if [[ "$(docker inspect "$baseline_name" --format '{{.State.Running}}')" != "true" ]]; then
      break
    fi
    sleep 1
  done
  docker logs "$baseline_name" >&2 || true
  echo '[saas-recovery] Baseline application did not become ready.' >&2
  exit 1
}

stop_baseline_capture() {
  local stage="$1"
  docker logs "$baseline_name" > "$artifact_dir/${stage}.log" 2>&1
  docker rm -f "$baseline_name" >/dev/null
}

run_migrations_from() {
  local source_root="$1"
  local mode="$2"
  local database_identity="$migration_owner_user"
  local database_password="$migration_owner_password"
  if [[ "$mode" == verify ]]; then
    database_identity="$runtime_user"
    database_password="$runtime_password"
  fi
  if [[ "$source_root" == "$root_dir" && "$mode" != verify ]]; then
    echo '[saas-recovery] Current application source is verify-only; use the bounded owner entrypoint.' >&2
    return 1
  fi
  (
  cd "$source_root"
  env -u EG_POSTGRES_RUNTIME_ROLE \
    NODE_ENV=production \
    DATABASE_TYPE=postgres \
    POSTGRES_HOST=127.0.0.1 \
    POSTGRES_PORT="$database_port" \
    POSTGRES_USER="$database_identity" \
    POSTGRES_PASSWORD="$database_password" \
    POSTGRES_DATABASE="$database_name" \
    POSTGRES_SCHEMA=main \
    POSTGRES_SSL=false \
    JWT_SECRET=disposable-recovery-jwt-secret-0123456789abcdef \
    ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
    ADMIN_EMAIL=recovery-admin@example.test \
    ADMIN_PASSWORD=Disposable-Recovery-Admin-Password-2026 \
    FRONTEND_URL=http://frontend.invalid \
    GIT_REPOS_PATH="$temp_dir/repos" \
    EG_TENANCY_MODE=pooled \
    EG_TENANT_RLS_ENFORCED=true \
    EG_TENANT_PLACEMENT_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
    node --input-type=module - "$source_root" "$mode" <<'NODE'
const [sourceRoot, mode] = process.argv.slice(2);
const migrations = await import(`${new URL(`file://${sourceRoot}/backend/dist/packages/shared/src/db/run-migrations.js`)}`);
const dataSource = await import(`${new URL(`file://${sourceRoot}/backend/dist/packages/shared/src/db/data-source.js`)}`);
try {
  if (mode === 'apply') await migrations.runMigrations();
  else await migrations.runMigrations({ mode });
} finally {
  await dataSource.closeDataSource();
}
NODE
  )
}

run_predecessor_migrations() {
  docker run --rm -i \
    --network "$network_name" \
    -e NODE_ENV=production \
    -e DATABASE_TYPE=postgres \
    -e POSTGRES_HOST=db \
    -e POSTGRES_PORT=5432 \
    -e POSTGRES_USER="$migration_owner_user" \
    -e POSTGRES_PASSWORD="$migration_owner_password" \
    -e POSTGRES_DATABASE="$database_name" \
    -e POSTGRES_SCHEMA=main \
    -e POSTGRES_SSL=false \
    -e JWT_SECRET=disposable-recovery-jwt-secret-0123456789abcdef \
    -e ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
    -e ADMIN_EMAIL=recovery-admin@example.test \
    -e ADMIN_PASSWORD=Disposable-Recovery-Admin-Password-2026 \
    -e FRONTEND_URL=http://frontend.invalid \
    -e GIT_REPOS_PATH=/tmp/enterpriseglue-recovery-repos \
    -e EG_TENANCY_MODE=pooled \
    -e EG_TENANT_RLS_ENFORCED=true \
    -e EG_TENANT_PLACEMENT_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
    -e EG_POSTGRES_RUNTIME_ROLE="$runtime_user" \
    "$predecessor_image" --input-type=module - <<'NODE'
import { createHash } from 'node:crypto';
const expected = {
  count: 132,
  through: 1700000000130,
  sha256: 'e525e9f9fe8d66498aeea6beb03d6257274de3a38a7b48819de6edccf02ecb16',
};
const migrations = await import('./dist/packages/shared/dist/db/run-migrations.js');
const dataSourceModule = await import('./dist/packages/shared/dist/db/data-source.js');
const bootstrap = await import('./dist/packages/shared/dist/db/bootstrap.js');
const gitProviders = await import('./dist/packages/shared/dist/db/seed/gitProviders.js');
const environmentTags = await import('./dist/packages/shared/dist/services/platform-admin/EnvironmentTagService.js');
const tenantContext = await import('./dist/packages/shared/dist/services/tenant-database-context.js');
const identity = (migration) => {
  const name = migration.name || migration.constructor.name;
  return { name, timestamp: Number(name.slice(-13)) };
};
const digest = (inventory) => createHash('sha256').update(JSON.stringify(inventory)).digest('hex');
const assertInventory = (label, inventory) => {
  if (
    inventory.length !== expected.count
    || inventory.at(-1)?.timestamp !== expected.through
    || digest(inventory) !== expected.sha256
  ) throw new Error(`${label} is not the exact published 0130 predecessor inventory`);
};
try {
  const source = await dataSourceModule.getDataSource();
  const registered = source.migrations.map(identity)
    .sort((left, right) => left.timestamp - right.timestamp || left.name.localeCompare(right.name));
  assertInventory('Published runtime', registered);
  await migrations.runMigrations({ mode: 'apply' });
  const executed = (await source.query('SELECT timestamp, name FROM main.migrations ORDER BY timestamp, name'))
    .map((migration) => ({ name: migration.name, timestamp: Number(migration.timestamp) }));
  assertInventory('Executed ledger', executed);
  await migrations.seedInitialData();
  await bootstrap.bootstrapAdmin();
  await bootstrap.bootstrapDefaultEmailConfig();
  await gitProviders.seedGitProviders();
  await environmentTags.environmentTagService.seedDefaults();
  const admin = await source.getRepository('User').findOneBy({ email: 'recovery-admin@example.test', authProvider: 'local', isActive: true });
  const tenant = await source.getRepository('Tenant').findOneBy({ id: 'tenant-default', status: 'active' });
  if (!admin || !tenant) throw new Error('Published predecessor did not create the required admin and default tenant');
  await tenantContext.runWithTenantDatabaseContext({ tenantId: tenant.id, tenantSlug: tenant.slug }, async () => {
    const loginPolicy = await source.getRepository('TenantLoginPolicy').findOneBy({ tenantId: tenant.id });
    if (!loginPolicy) throw new Error('Published predecessor did not create the required default login policy');
  });
  console.log('published-schema-predecessor=exact-0130-with-bootstrap');
} finally {
  await dataSourceModule.closeDataSource();
}
NODE
}

run_current_owner_migration() {
  (
  cd "$root_dir"
  env \
    NODE_ENV=production \
    DATABASE_TYPE=postgres \
    POSTGRES_HOST=127.0.0.1 \
    POSTGRES_PORT="$database_port" \
    POSTGRES_USER="$migration_owner_user" \
    POSTGRES_PASSWORD="$migration_owner_password" \
    POSTGRES_DATABASE="$database_name" \
    POSTGRES_SCHEMA=main \
    POSTGRES_SSL=false \
    JWT_SECRET=disposable-recovery-jwt-secret-0123456789abcdef \
    ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
    ADMIN_EMAIL=recovery-admin@example.test \
    ADMIN_PASSWORD=Disposable-Recovery-Admin-Password-2026 \
    FRONTEND_URL=http://frontend.invalid \
    GIT_REPOS_PATH="$temp_dir/repos" \
    EG_TENANCY_MODE=pooled \
    EG_TENANT_RLS_ENFORCED=true \
    EG_TENANT_PLACEMENT_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
    EG_POSTGRES_RUNTIME_ROLE="$runtime_user" \
    node --input-type=module - "$root_dir" <<'NODE'
const [sourceRoot] = process.argv.slice(2);
const migrations = await import(`${new URL(`file://${sourceRoot}/backend/dist/packages/shared/src/db/run-migrations.js`)}`);
const dataSource = await import(`${new URL(`file://${sourceRoot}/backend/dist/packages/shared/src/db/data-source.js`)}`);
try {
  await migrations.runSchemaEpochOwnerMigrations();
} finally {
  await dataSource.closeDataSource();
}
NODE
  )
}

run_predecessor_overlap() {
  local mode="${1:-}"
  if [[ "$mode" != verify ]]; then
    echo '[saas-recovery] A retained predecessor may overlap 0131 only in verify mode; apply would recreate the legacy policy.' >&2
    return 1
  fi
  docker rm -f "$predecessor_overlap_name" >/dev/null 2>&1 || true
  docker run --name "$predecessor_overlap_name" \
    --network "$network_name" \
    -e NODE_ENV=production \
    -e API_PORT=8787 \
    -e FRONTEND_URL=http://frontend.invalid \
    -e DATABASE_TYPE=postgres \
    -e POSTGRES_HOST=db \
    -e POSTGRES_PORT=5432 \
    -e POSTGRES_USER="$runtime_user" \
    -e POSTGRES_PASSWORD="$runtime_password" \
    -e POSTGRES_DATABASE="$database_name" \
    -e POSTGRES_SCHEMA=main \
    -e POSTGRES_SSL=false \
    -e JWT_SECRET=disposable-recovery-jwt-secret-0123456789abcdef \
    -e ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
    -e ADMIN_EMAIL=recovery-admin@example.test \
    -e ADMIN_PASSWORD=Disposable-Recovery-Admin-Password-2026 \
    -e ADMIN_EMAIL_VERIFICATION_EXEMPT=true \
    -e GIT_REPOS_PATH=/tmp/enterpriseglue-recovery-repos \
    -e EG_TENANCY_MODE=pooled \
    -e EG_TENANT_RLS_ENFORCED=true \
    -e EG_DATABASE_STARTUP_MODE=verify \
    -e EG_TENANT_PLACEMENT_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
    -d "$predecessor_image" >/dev/null
  for _ in $(seq 1 120); do
    if docker exec "$predecessor_overlap_name" node -e \
      "require('http').get('http://127.0.0.1:8787/ready',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))" \
      >/dev/null 2>&1; then
      break
    fi
    if [[ "$(docker inspect "$predecessor_overlap_name" --format '{{.State.Running}}')" != true ]]; then
      docker logs "$predecessor_overlap_name" >&2 || true
      echo '[saas-recovery] Verify-only predecessor overlap did not remain running.' >&2
      return 1
    fi
    sleep 1
  done
  docker exec "$predecessor_overlap_name" node -e \
    "require('http').get('http://127.0.0.1:8787/ready',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

  docker run --rm -i \
    --network "$network_name" \
    -e NODE_ENV=production \
    -e DATABASE_TYPE=postgres \
    -e POSTGRES_HOST=db \
    -e POSTGRES_PORT=5432 \
    -e POSTGRES_USER="$runtime_user" \
    -e POSTGRES_PASSWORD="$runtime_password" \
    -e POSTGRES_DATABASE="$database_name" \
    -e POSTGRES_SCHEMA=main \
    -e POSTGRES_SSL=false \
    -e JWT_SECRET=disposable-recovery-jwt-secret-0123456789abcdef \
    -e ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
    -e FRONTEND_URL=http://frontend.invalid \
    -e ADMIN_EMAIL=recovery-admin@example.test \
    -e ADMIN_PASSWORD=Disposable-Recovery-Admin-Password-2026 \
    -e EG_TENANCY_MODE=pooled \
    -e EG_TENANT_RLS_ENFORCED=true \
    -e EG_DATABASE_STARTUP_MODE=verify \
    -e EG_TENANT_PLACEMENT_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
    "$predecessor_image" --input-type=module - <<'NODE'
const migrations = await import('./dist/packages/shared/dist/db/run-migrations.js');
const dataSourceModule = await import('./dist/packages/shared/dist/db/data-source.js');
const tenantContext = await import('./dist/packages/shared/dist/services/tenant-database-context.js');
try {
  await migrations.runMigrations({ mode: 'verify' });
  const source = await dataSourceModule.getDataSource();
  const tenantId = '10000000-0000-4000-8000-000000000001';
  const provider = await tenantContext.runWithTenantDatabaseContext(
    { tenantId, tenantSlug: 'alpha' },
    () => source.getRepository('IdentityProvider').findOneBy({
      id: '20000000-0000-4000-8000-000000000001', tenantId,
    }),
  );
  if (!provider) throw new Error('Published predecessor could not read its legacy tenant row through dual 0131');
  console.log('published-predecessor-overlap=verify-only-legacy-tenant-access');
} finally {
  await dataSourceModule.closeDataSource();
}
NODE
  docker logs "$predecessor_overlap_name" > "$artifact_dir/v0.24.2-verify-only-overlap.log" 2>&1
  docker rm -f "$predecessor_overlap_name" >/dev/null
}

echo '[saas-recovery] Building the authoritative v0.18.0 source-tag migration baseline.'
mkdir -p "$baseline_source_dir"
git -C "$root_dir" archive v0.18.0 | tar -x -C "$baseline_source_dir"
(
  cd "$baseline_source_dir"
  pnpm install --frozen-lockfile --ignore-scripts >/dev/null
  pnpm --filter webmodeler-backend run build > "$artifact_dir/v0.18.0-source-build.log"
)
run_migrations_from "$baseline_source_dir" apply \
  > "$artifact_dir/v0.18.0-migrations.log" 2>&1

echo '[saas-recovery] Verifying the published v0.18.0 application on its complete source-tag schema.'
start_baseline
stop_baseline_capture v0.18.0-application-baseline

now_ms="$(node -e 'process.stdout.write(String(Date.now()))')"
docker exec -i "$postgres_name" psql -v ON_ERROR_STOP=1 -U postgres -d "$database_name" >/dev/null <<SQL
INSERT INTO main.tenants
  (id, name, slug, status, placement_key, placement_epoch, created_by_user_id, created_at, updated_at)
VALUES
  ('10000000-0000-4000-8000-000000000001', 'Alpha Industries', 'alpha', 'active', 'recovery-shard', 1, NULL, ${now_ms}, ${now_ms}),
  ('10000000-0000-4000-8000-000000000002', 'Bravo Services', 'bravo', 'active', 'recovery-shard', 1, NULL, ${now_ms}, ${now_ms}),
  ('10000000-0000-4000-8000-000000000003', 'Charlie Operations', 'charlie', 'active', 'recovery-shard', 1, NULL, ${now_ms}, ${now_ms});

INSERT INTO main.identity_providers
  (id, tenant_id, key, display_name, organization, display_order, is_preferred,
   preferred_scope_identity, login_domains_json, provider_key_identity, protocol,
   is_enabled, authentication_mode, directory_tenant_id, configuration_json,
   sync_json, ownership_mode, source_ref, source_hash, last_applied_at, drift_status,
   created_at, updated_at)
VALUES
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'tenant-sso', 'Alpha OIDC', 'Alpha Industries', 0, false, 'alpha:tenant-sso:regular', '[]', 'alpha:tenant-sso', 'oidc', true, 'direct', NULL, '{"issuerUrl":"https://alpha-idp.example.test","clientSecretRef":"ref:tenant-secret://alpha/oidc"}', '{}', 'manual', NULL, NULL, NULL, NULL, ${now_ms}, ${now_ms}),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'tenant-sso', 'Bravo SAML', 'Bravo Services', 0, false, 'bravo:tenant-sso:regular', '[]', 'bravo:tenant-sso', 'saml', true, 'direct', NULL, '{"ssoUrl":"https://bravo-idp.example.test/saml","signingCertificateRef":"ref:tenant-secret://bravo/saml"}', '{}', 'manual', NULL, NULL, NULL, NULL, ${now_ms}, ${now_ms}),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000003', 'tenant-sso', 'Charlie LDAP', 'Charlie Operations', 0, false, 'charlie:tenant-sso:regular', '[]', 'charlie:tenant-sso', 'ldap', true, 'direct', NULL, '{"url":"ldaps://charlie-directory.example.test","bindPasswordRef":"ref:tenant-secret://charlie/ldap"}', '{}', 'manual', NULL, NULL, NULL, NULL, ${now_ms}, ${now_ms});

INSERT INTO main.plugin_installations
  (id, plugin_id, version, publisher, display_name, manifest_sha256,
   source_record_hash, bundle_digest, state, reason_code, desired_enabled,
   installer_enabled, enablement_scope, grant_set_hash, compatible, healthy,
   entitlement_state, revision, installer_revision, created_at, updated_at)
VALUES
  ('30000000-0000-4000-8000-000000000001', 'io.enterpriseglue.reference-health', '0.1.0',
   'io.enterpriseglue', 'Reference Health', repeat('a', 64), repeat('b', 64),
   'registry.invalid/reference@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
   'ready', 'none', true, true, 'tenant', repeat('d', 64), true, true,
   'not_required', 1, 1, ${now_ms}, ${now_ms});

INSERT INTO main.plugin_tenant_enablements
  (id, plugin_id, tenant_ref, enabled, reason_code, revision, created_at, updated_at)
VALUES
  ('40000000-0000-4000-8000-000000000001', 'io.enterpriseglue.reference-health', '10000000-0000-4000-8000-000000000001', true, 'tenant_enabled', 1, ${now_ms}, ${now_ms}),
  ('40000000-0000-4000-8000-000000000002', 'io.enterpriseglue.reference-health', '10000000-0000-4000-8000-000000000002', true, 'tenant_enabled', 1, ${now_ms}, ${now_ms}),
  ('40000000-0000-4000-8000-000000000003', 'io.enterpriseglue.reference-health', '10000000-0000-4000-8000-000000000003', false, 'tenant_disabled', 1, ${now_ms}, ${now_ms});
SQL

docker exec "$postgres_name" pg_dump -U postgres -d "$database_name" -Fc \
  > "$artifact_dir/v0.18.0-populated-pre-upgrade.dump"

echo '[saas-recovery] Advancing populated v0.18.0 state with the exact published 0130 predecessor.'
run_predecessor_migrations \
  > "$artifact_dir/published-predecessor-migrations.log" 2>&1

echo '[saas-recovery] Applying only the bounded current 0131 owner transition.'
cd "$root_dir"
pnpm --filter webmodeler-backend run build >/dev/null
run_current_owner_migration \
  > "$artifact_dir/current-upgrade-migrations.log" 2>&1
echo '[saas-recovery] Verifying retained v0.24.2 overlap is read-only and preserves the dual policy.'
run_predecessor_overlap verify \
  > "$artifact_dir/v0.24.2-verify-only-legacy-access.log" 2>&1
run_migrations_from "$root_dir" verify \
  > "$artifact_dir/current-upgrade-verify.log" 2>&1

docker exec "$postgres_name" pg_dump -U postgres -d "$database_name" -Fc \
  > "$artifact_dir/current-upgraded.dump"

echo '[saas-recovery] Restoring the upgraded database into a clean database.'
docker exec "$postgres_name" dropdb -U postgres --force "$database_name"
docker exec "$postgres_name" createdb -U postgres -O "$migration_owner_user" "$database_name"
docker exec -i "$postgres_name" pg_restore -U postgres -d "$database_name" \
  --exit-on-error --role="$migration_owner_user" --no-owner \
  < "$artifact_dir/current-upgraded.dump"
run_migrations_from "$root_dir" verify \
  > "$artifact_dir/restored-database-verify.log" 2>&1

docker exec "$postgres_name" psql -v ON_ERROR_STOP=1 -U postgres -d "$database_name" \
  -At -F, -c "
    SELECT
      (SELECT count(*) FROM main.tenants WHERE id IN (
        '10000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000002',
        '10000000-0000-4000-8000-000000000003'
      )) AS qualified_tenants,
      (SELECT count(*) FROM main.identity_providers) AS identity_providers,
      (SELECT count(*) FROM main.plugin_tenant_enablements WHERE enabled) AS active_plugins,
      (SELECT count(*) FROM main.plugin_tenant_enablements WHERE NOT enabled) AS inactive_plugins,
      (SELECT count(*) FROM main.identity_providers WHERE
        (id, tenant_id, key, protocol, is_enabled) IN (
          ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'tenant-sso', 'oidc', true),
          ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'tenant-sso', 'saml', true),
          ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000003', 'tenant-sso', 'ldap', true)
        )) AS exact_provider_bindings,
      (SELECT count(*) FROM main.plugin_tenant_enablements WHERE
        (id, plugin_id, tenant_ref, enabled) IN (
          ('40000000-0000-4000-8000-000000000001', 'io.enterpriseglue.reference-health', '10000000-0000-4000-8000-000000000001', true),
          ('40000000-0000-4000-8000-000000000002', 'io.enterpriseglue.reference-health', '10000000-0000-4000-8000-000000000002', true),
          ('40000000-0000-4000-8000-000000000003', 'io.enterpriseglue.reference-health', '10000000-0000-4000-8000-000000000003', false)
        )) AS exact_plugin_bindings,
      (SELECT count(*) FROM main.migrations) AS migrations;
  " > "$artifact_dir/restored-state.csv"

restored_state="$(cat "$artifact_dir/restored-state.csv")"
if [[ ! "$restored_state" =~ ^3,3,2,1,3,3,[0-9]+$ ]]; then
  echo "[saas-recovery] Restored state is incomplete: ${restored_state}" >&2
  exit 1
fi

echo '[saas-recovery] Rehearsing rollback using the pre-upgrade database backup.'
docker exec "$postgres_name" dropdb -U postgres --force "$database_name"
docker exec "$postgres_name" createdb -U postgres -O "$migration_owner_user" "$database_name"
docker exec -i "$postgres_name" pg_restore -U postgres -d "$database_name" \
  --exit-on-error --role="$migration_owner_user" --no-owner \
  < "$artifact_dir/v0.18.0-populated-pre-upgrade.dump"
start_baseline
stop_baseline_capture v0.18.0-application-restored-rollback

{
  echo 'status=passed'
  echo 'baseline=v0.18.0'
  echo "baseline_digest=${baseline_digest}"
  echo "schema_predecessor=${predecessor_tag}@${predecessor_revision}"
  echo "schema_predecessor_digest=${predecessor_image#*@}"
  echo 'owner_transition=bounded-1700000000131'
  echo 'application_startup=verify-only-restricted-runtime'
  echo 'upgrade=populated-security-policy-with-separate-runtime-role'
  echo 'policy_epoch=pre-enforcement-dual-context-compatible'
  echo 'predecessor_overlap=v0.24.2-verify-only-ready-with-legacy-tenant-access'
  echo 'application_rollback=previous-v0.18.0-ready-on-restored-pre-upgrade-schema'
  echo 'restore=current-upgraded-dump-verified-with-runtime-role'
  echo 'rollback_limit=pre-upgrade-backup-required-post-backup-writes-not-preserved'
  echo 'preserved=three-tenants,oidc-saml-ldap,alpha-bravo-active,charlie-inactive'
} > "$artifact_dir/summary.txt"

echo '[saas-recovery] Upgrade, previous-application rollback, and restore passed.'
