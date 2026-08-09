#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Unit and contract lanes may import the application configuration. Do not let
# a developer's shell, .env, or .env.selfhost redirect those imports to a real
# database. Docker/integration scripts establish their own explicit settings.
unset DATABASE_TYPE POSTGRES_URL POSTGRES_HOST POSTGRES_PORT POSTGRES_USER
unset POSTGRES_PASSWORD POSTGRES_DATABASE POSTGRES_SCHEMA POSTGRES_SSL
unset POSTGRES_SSL_REJECT_UNAUTHORIZED JWT_SECRET ADMIN_PASSWORD ENCRYPTION_KEY
unset FRONTEND_URL
export EG_ENV_FILE="$repo_root/scripts/local-safe-test.env"

pnpm run test:authz:structure
pnpm run test:authz:identity
pnpm run test:authz:config
pnpm run test:authz:runtime
