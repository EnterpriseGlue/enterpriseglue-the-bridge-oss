#!/usr/bin/env bash
set -Eeuo pipefail

# Production deploy script for EnterpriseGlue
# - Gracefully stops frontend (Vite) and backend (API)
# - Validates environment configuration
# - Runs database migrations (PostgreSQL)
# - Builds backend (ts -> dist) and frontend (vite build)
# - Restarts backend and serves built frontend via Vite preview
#
# Usage:
#   bash ./scripts/deploy-localhost.sh                     # Incremental build (reuses node_modules)
#   bash ./scripts/deploy-localhost.sh --full              # Full rebuild (clean node_modules, dist, reinstall)
#   bash ./scripts/deploy-localhost.sh --first-time        # Run migrations before startup
#   bash ./scripts/deploy-localhost.sh --full --first-time # Full rebuild + migrations
#   npm run deploy:localhost -- --full                     # Same as above, via npm

# Parse arguments
FULL_REBUILD=false
RUN_MIGRATIONS=false
while [[ $# -gt 0 ]]; do
  case $1 in
    --full|-f)
      FULL_REBUILD=true
      shift
      ;;
    --first-time|--init|--migrate|-i)
      RUN_MIGRATIONS=true
      shift
      ;;
    --help|-h)
      echo "Usage: $0 [--full|-f]"
      echo "  --full, -f        Clean rebuild (remove node_modules, dist, reinstall deps)"
      echo "  --first-time, -i  Run DB migrations before startup"
      echo "  --help, -h        Show this help message"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      echo "Use --help for usage information"
      exit 1
      ;;
  esac
done

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"

BACKEND_PORT=${API_PORT:-8787}
FRONTEND_PORT=5173
PREVIEW_PORT=5173

log() { echo "[deploy] $*"; }
warn() { echo "[deploy] ⚠️  $*"; }
error() { echo "[deploy] ❌ $*"; exit 1; }

clean_build_artifacts() {
  log "🧹 Cleaning build artifacts for full rebuild..."
  
  # Clean backend
  if [[ -d "$BACKEND_DIR/node_modules" ]]; then
    log "Removing backend/node_modules"
    rm -rf "$BACKEND_DIR/node_modules"
  fi
  if [[ -d "$BACKEND_DIR/dist" ]]; then
    log "Removing backend/dist"
    rm -rf "$BACKEND_DIR/dist"
  fi
  
  # Clean frontend
  if [[ -d "$FRONTEND_DIR/node_modules" ]]; then
    log "Removing frontend/node_modules"
    rm -rf "$FRONTEND_DIR/node_modules"
  fi
  if [[ -d "$FRONTEND_DIR/dist" ]]; then
    log "Removing frontend/dist"
    rm -rf "$FRONTEND_DIR/dist"
  fi
  # Clean Vite cache (if exists outside node_modules)
  if [[ -d "$FRONTEND_DIR/.vite" ]]; then
    log "Removing frontend/.vite cache"
    rm -rf "$FRONTEND_DIR/.vite"
  fi
  # Clean TypeScript build info
  if [[ -f "$FRONTEND_DIR/tsconfig.tsbuildinfo" ]]; then
    log "Removing frontend/tsconfig.tsbuildinfo"
    rm -f "$FRONTEND_DIR/tsconfig.tsbuildinfo"
  fi
  if [[ -f "$BACKEND_DIR/tsconfig.tsbuildinfo" ]]; then
    log "Removing backend/tsconfig.tsbuildinfo"
    rm -f "$BACKEND_DIR/tsconfig.tsbuildinfo"
  fi
  
  # Optional: clean npm cache (uncomment if needed)
  # log "Cleaning npm cache"
  # npm cache clean --force
  
  log "✅ Build artifacts cleaned"
}

check_env() {
  log "Checking environment configuration..."
  
  # Check if .env exists in backend
  if [[ ! -f "$BACKEND_DIR/.env" ]]; then
    error ".env file not found in backend/. Copy from .env.example and configure."
  fi
  
  # Source .env for validation
  set -a
  source "$BACKEND_DIR/.env"
  set +a
  
  # Required for production
  local REQUIRED_VARS=(
    "JWT_SECRET"
    "ADMIN_EMAIL"
    "ADMIN_PASSWORD"
    "NODE_ENV"
  )
  
  local MISSING_VARS=()
  for VAR in "${REQUIRED_VARS[@]}"; do
    if [[ -z "${!VAR:-}" ]]; then
      MISSING_VARS+=("$VAR")
    fi
  done
  
  if [[ ${#MISSING_VARS[@]} -gt 0 ]]; then
    error "Missing required environment variables: ${MISSING_VARS[*]}"
  fi
  
  # Check production JWT secret
  if [[ "$NODE_ENV" == "production" ]] && [[ "$JWT_SECRET" == *"change"* ]]; then
    error "JWT_SECRET must be changed for production! Generate: openssl rand -base64 32"
  fi
  
  # Warn about optional features
  if [[ -z "${RESEND_API_KEY:-}" ]]; then
    warn "Email not configured (env) - configure via Admin UI or set RESEND_API_KEY"
  fi
  
  if [[ -z "${MICROSOFT_CLIENT_ID:-}" ]]; then
    warn "Microsoft Entra ID not configured - SSO will not be available"
  else
    log "✅ Microsoft Entra ID configured"
    # Validate Entra ID config is complete
    if [[ -z "${MICROSOFT_CLIENT_SECRET:-}" ]] || [[ -z "${MICROSOFT_TENANT_ID:-}" ]]; then
      error "Incomplete Microsoft Entra ID configuration. Need CLIENT_ID, CLIENT_SECRET, and TENANT_ID"
    fi
    
    # Check production redirect URI
    if [[ "$NODE_ENV" == "production" ]] && [[ "${MICROSOFT_REDIRECT_URI:-}" == *"localhost"* ]]; then
      error "MICROSOFT_REDIRECT_URI must use production domain (not localhost)"
    fi
  fi
  
  log "✅ Environment configuration valid"
}

check_frontend_env() {
  log "Checking frontend environment configuration..."

  local FRONTEND_ENV_FILE=""
  local CANDIDATES=(
    ".env"
    ".env.local"
    ".env.production"
    ".env.production.local"
  )

  for F in "${CANDIDATES[@]}"; do
    if [[ -f "$FRONTEND_DIR/$F" ]]; then
      FRONTEND_ENV_FILE="$FRONTEND_DIR/$F"
      break
    fi
  done

  if [[ -n "$FRONTEND_ENV_FILE" ]]; then
    set -a
    source "$FRONTEND_ENV_FILE"
    set +a
  else
    warn "No frontend env file found in frontend/. Relying on current environment for VITE_* variables"
  fi

  local REQUIRED_VARS=(
    "VITE_API_BASE_URL"
  )

  local MISSING_VARS=()
  for VAR in "${REQUIRED_VARS[@]}"; do
    if [[ -z "${!VAR:-}" ]]; then
      MISSING_VARS+=("$VAR")
    fi
  done

  if [[ ${#MISSING_VARS[@]} -gt 0 ]]; then
    error "Missing required frontend environment variables: ${MISSING_VARS[*]}"
  fi

  if [[ "$VITE_API_BASE_URL" != /* ]] && [[ "$VITE_API_BASE_URL" != http://* ]] && [[ "$VITE_API_BASE_URL" != https://* ]]; then
    error "VITE_API_BASE_URL must be an absolute URL (http/https) or start with '/'"
  fi

  if [[ "${NODE_ENV:-}" == "production" ]] && [[ "$VITE_API_BASE_URL" == *"localhost"* ]]; then
    error "VITE_API_BASE_URL must use production domain (not localhost)"
  fi

  local bad_feature_vars=()
  local var
  local val
  while IFS= read -r var; do
    if [[ "$var" == VITE_FEATURE_* ]]; then
      val="${!var:-}"
      if [[ -n "$val" ]]; then
        case "$(echo "$val" | tr '[:upper:]' '[:lower:]' | xargs)" in
          true|false|1|0|yes|no|on|off) ;;
          *) bad_feature_vars+=("$var");;
        esac
      fi
    fi
  done < <(compgen -v)

  if [[ ${#bad_feature_vars[@]} -gt 0 ]]; then
    error "Invalid VITE_FEATURE_* values (must be true/false/1/0/yes/no/on/off): ${bad_feature_vars[*]}"
  fi

  log "✅ Frontend environment configuration valid"
}

check_database() {
  log "Checking PostgreSQL configuration..."
  
  # Check if PostgreSQL is configured
  if [[ -z "${POSTGRES_HOST:-}" ]]; then
    error "POSTGRES_HOST not set. PostgreSQL is required."
  fi
  
  log "✅ PostgreSQL configured: ${POSTGRES_HOST}:${POSTGRES_PORT:-5432}"
}

run_migrations() {
  if [[ "$RUN_MIGRATIONS" == "true" ]]; then
    log "Running database schema sync + migrations (first-time install)"
    (cd "$BACKEND_DIR" && npm run db:schema:sync)
    log "✅ Database schema synced"
    (cd "$BACKEND_DIR" && npm run db:migration:run)
    log "✅ Database migrations completed"
  else
    log "Database migrations will run automatically on backend startup"
    log "✅ Database migrations ready (will execute on startup)"
  fi
}

kill_port() {
  local PORT="$1"
  local PIDS
  if PIDS=$(lsof -ti tcp:"$PORT" 2>/dev/null) && [[ -n "$PIDS" ]]; then
    log "Sending SIGINT to processes on port $PORT: $PIDS"
    # Send SIGINT for graceful shutdown (backend will persist DB on SIGINT)
    kill -s SIGINT $PIDS || true
    # Wait up to 10s for ports to free
    for i in {1..20}; do
      if lsof -ti tcp:"$PORT" >/dev/null 2>&1; then
        sleep 0.5
      else
        break
      fi
    done
    # Force kill if still alive
    if lsof -ti tcp:"$PORT" >/dev/null 2>&1; then
      log "Force killing processes on port $PORT"
      kill -9 $PIDS || true
    fi
  else
    log "No process found on port $PORT"
  fi
}

build_backend() {
  local MSAL_DIST="$BACKEND_DIR/node_modules/@azure/msal-node/dist/index.d.ts"
  if [[ ! -d "$BACKEND_DIR/node_modules" ]]; then
    log "Installing backend deps (including devDependencies for build)"
    (cd "$BACKEND_DIR" && npm install --include=dev --no-audit --no-fund)
  elif [[ ! -f "$MSAL_DIST" ]]; then
    warn "Backend deps appear incomplete (missing @azure/msal-node dist). Cleaning cache and reinstalling..."
    rm -rf "$BACKEND_DIR/node_modules"
    (cd "$BACKEND_DIR" && npm cache clean --force)
    (cd "$BACKEND_DIR" && npm install --include=dev --no-audit --no-fund --prefer-online)
  else
    log "Backend dependencies already installed (offline mode)"
  fi
  
  # Always clean dist to ensure fresh build (avoids stale incremental compilation)
  if [[ -d "$BACKEND_DIR/dist" ]]; then
    log "Cleaning backend/dist for fresh build"
    rm -rf "$BACKEND_DIR/dist"
  fi
  
  log "Building backend (tsc only)"
  (cd "$BACKEND_DIR" && npm run build:skip-generate)
}

build_frontend() {
  if [[ ! -d "$FRONTEND_DIR/node_modules" ]]; then
    log "Installing frontend deps (including devDependencies for build)"
    (cd "$FRONTEND_DIR" && npm install --include=dev --no-audit --no-fund)
  else
    log "Frontend dependencies already installed (offline mode)"
  fi
  
  log "Building frontend (vite build)"
  (cd "$FRONTEND_DIR" && npm run build)
}

start_backend() {
  log "Starting backend on :$BACKEND_PORT"
  (cd "$BACKEND_DIR" && nohup node dist/server.js > server.log 2>&1 &)
}

start_frontend() {
  log "Starting frontend preview on :$PREVIEW_PORT"
  (cd "$FRONTEND_DIR" && nohup npm run preview -- --port "$PREVIEW_PORT" > preview.log 2>&1 &)
}

verify_deployment() {
  log "Verifying deployment..."
  
  # Wait for backend to start
  local MAX_WAIT=30
  local WAITED=0
  
  while ! curl -sf "http://localhost:${BACKEND_PORT}/health" >/dev/null 2>&1; do
    if [[ $WAITED -ge $MAX_WAIT ]]; then
      error "Backend health check failed after ${MAX_WAIT}s"
    fi
    sleep 1
    ((WAITED++))
  done
  
  log "✅ Backend health check passed"
  
  # Check if admin user was created
  local HEALTH_RESPONSE
  HEALTH_RESPONSE=$(curl -sf "http://localhost:${BACKEND_PORT}/health")
  if echo "$HEALTH_RESPONSE" | grep -q "ok"; then
    log "✅ Backend is healthy"
  else
    warn "Backend health response unexpected: $HEALTH_RESPONSE"
  fi
  
  log "✅ Deployment verified"
}

print_summary() {
  log "=========================================="
  log "🚀 EnterpriseGlue Deployment Complete!"
  log "=========================================="
  log ""
  log "Backend:     http://localhost:${BACKEND_PORT}"
  log "Health:      http://localhost:${BACKEND_PORT}/health"
  log "Frontend:    http://localhost:${PREVIEW_PORT}"
  log "Login:       http://localhost:${PREVIEW_PORT}/login"
  log ""
  log "Admin Account:"
  log "  Email:     ${ADMIN_EMAIL:-not set}"
  log "  Password:  (from .env ADMIN_PASSWORD)"
  log ""
  
  if [[ -n "${MICROSOFT_CLIENT_ID:-}" ]]; then
    log "✅ Microsoft Entra ID: Enabled"
  else
    log "⚠️  Microsoft Entra ID: Not configured"
  fi
  
  if [[ -n "${RESEND_API_KEY:-}" ]]; then
    log "✅ Email Service: Enabled (env: Resend)"
  else
    log "⚠️  Email Service: Not configured via env (configure in Admin UI → Platform Settings → Email)"
  fi
  
  log ""
  log "Logs:"
  log "  Backend:   tail -f backend/server.log"
  log "  Frontend:  tail -f frontend/preview.log"
  log "=========================================="
}

main() {
  log "=========================================="
  log "Starting EnterpriseGlue Production Deployment"
  if [[ "$FULL_REBUILD" == "true" ]]; then
    log "Mode: FULL REBUILD (clean install)"
  else
    log "Mode: Incremental (use --full for clean rebuild)"
  fi
  log "=========================================="
  
  # Pre-deployment checks
  check_env
  check_frontend_env
  check_database
  
  # Clean if full rebuild requested
  if [[ "$FULL_REBUILD" == "true" ]]; then
    clean_build_artifacts
  fi
  
  # Stop running services
  log "Stopping frontend/backends"
  kill_port "$FRONTEND_PORT"
  kill_port "$PREVIEW_PORT"
  kill_port "$BACKEND_PORT"

  # Build applications
  log "Building apps"
  build_backend
  build_frontend
  
  # Prepare migrations
  run_migrations

  # Start services
  log "Starting apps"
  start_backend
  start_frontend
  
  # Verify deployment
  verify_deployment
  
  # Print summary
  print_summary
}

main "$@"
