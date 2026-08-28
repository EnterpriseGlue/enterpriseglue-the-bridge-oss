#!/usr/bin/env bash
set -Eeuo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
artifact_dir="${SAAS_RECOVERY_ARTIFACT_DIR:-$root_dir/.artifacts/saas-upgrade-restore-rollback}"
temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/enterpriseglue-saas-recovery.XXXXXX")"
postgres_name="eg-saas-recovery-db-${RANDOM}${RANDOM}"
baseline_name="eg-saas-recovery-baseline-${RANDOM}${RANDOM}"
network_name="eg-saas-recovery-${RANDOM}${RANDOM}"
baseline_image="${SAAS_BASELINE_BACKEND_IMAGE:-ghcr.io/enterpriseglue/enterpriseglue-the-bridge-oss-backend:v0.18.0}"
baseline_source_dir="$temp_dir/v0.18.0-source"
database_name="enterpriseglue_recovery"
app_user="enterpriseglue_recovery_app"
app_password="disposable-recovery-app-password"
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
}

cleanup() {
  local status=$?
  trap - EXIT
  capture_diagnostics
  docker rm -f "$baseline_name" "$postgres_name" >/dev/null 2>&1 || true
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
  -c "CREATE ROLE ${app_user} LOGIN PASSWORD '${app_password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS" >/dev/null
docker exec "$postgres_name" createdb -U postgres -O "$app_user" "$database_name"

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
    -e POSTGRES_USER="$app_user" \
    -e POSTGRES_PASSWORD="$app_password" \
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
  (
  cd "$source_root"
  env \
    NODE_ENV=production \
    DATABASE_TYPE=postgres \
    POSTGRES_HOST=127.0.0.1 \
    POSTGRES_PORT="$database_port" \
    POSTGRES_USER="$app_user" \
    POSTGRES_PASSWORD="$app_password" \
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

echo '[saas-recovery] Applying current additive migrations to populated v0.18.0 state.'
cd "$root_dir"
pnpm --filter webmodeler-backend run build >/dev/null
run_migrations_from "$root_dir" apply \
  > "$artifact_dir/current-upgrade-migrations.log" 2>&1
run_migrations_from "$root_dir" verify \
  > "$artifact_dir/current-upgrade-verify.log" 2>&1

docker exec "$postgres_name" pg_dump -U postgres -d "$database_name" -Fc \
  > "$artifact_dir/current-upgraded.dump"

echo '[saas-recovery] Exercising previous-application rollback on the expanded schema.'
start_baseline
stop_baseline_capture v0.18.0-application-rollback

echo '[saas-recovery] Restoring the upgraded database into a clean database.'
docker exec "$postgres_name" dropdb -U postgres --force "$database_name"
docker exec "$postgres_name" createdb -U postgres -O "$app_user" "$database_name"
docker exec -i "$postgres_name" pg_restore -U postgres -d "$database_name" \
  --exit-on-error --role="$app_user" --no-owner --no-privileges \
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
      (SELECT count(*) FROM main.migrations) AS migrations;
  " > "$artifact_dir/restored-state.csv"

restored_state="$(cat "$artifact_dir/restored-state.csv")"
if [[ ! "$restored_state" =~ ^3,3,2,1,[0-9]+$ ]]; then
  echo "[saas-recovery] Restored state is incomplete: ${restored_state}" >&2
  exit 1
fi

{
  echo 'status=passed'
  echo 'baseline=v0.18.0'
  echo "baseline_digest=${baseline_digest}"
  echo 'upgrade=populated-additive'
  echo 'application_rollback=previous-v0.18.0-ready-on-expanded-schema'
  echo 'restore=current-upgraded-dump-verified'
  echo 'preserved=three-tenants,oidc-saml-ldap,alpha-bravo-active,charlie-inactive'
} > "$artifact_dir/summary.txt"

echo '[saas-recovery] Upgrade, previous-application rollback, and restore passed.'
