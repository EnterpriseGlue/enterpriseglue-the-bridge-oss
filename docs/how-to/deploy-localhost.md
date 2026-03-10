# Localhost Deployment (Host-Based Production-Style Run)

Summary: Run a host-based production-style build locally using the `deploy-localhost.sh` script.

Audience: Developers and architects.

## When to use this
- You want a local “production-style” build (compiled backend + built frontend preview).
- You are not using Docker Compose, or want to validate the production build pipeline locally.

## Prerequisites
- Node.js (LTS recommended)
- npm
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

If email verification is enabled, configure `RESEND_API_KEY` to receive verification links or set `ADMIN_EMAIL_VERIFICATION_EXEMPT=true` for the seeded admin account.

## Incremental deploy (after first install)

```bash
bash ./scripts/deploy-localhost.sh
```

Use this for faster rebuilds when dependencies are already installed.

## What the script does
- Stops any running services on backend/frontend ports (defaults: `8787` and `5173`)
- Validates backend and frontend environment variables
- Uses the repo root `package-lock.json` when the repo is installed as an npm workspace
- Builds backend and frontend
- Starts backend (`node dist/backend/src/server.js`) and frontend preview (`npm run preview`)
- Verifies health (`/health`)

## Database migrations
- For first-time installs, pass `--first-time` to run migrations before startup.
- Without `--first-time`, migrations run automatically when the backend starts.
- Ensure `POSTGRES_*` settings are correct and the database is reachable.

If you need to run migrations manually (e.g., to verify before startup):

```bash
cd backend
npm run build:skip-generate
npm run db:migration:run
```

## Access URLs
- Backend: http://localhost:8787 (default, from `API_PORT`)
- Backend health: http://localhost:8787/health (default)
- Frontend: http://localhost:5173 (default)
- Login: http://localhost:5173/login (default)

## Logs
- Backend: `tail -f backend/server.log`
- Frontend: `tail -f frontend/preview.log`

## Troubleshooting
- If you see missing env errors, update `backend/.env` or `frontend/.env.local`.
- If ports are in use, stop conflicting services or change ports.
- For database errors in tests, see [Troubleshooting](troubleshooting.md).
