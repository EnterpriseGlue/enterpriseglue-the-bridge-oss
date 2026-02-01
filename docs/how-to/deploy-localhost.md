# Localhost Deployment (First-time install)

Summary: Run a production-style build locally using the `deploy-localhost.sh` script.

Audience: Developers and architects.

## When to use this
- You want a local “production-style” build (compiled backend + built frontend preview).
- You are not using Docker, or want to validate the production build pipeline locally.

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
- `VITE_API_BASE_URL`

## First-time install (recommended)

From the repo root:

```bash
# Full rebuild (cleans node_modules and dist folders)
bash ./scripts/deploy-localhost.sh --full --first-time
```

This will:
- Validate required backend/frontend env vars
- Build backend (`backend/dist`)
- Build frontend (`frontend/dist`)
- Start backend and frontend preview services
- Apply database migrations automatically on backend startup (using your `backend/.env` settings)

If email verification is enabled, configure `RESEND_API_KEY` to receive verification links or set `ADMIN_EMAIL_VERIFICATION_EXEMPT=true` for the seeded admin account.

## Incremental deploy (after first install)

```bash
bash ./scripts/deploy-localhost.sh
```

Use this for faster rebuilds when dependencies are already installed.

## What the script does
- Stops any running services on ports `8787` and `5173`
- Validates backend and frontend environment variables
- Builds backend and frontend
- Starts backend (`node dist/src/server.js`) and frontend preview (`npm run preview`)
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
- Backend: http://localhost:8787
- Backend health: http://localhost:8787/health
- Frontend: http://localhost:5173
- Login: http://localhost:5173/login

## Logs
- Backend: `tail -f backend/server.log`
- Frontend: `tail -f frontend/preview.log`

## Troubleshooting
- If you see missing env errors, update `backend/.env` or `frontend/.env.local`.
- If ports are in use, stop conflicting services or change ports.
- For database errors in tests, see [Troubleshooting](troubleshooting.md).
