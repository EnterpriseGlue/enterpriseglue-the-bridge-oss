#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
stack_env_file="${EG_BACKEND_ENV_FILE:-$repo_root/.env.docker}"
compose_file="$repo_root/infra/docker/compose/docker-compose.yml"

# This integration slice writes disposable rows, so it must never inherit a
# self-hosted database endpoint from a developer shell or dotenv file.
unset DATABASE_TYPE POSTGRES_URL POSTGRES_HOST POSTGRES_PORT POSTGRES_USER
unset POSTGRES_PASSWORD POSTGRES_DATABASE POSTGRES_SCHEMA POSTGRES_SSL
unset POSTGRES_SSL_REJECT_UNAUTHORIZED JWT_SECRET ADMIN_PASSWORD ENCRYPTION_KEY
unset FRONTEND_URL
export EG_ENV_FILE="$repo_root/scripts/local-safe-test.env"

if [[ ! -f "$stack_env_file" || ! -f "$compose_file" ]]; then
  echo "[custom-role-matrix] Local Docker configuration is unavailable." >&2
  exit 2
fi

# Read credentials only from the repository's local Compose environment, then
# replace its in-network host with the published loopback port. This is the
# same database boundary used by the seeded browser suite.
set -a
. "$stack_env_file"
set +a
db_endpoint="$(docker compose --project-directory "$repo_root" --env-file "$stack_env_file" -f "$compose_file" port db 5432 | sed -n '1p')"
if [[ -z "$db_endpoint" ]]; then
  echo "[custom-role-matrix] The local Compose database is not running." >&2
  exit 2
fi
export POSTGRES_HOST=127.0.0.1
export POSTGRES_PORT="${db_endpoint##*:}"

pnpm --dir backend exec vitest run test/integration/machine-principal-authz.test.ts test/integration/custom-role-scope-matrix.test.ts test/integration/authorization-model-randomized.test.ts \
  --config vitest.config.ts --maxWorkers=1 --no-file-parallelism --reporter=dot
