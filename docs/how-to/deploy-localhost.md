# Localhost Deployment (Host-Based Production-Style Run)

Summary: Run a host-based production-style build locally using the `deploy-localhost.sh` script.

Audience: Developers and architects.

## When to use this
- You want a local “production-style” build (compiled backend + built frontend preview).
- You are not using Docker Compose, or want to validate the production build pipeline locally.

## Prerequisites
- Node.js (LTS recommended)
- pnpm
- PostgreSQL accessible locally or remotely
- Backend and frontend environment files configured

## Required environment files

### Backend
Create `backend/.env` from `backend/.env.example` and configure at least:
- `JWT_SECRET`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- Optional: `ADMIN_EMAIL_VERIFICATION_EXEMPT=true` to allow the seeded admin (created from `ADMIN_EMAIL` on first run) to bypass email verification
- `NODE_ENV`
- `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DATABASE`, `POSTGRES_SCHEMA`

### Frontend
Create `frontend/.env.local` (or `.env`) with at least:
- `API_BASE_URL` (preferred) or `VITE_API_BASE_URL`

## First-time install (recommended)

From the repo root:

```bash
# Full rebuild (cleans node_modules and dist folders)
bash ./scripts/deploy-localhost.sh --full --first-time
```

This will:
- Validate required backend/frontend env vars
- Install workspace dependencies from the repo root lockfile when they are missing
- Install a missing DB driver into local `node_modules` when required by `DATABASE_TYPE`
- Build backend (`backend/dist`)
- Build frontend (`frontend/dist`)
- Start backend and frontend preview services
- Run database migrations before startup (using your `backend/.env` settings)

If email verification is enabled, seed the default email configuration with `EMAIL_*` variables in `backend/.env` or `.env.selfhost` so verification links work on first deploy. You can still set `ADMIN_EMAIL_VERIFICATION_EXEMPT=true` for the seeded admin account if needed.

### Optional authorization configuration bootstrap

Host-based deployments read the bundle directly instead of mounting it into a container. Set an absolute, readable JSON or ZIP path in `.env.selfhost` or `backend/.env`:

```dotenv
EG_CONFIG_BUNDLE_PATH=/srv/enterpriseglue/config/enterpriseglue.json
EG_CONFIG_BOOTSTRAP_MODE=validate
EG_CONFIG_EXPECTED_TENANT_SCOPE=platform
EG_CONFIG_FAIL_CLOSED=true
```

Use `validate` first, review `/health` and `/ready`, then change to `apply` only for an approved hash-bound startup apply. The deployment script rejects enabled bootstrap with a missing, relative, or unreadable `EG_CONFIG_BUNDLE_PATH`. Keep file-backed secrets outside the bundle and configure `EG_CONFIG_SECRET_FILE_ROOT` separately.

## Incremental deploy (after first install)

```bash
bash ./scripts/deploy-localhost.sh
```

Use this for faster rebuilds when dependencies are already installed.

## What the script does
- Stops any running services on backend/frontend ports (defaults: `8787` and `5173`)
- Validates backend and frontend environment variables
- Uses the repo root `pnpm-lock.yaml` when the repo is installed as a pnpm workspace
- Builds backend and frontend
- Starts backend (`node dist/backend/src/server.js`) and frontend preview (`pnpm run preview`)
- Verifies health (`/health`)

## Database migrations
- For first-time installs, pass `--first-time` to run migrations before startup.
- Without `--first-time`, migrations run automatically when the backend starts.
- Ensure `POSTGRES_*` settings are correct and the database is reachable.

If you need to run migrations manually (e.g., to verify before startup):

```bash
cd backend
pnpm run build:skip-generate
pnpm run db:migration:run
```

## Access URLs
- Backend: http://localhost:8787 (default, from `API_PORT`)
- Backend health: http://localhost:8787/health (default)
- Frontend: http://localhost:5173 (default)
- Login: http://localhost:5173/login (default)

## Optional local sign-in smoke

After the stack is healthy, verify a real login with an existing disposable
local account. This test never seeds a user or prints credentials, and accepts
only localhost, loopback, or `.local` URLs.

```bash
E2E_USER='local-admin@example.test' \
E2E_PASSWORD='your-local-password' \
PLAYWRIGHT_BASE_URL='http://localhost:5173' \
pnpm test:authz:local-smoke
```

This guarded local-only lane verifies both sign-in and that the authenticated
administrator can open the Access Control UI. The narrower
`test:authz:local-login` and `test:authz:local-access-control` commands remain
available for targeted reruns.

If Chromium is not installed for this workspace, run `pnpm exec playwright
install chromium` once. The command fails rather than skipping if either
credential is absent.

## Logs
- Backend: `tail -f backend/server.log`
- Frontend: `tail -f frontend/preview.log`

## Troubleshooting
- If you see missing env errors, update `backend/.env` or `frontend/.env.local`.
- If ports are in use, stop conflicting services or change ports.
- For database errors in tests, see [Troubleshooting](troubleshooting.md).
