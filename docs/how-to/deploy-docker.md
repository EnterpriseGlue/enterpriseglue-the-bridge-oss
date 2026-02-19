# Docker Compose Deployment

Summary: Deploy EnterpriseGlue using the Docker Compose stack defined in the repo.

Audience: Developers and architects.

## Services (Dev)
The default `docker-compose.yml` defines:
- **db**: PostgreSQL 18 container
- **backend**: API service (TypeScript, runs migrations on startup)
- **frontend**: Nginx serving the built SPA and reverse-proxying API routes to backend

For non-Postgres Docker dev, `dev.sh` can add a DB-specific overlay file:
- `docker-compose.mysql.yml`
- `docker-compose.mssql.yml`
- `docker-compose.oracle.yml`
- `docker-compose.spanner.yml`

## Services (Production)
`docker-compose.prod.yml` defines:
- **db**: PostgreSQL 18 container
- **backend**: API service (production build, runs migrations on startup, internal-only)
- **frontend**: Nginx serving the built SPA and reverse-proxying API routes to backend

## Configuration (Dev)
1. Use one of these startup options:
   - Postgres default: `npm run dev`
   - Explicit DB: `npm run dev -- --db <postgres|mysql|mssql|oracle|spanner>`
2. Env file behavior:
   - If `.env.docker` is missing, `dev.sh` creates it from `.env.docker.postgres.example`.
   - If using `--db mysql` (or others) and `.env.docker.<db>` is missing, it is created from `.env.docker.<db>.example`.
3. `dev.sh` runs `scripts/db-preflight.sh` before compose startup to:
   - validate required DB env vars for the selected `DATABASE_TYPE`
   - install missing DB driver package when needed
   - fail fast with actionable errors (for example Oracle Instant Client guidance)
4. Configure ports in one place if needed:
   - `API_PORT` (backend container port)
   - `BACKEND_HOST_PORT` (backend host port)
   - `EXPOSE_BACKEND` (`true` to publish backend port on host, `false` for internal-only)
   - `FRONTEND_HOST_PORT` (frontend host port)
   - `POSTGRES_HOST_PORT` (PostgreSQL host port)
   - `dev.sh`/`down.sh` automatically include `docker-compose.backend-expose.yml` when `EXPOSE_BACKEND=true`.
5. Set `API_BASE_URL` only if you need an explicit API origin. Leave empty to use relative `/api` calls through the Nginx proxy.
6. Optional: set `ADMIN_EMAIL_VERIFICATION_EXEMPT=true` to allow the seeded admin to bypass email verification.

## Configuration (Production)
1. Copy `.env.production.example` to `.env.production`.
2. Set production secrets (`JWT_SECRET`, `ADMIN_PASSWORD`, `ENCRYPTION_KEY`).
3. Set `FRONTEND_HOST_PORT` and keep `FRONTEND_URL` in sync with that public URL.
4. Keep `API_BASE_URL` empty for default same-origin behavior (Nginx proxy). Set it only if frontend must call a different API origin.

Key defaults:
- Dev frontend: `http://localhost:5173`
- Dev backend: `http://localhost:8787` (when `EXPOSE_BACKEND=true`)
- Prod frontend: `http://localhost:8080`
- Prod backend: internal-only (accessed via frontend origin and proxied API paths)
- PostgreSQL exposed in dev via `POSTGRES_HOST_PORT`

## Start (Dev)
```bash
npm run dev
```

## Start (Production)
```bash
npm run prod
```

## Stop
```bash
npm run down
```

Stop a specific DB stack explicitly:

```bash
npm run down -- --db mysql
```

```bash
npm run prod:down
```

## Volumes
Docker creates persistent volumes for:
- `postgres_data` (database)
- `backend_node_modules` (dev only)
- `git_repos` (server-side git repositories)

## Notes
- Dev compose exposes PostgreSQL on `POSTGRES_HOST_PORT`; production does not expose the DB port by default.
- Production compose does not publish backend port by default; call backend through frontend origin (`/api`, `/starbase-api`, `/mission-control-api`, `/engines-api`, `/git-api`, `/vcs-api`).
- For a host-based production-style run, see `scripts/deploy-localhost.sh`.
- If email verification is enabled, configure `RESEND_API_KEY` to receive verification links.
