#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"

ENV_FILE=""
MODE="generic"
AUTO_INSTALL_DRIVERS="true"

log() { echo "[db-preflight] $*"; }
warn() { echo "[db-preflight] WARNING: $*"; }
fail() { echo "[db-preflight] ERROR: $*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage: bash ./scripts/db-preflight.sh --env-file <path> [--mode docker|localhost] [--install-drivers true|false]
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file)
      ENV_FILE="$2"
      shift 2
      ;;
    --mode)
      MODE="$2"
      shift 2
      ;;
    --install-drivers)
      AUTO_INSTALL_DRIVERS="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      fail "Unknown argument: $1"
      ;;
  esac
done

if [[ -z "$ENV_FILE" ]]; then
  fail "--env-file is required"
fi

if [[ ! -f "$ENV_FILE" ]]; then
  fail "Env file not found: $ENV_FILE"
fi

set -a
source "$ENV_FILE"
set +a

DB_TYPE="${DATABASE_TYPE:-postgres}"

require_var() {
  local NAME="$1"
  local VALUE="${!NAME:-}"
  if [[ -z "$VALUE" ]]; then
    fail "$NAME is required when DATABASE_TYPE=$DB_TYPE"
  fi
}

postgres_schema() {
  if [[ -n "${POSTGRES_SCHEMA:-}" ]]; then
    printf '%s' "${POSTGRES_SCHEMA}"
    return 0
  fi

  if [[ -n "${POSTGRES_URL:-}" ]]; then
    node -e "try { const url = new URL(process.argv[1]); process.stdout.write(url.searchParams.get('schema') || ''); } catch {}" "${POSTGRES_URL}"
  fi
}

check_env_requirements() {
  case "$DB_TYPE" in
    postgres)
      if [[ -z "${POSTGRES_URL:-}" ]]; then
        require_var POSTGRES_HOST
        require_var POSTGRES_USER
        require_var POSTGRES_PASSWORD
        require_var POSTGRES_DATABASE
      fi
      local POSTGRES_SCHEMA_VALUE
      POSTGRES_SCHEMA_VALUE="$(postgres_schema)"
      if [[ -z "$POSTGRES_SCHEMA_VALUE" || "$POSTGRES_SCHEMA_VALUE" == "public" ]]; then
        fail "POSTGRES_SCHEMA cannot be public for schema mode."
      fi
      ;;
    oracle)
      require_var ORACLE_USER
      require_var ORACLE_PASSWORD
      if [[ -z "${ORACLE_CONNECTION_STRING:-}" ]]; then
        require_var ORACLE_HOST
      fi
      if [[ -z "${ORACLE_CONNECTION_STRING:-}" && -z "${ORACLE_SERVICE_NAME:-}" && -z "${ORACLE_SID:-}" ]]; then
        fail "Either ORACLE_SERVICE_NAME or ORACLE_SID is required for Oracle."
      fi
      ;;
    mysql)
      require_var MYSQL_HOST
      require_var MYSQL_USER
      require_var MYSQL_PASSWORD
      require_var MYSQL_DATABASE
      ;;
    mssql)
      require_var MSSQL_HOST
      require_var MSSQL_USER
      require_var MSSQL_PASSWORD
      require_var MSSQL_DATABASE
      ;;
    spanner)
      require_var SPANNER_PROJECT_ID
      require_var SPANNER_INSTANCE_ID
      require_var SPANNER_DATABASE_ID
      ;;
    *)
      fail "Unsupported DATABASE_TYPE=$DB_TYPE"
      ;;
  esac
}

driver_for_db() {
  case "$DB_TYPE" in
    postgres) echo "pg" ;;
    oracle) echo "oracledb" ;;
    mysql) echo "mysql2" ;;
    mssql) echo "mssql" ;;
    spanner) echo "@google-cloud/spanner" ;;
  esac
}

has_package() {
  local PKG="$1"
  (cd "$BACKEND_DIR" && node -e "require.resolve(process.argv[1]);" "$PKG") >/dev/null 2>&1
}

install_driver_if_missing() {
  local PKG
  PKG="$(driver_for_db)"

  if has_package "$PKG"; then
    log "Driver present: $PKG"
    return 0
  fi

  if [[ "$AUTO_INSTALL_DRIVERS" != "true" ]]; then
    fail "Missing DB driver $PKG in backend. Install with: npm --prefix backend install --include=dev --no-audit --no-fund --no-save --package-lock=false $PKG"
  fi

  log "Installing missing DB driver: $PKG"
  npm --prefix "$BACKEND_DIR" install --include=dev --no-audit --no-fund --no-save --package-lock=false "$PKG"
}

oracle_native_check() {
  if [[ "$DB_TYPE" != "oracle" ]]; then
    return 0
  fi

  if ! (cd "$BACKEND_DIR" && node -e "try { require('oracledb'); process.exit(0); } catch (e) { console.error(e && e.message ? e.message : e); process.exit(1); }") >/dev/null 2>&1; then
    fail "Oracle driver installed but not loadable. Ensure Oracle Instant Client is installed/configured. See: https://oracle.github.io/node-oracledb/INSTALL.html"
  fi
}

case "$MODE" in
  docker)
    log "Running Docker preflight for DATABASE_TYPE=$DB_TYPE"
    ;;
  localhost)
    log "Running localhost preflight for DATABASE_TYPE=$DB_TYPE"
    ;;
  generic)
    log "Running preflight for DATABASE_TYPE=$DB_TYPE"
    ;;
  *)
    fail "Unsupported mode: $MODE"
    ;;
esac

check_env_requirements
install_driver_if_missing
oracle_native_check

log "Preflight checks passed for DATABASE_TYPE=$DB_TYPE"
