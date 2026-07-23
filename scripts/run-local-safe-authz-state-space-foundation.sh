#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# This contract imports application configuration but never needs a database.
# Force loopback-only values so a developer shell or dotenv file cannot select
# any self-hosted endpoint while the production registries are loaded.
unset DATABASE_TYPE DATABASE_URL POSTGRES_URL POSTGRES_HOST POSTGRES_PORT POSTGRES_USER
unset POSTGRES_PASSWORD POSTGRES_DATABASE POSTGRES_SCHEMA POSTGRES_SSL
unset POSTGRES_SSL_REJECT_UNAUTHORIZED JWT_SECRET ADMIN_PASSWORD ENCRYPTION_KEY
unset FRONTEND_URL
export EG_ENV_FILE="$repo_root/scripts/local-safe-test.env"

pnpm --dir backend exec vitest run \
  __tests__/shared/authz/authorizationStateSpaceContracts.test.ts \
  --config vitest.config.ts \
  --maxWorkers=1 \
  --no-file-parallelism \
  --reporter=dot
