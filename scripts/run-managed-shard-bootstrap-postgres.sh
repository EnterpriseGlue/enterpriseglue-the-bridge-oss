#!/usr/bin/env bash
set -Eeuo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fixture_suffix="${RANDOM}${RANDOM}"
network_name="enterpriseglue-managed-shard-bootstrap-${fixture_suffix}"
postgres_name="enterpriseglue-managed-shard-bootstrap-postgres-${fixture_suffix}"
postgres_image='postgres:16.15-alpine3.24@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685'
bootstrap_image="${EG_MANAGED_SHARD_BOOTSTRAP_IMAGE:-enterpriseglue-managed-shard-bootstrap:test}"
owner_role='eg_bootstrap_owner'
runtime_role='eg_bootstrap_runtime'
database_name='eg_bootstrap'
schema_name='main'
shard_id='qualification-shard'
work_dir="$(mktemp -d)"
postgres_id=''
runner_ids=()

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  for id in "${runner_ids[@]}"; do
    docker rm -f -v "$id" >/dev/null 2>&1 || true
  done
  if [[ -n "$postgres_id" ]] && ! docker rm -f -v "$postgres_id" >/dev/null 2>&1; then
    echo '[managed-shard-bootstrap] Owned PostgreSQL fixture cleanup failed.' >&2
    if [[ "$status" -eq 0 ]]; then status=1; fi
  fi
  docker network rm "$network_name" >/dev/null 2>&1 || true
  rm -rf -- "$work_dir"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

cd "$root_dir"
if [[ -z "${EG_MANAGED_SHARD_BOOTSTRAP_IMAGE:-}" ]]; then
  docker build \
    --file infra/docker/managed-shard-bootstrap/Dockerfile \
    --tag "$bootstrap_image" \
    . >"$work_dir/build.log"
fi

docker network create "$network_name" >/dev/null
postgres_id="$(docker create \
  --name "$postgres_name" \
  --network "$network_name" \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=postgres \
  "$postgres_image")"
docker start "$postgres_id" >/dev/null

ready=false
for _ in $(seq 1 60); do
  if docker exec "$postgres_id" pg_isready -h 127.0.0.1 -p 5432 -U postgres -d postgres >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
if [[ "$ready" != true ]]; then
  echo '[managed-shard-bootstrap] PostgreSQL readiness timed out.' >&2
  exit 1
fi
if [[ "$(docker exec "$postgres_id" psql -At -U postgres -d postgres -c 'SHOW server_version_num')" != 16* ]]; then
  echo '[managed-shard-bootstrap] Fixture must retain PostgreSQL 16 staging coverage.' >&2
  exit 1
fi

docker exec "$postgres_id" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "CREATE ROLE ${owner_role} LOGIN PASSWORD 'owner-test-password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS" \
  -c "CREATE ROLE ${runtime_role} LOGIN PASSWORD 'runtime-test-password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS" \
  -c "CREATE DATABASE ${database_name} OWNER ${owner_role}" >/dev/null

create_runner() {
  local receipt_path="$1"
  local database_user="${2:-$owner_role}"
  local database_password="${3:-owner-test-password}"
  local target_schema="${4:-$schema_name}"
  local admin_email="${5:-bootstrap-admin@example.test}"
  local docker_args=(
    --name "enterpriseglue-managed-shard-bootstrap-run-${fixture_suffix}-${#runner_ids[@]}"
    --network "$network_name"
    -e EG_MANAGED_SHARD_BOOTSTRAP_ENABLED=true
    -e EG_MANAGED_SHARD_TARGET_TENANCY_MODE=pooled
    -e EG_MANAGED_SHARD_ID="$shard_id"
    -e EG_POSTGRES_RUNTIME_ROLE="$runtime_role"
    -e EG_TENANCY_MODE=single
    -e DATABASE_TYPE=postgres
    -e POSTGRES_HOST="$postgres_name"
    -e POSTGRES_PORT=5432
    -e POSTGRES_USER="$database_user"
    -e POSTGRES_PASSWORD="$database_password"
    -e POSTGRES_DATABASE="$database_name"
    -e POSTGRES_SCHEMA="$target_schema"
    -e NODE_ENV=production
    -e JWT_SECRET=qualification-jwt-value-with-at-least-32-characters
  )
  if [[ "$admin_email" != '__OMIT__' ]]; then
    docker_args+=(-e "ADMIN_EMAIL=$admin_email")
  fi
  docker_args+=(
    -e ADMIN_PASSWORD=bootstrap-admin-test-password
    -e ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
    -e EG_MANAGED_SHARD_BOOTSTRAP_RECEIPT_PATH="$receipt_path"
    "$bootstrap_image"
  )
  local id
  id="$(docker create "${docker_args[@]}")"
  runner_ids+=("$id")
  last_runner_id="$id"
}

run_success() {
  local expected_action="$1"
  local index="${#runner_ids[@]}"
  local receipt_path='/var/run/enterpriseglue-bootstrap/receipt.json'
  local output_receipt="$work_dir/receipt-${index}.json"
  local log="$work_dir/run-${index}.log"
  create_runner "$receipt_path"
  if ! docker start -a "$last_runner_id" >"$log" 2>&1; then
    tail -n 40 "$log" >&2
    return 1
  fi
  docker cp "$last_runner_id:$receipt_path" "$output_receipt" >/dev/null
  node --input-type=module - "$output_receipt" "$expected_action" <<'NODE'
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const [receiptPath, expectedAction] = process.argv.slice(2);
const receiptBytes = await readFile(receiptPath);
assert.ok(receiptBytes.byteLength <= 4096);
const receipt = JSON.parse(receiptBytes);
assert.equal(receipt.schemaVersion, 'enterpriseglue-managed-shard-bootstrap-receipt/v1');
assert.equal(receipt.status, 'qualified');
assert.equal(receipt.action, expectedAction);
assert.equal(receipt.shardId, 'qualification-shard');
assert.equal(receipt.target.databaseType, 'postgres');
assert.equal(receipt.target.tenancyMode, 'pooled');
assert.equal(receipt.predecessor.migrationInventory.through, 1700000000130);
assert.equal(receipt.predecessor.migrationInventory.count, 132);
assert.deepEqual(Object.keys(receipt).sort(), ['action', 'bootstrapId', 'manifestSha256', 'observed', 'predecessor', 'schemaVersion', 'shardId', 'status', 'target']);
assert.doesNotMatch(receiptBytes.toString('utf8'), /owner-test-password|runtime-test-password|bootstrap-admin-test-password|qualification-jwt-value/i);
NODE
}

run_failure() {
  local expected_message="$1"
  local index="${#runner_ids[@]}"
  local log="$work_dir/run-${index}.log"
  create_runner '/var/run/enterpriseglue-bootstrap/receipt.json'
  if docker start -a "$last_runner_id" >"$log" 2>&1; then
    echo "[managed-shard-bootstrap] Expected rejection: $expected_message" >&2
    return 1
  fi
  if ! grep -F "$expected_message" "$log" >/dev/null; then
    tail -n 40 "$log" >&2
    return 1
  fi
}

run_failure_as() {
  local expected_message="$1"
  local database_user="$2"
  local database_password="$3"
  local target_schema="$4"
  local admin_email="${5:-bootstrap-admin@example.test}"
  local index="${#runner_ids[@]}"
  local log="$work_dir/run-${index}.log"
  create_runner '/var/run/enterpriseglue-bootstrap/receipt.json' "$database_user" "$database_password" "$target_schema" "$admin_email"
  if docker start -a "$last_runner_id" >"$log" 2>&1; then
    echo "[managed-shard-bootstrap] Expected rejection: $expected_message" >&2
    return 1
  fi
  if ! grep -F "$expected_message" "$log" >/dev/null; then
    tail -n 40 "$log" >&2
    return 1
  fi
}

owner_sql() {
  docker exec -e PGPASSWORD=owner-test-password "$postgres_id" \
    psql -v ON_ERROR_STOP=1 -U "$owner_role" -d "$database_name" "$@" >/dev/null
}

owner_query() {
  docker exec -e PGPASSWORD=owner-test-password "$postgres_id" \
    psql -v ON_ERROR_STOP=1 -U "$owner_role" -d "$database_name" "$@"
}

run_failure_as 'Managed shard owner role attributes are not restricted' postgres postgres superuser_pristine
if docker exec "$postgres_id" psql -At -U postgres -d "$database_name" -c "SELECT 1 FROM pg_namespace WHERE nspname='superuser_pristine'" | grep -q 1; then
  echo '[managed-shard-bootstrap] Rejected superuser mutated the pristine schema.' >&2
  exit 1
fi

run_failure_as 'ADMIN_EMAIL must be an explicit valid bootstrap administrator email' "$owner_role" owner-test-password missing_admin_email __OMIT__
if docker exec "$postgres_id" psql -At -U postgres -d "$database_name" -c "SELECT 1 FROM pg_namespace WHERE nspname='missing_admin_email'" | grep -q 1; then
  echo '[managed-shard-bootstrap] Rejected missing ADMIN_EMAIL mutated the pristine schema.' >&2
  exit 1
fi

run_failure_as 'ADMIN_EMAIL must be an explicit valid bootstrap administrator email' "$owner_role" owner-test-password invalid_admin_email not-an-email
if docker exec "$postgres_id" psql -At -U postgres -d "$database_name" -c "SELECT 1 FROM pg_namespace WHERE nspname='invalid_admin_email'" | grep -q 1; then
  echo '[managed-shard-bootstrap] Rejected invalid ADMIN_EMAIL mutated the pristine schema.' >&2
  exit 1
fi

run_success bootstrapped
run_success verified-existing

first_membership_id="$(owner_query -At -c "SELECT id FROM ${schema_name}.authz_group_memberships ORDER BY id LIMIT 1")"
second_membership_id="$(owner_query -At -c "SELECT id FROM ${schema_name}.authz_group_memberships ORDER BY id OFFSET 1 LIMIT 1")"
second_audit_id="$(owner_query -At -c "SELECT id FROM ${schema_name}.audit_logs WHERE resource_id='${second_membership_id}'")"
owner_sql -c "UPDATE ${schema_name}.audit_logs SET resource_id='${first_membership_id}' WHERE id='${second_audit_id}'"
run_failure 'Managed shard bootstrap authorization audit drifted'
owner_sql -c "UPDATE ${schema_name}.audit_logs SET resource_id='${second_membership_id}' WHERE id='${second_audit_id}'"

owner_sql -c "CREATE TABLE ${schema_name}.unexpected_bootstrap_object (id integer)"
run_failure 'Managed shard schema object inventory drifted'
owner_sql -c "DROP TABLE ${schema_name}.unexpected_bootstrap_object"

owner_sql -c "CREATE INDEX unexpected_bootstrap_index ON ${schema_name}.users(email)"
run_failure 'Managed shard TypeORM structural inventory drifted'
owner_sql -c "DROP INDEX ${schema_name}.unexpected_bootstrap_index"

owner_sql -c "CREATE SEQUENCE ${schema_name}.unexpected_bootstrap_sequence"
run_failure 'Managed shard schema object inventory drifted'
owner_sql -c "DROP SEQUENCE ${schema_name}.unexpected_bootstrap_sequence"

owner_sql -c "CREATE TABLE ${schema_name}.release_effect_cohorts (id integer)"
run_failure 'Managed shard contains an object reserved for a later schema epoch'
owner_sql -c "DROP TABLE ${schema_name}.release_effect_cohorts"

docker exec "$postgres_id" psql -v ON_ERROR_STOP=1 -U postgres -d "$database_name" \
  -c "ALTER TABLE ${schema_name}.users OWNER TO postgres" >/dev/null
run_failure 'Migration identity must own every managed table and sequence'
docker exec "$postgres_id" psql -v ON_ERROR_STOP=1 -U postgres -d "$database_name" \
  -c "ALTER TABLE ${schema_name}.users OWNER TO ${owner_role}" >/dev/null

owner_sql -c "DROP POLICY eg_tenant_isolation ON ${schema_name}.audit_logs"
run_failure 'Managed shard PostgreSQL policy inventory is not exact legacy 0130'
owner_sql -c "CREATE POLICY eg_tenant_isolation ON ${schema_name}.audit_logs USING (COALESCE(NULLIF(current_setting('enterpriseglue.tenancy_mode', true), ''), 'single') <> 'pooled' OR tenant_id = NULLIF(current_setting('enterpriseglue.tenant_id', true), '')) WITH CHECK (COALESCE(NULLIF(current_setting('enterpriseglue.tenancy_mode', true), ''), 'single') <> 'pooled' OR tenant_id = NULLIF(current_setting('enterpriseglue.tenant_id', true), ''))"

owner_sql -c "UPDATE ${schema_name}.environment_tags SET name='Drifted' WHERE id='env-dev'"
run_failure 'Managed shard environment tag seeds drifted'
owner_sql -c "UPDATE ${schema_name}.environment_tags SET name='Dev' WHERE id='env-dev'"

owner_sql -c "UPDATE ${schema_name}.role_assignments SET role_id='system.platform.user' WHERE principal_id='system.group.platform_administrators'"
run_failure 'Managed shard authorization group assignments drifted'
owner_sql -c "UPDATE ${schema_name}.role_assignments SET role_id='system.platform.admin' WHERE principal_id='system.group.platform_administrators'"

owner_sql -c "UPDATE ${schema_name}.permissions SET label='Drifted permission' WHERE id='platform:dashboard:view'"
run_failure 'Managed shard RBAC permission catalogue drifted'
owner_sql -c "UPDATE ${schema_name}.permissions SET label='Dashboard View' WHERE id='platform:dashboard:view'"

owner_sql -c "UPDATE ${schema_name}.platform_settings SET sync_push_enabled=false WHERE id='default'"
run_failure 'Managed shard platform settings seed drifted'
owner_sql -c "UPDATE ${schema_name}.platform_settings SET sync_push_enabled=true WHERE id='default'"

owner_sql -c "UPDATE ${schema_name}.email_templates SET subject='Drifted' WHERE id='tpl-welcome'"
run_failure 'Managed shard email template catalogue drifted'
owner_sql -c "UPDATE ${schema_name}.email_templates SET subject='Welcome to {{platformName}}!' WHERE id='tpl-welcome'"

admin_hash="$(docker exec -e PGPASSWORD=owner-test-password "$postgres_id" psql -At -U "$owner_role" -d "$database_name" -c "SELECT password_hash FROM ${schema_name}.users WHERE email='bootstrap-admin@example.test'")"
owner_sql -c "UPDATE ${schema_name}.users SET password_hash='not-a-valid-bootstrap-hash' WHERE email='bootstrap-admin@example.test'"
run_failure 'Managed shard bootstrap administrator credential does not match the supplied password'
owner_sql -c "UPDATE ${schema_name}.users SET password_hash='${admin_hash}' WHERE email='bootstrap-admin@example.test'"

owner_sql -c "INSERT INTO ${schema_name}.notifications(id,user_id,tenant_id,state,title,subtitle,read_at,created_at) SELECT 'unexpected-notification',id,'tenant-default','info','Unexpected',NULL,NULL,1 FROM ${schema_name}.users LIMIT 1"
run_failure 'Managed shard ordinary business relation is not empty: notifications'
owner_sql -c "DELETE FROM ${schema_name}.notifications WHERE id='unexpected-notification'"

docker exec "$postgres_id" psql -v ON_ERROR_STOP=1 -U postgres -d "$database_name" \
  -c "CREATE ROLE eg_bootstrap_foreign NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS" >/dev/null

docker exec "$postgres_id" psql -v ON_ERROR_STOP=1 -U postgres -d "$database_name" -c "ALTER ROLE ${owner_role} INHERIT" >/dev/null
run_failure 'Managed shard owner role attributes are not restricted'
docker exec "$postgres_id" psql -v ON_ERROR_STOP=1 -U postgres -d "$database_name" -c "ALTER ROLE ${owner_role} NOINHERIT" >/dev/null

docker exec "$postgres_id" psql -v ON_ERROR_STOP=1 -U postgres -d "$database_name" -c "GRANT eg_bootstrap_foreign TO ${runtime_role}" >/dev/null
run_failure 'Managed shard owner and runtime roles must have no role memberships'
docker exec "$postgres_id" psql -v ON_ERROR_STOP=1 -U postgres -d "$database_name" -c "REVOKE eg_bootstrap_foreign FROM ${runtime_role}" >/dev/null

owner_sql -c "GRANT SELECT ON ${schema_name}.users TO eg_bootstrap_foreign"
run_failure 'Managed shard relation has an unexpected grantee: users'
owner_sql -c "REVOKE SELECT ON ${schema_name}.users FROM eg_bootstrap_foreign"

owner_sql -c "GRANT REFERENCES (email) ON ${schema_name}.users TO eg_bootstrap_foreign"
run_failure 'Managed shard direct column privileges are forbidden'
owner_sql -c "REVOKE REFERENCES (email) ON ${schema_name}.users FROM eg_bootstrap_foreign"

owner_sql -c "ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema_name} GRANT SELECT ON TABLES TO eg_bootstrap_foreign"
run_failure 'Managed shard runtime default privileges drifted'
owner_sql -c "ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema_name} REVOKE SELECT ON TABLES FROM eg_bootstrap_foreign"

owner_sql -c "ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema_name} GRANT INSERT ON TABLES TO ${runtime_role}"
run_failure 'Managed shard runtime default privileges drifted'
owner_sql -c "ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema_name} REVOKE INSERT ON TABLES FROM ${runtime_role}"

owner_sql -c "DELETE FROM ${schema_name}.migrations WHERE timestamp=1700000000130 AND name='AddReleaseAwarePluginWork1700000000130'"
run_failure 'Executed ledger is not the exact signed 0130 migration inventory'
owner_sql -c "INSERT INTO ${schema_name}.migrations(timestamp,name) VALUES (1700000000130,'AddReleaseAwarePluginWork1700000000130')"

owner_sql -c "TRUNCATE ${schema_name}.migrations"
run_failure 'Managed shard has database objects without a populated migration ledger'

echo '[managed-shard-bootstrap] Real PostgreSQL bootstrap, idempotence, receipt, and drift rejections passed.'
