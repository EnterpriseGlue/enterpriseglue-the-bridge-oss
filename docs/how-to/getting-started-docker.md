# Getting Started (Docker Quickstart)

Summary: Run the EnterpriseGlue platform locally using Docker Compose.

Audience: Developers and architects.

## Prerequisites
- Docker Desktop (or Docker Engine)
- Docker Compose plugin (`docker compose`)

## Steps (Dev)
1. Start the stack (Postgres default):
   ```bash
   npm run dev
   ```
   - If `.local/docker/env/docker.env` does not exist, it is auto-created from `infra/docker/env/examples/docker.postgres.env.example`.
2. Open the app:
   - Frontend: http://localhost:5173 (default)
   - Backend: http://localhost:8787 (default when `EXPOSE_BACKEND=true`)
   - If `EXPOSE_BACKEND=false`, call backend via frontend origin (for example `http://localhost:5173/api/...`).
3. Log in with the admin credentials from the active env file:
   - `ADMIN_EMAIL`
   - `ADMIN_PASSWORD`
   - Optional: set `ADMIN_EMAIL_VERIFICATION_EXEMPT=true` to allow the seeded admin to bypass email verification

## One-click database selection (Dev)
Use `--db` to launch with another database:

```bash
npm run dev -- --db mysql
npm run dev -- --db mssql
npm run dev -- --db oracle
npm run dev -- --db spanner
```

What happens automatically:
- `dev.sh` creates `.local/docker/env/docker.<db>.env` from `infra/docker/env/examples/docker.<db>.env.example` when missing.
- `scripts/db-preflight.sh` validates required DB env variables.
- Missing DB driver packages are installed automatically for local development.
- Matching compose overlay is selected from `infra/docker/compose/` (`docker-compose.<db>.yml`).

## Steps (Production)
1. Copy the production env file:
   ```bash
   mkdir -p .local/docker/env
   cp infra/docker/env/examples/production.env.example .local/docker/env/production.env
   ```
2. Update production secrets in `.local/docker/env/production.env` (JWT, admin password, encryption key).
3. Keep `FRONTEND_URL` and `FRONTEND_HOST_PORT` aligned.
4. Keep `API_BASE_URL` empty for same-origin API calls through Nginx proxy.
5. Start the production stack:
   ```bash
   npm run prod
   ```
6. Open the app:
   - Frontend: http://localhost:8080 (default)
   - Backend is internal-only in production and is reached via proxied paths (for example `/api` and `/health`) on the frontend origin.

## Steps (Production from published images)
Use this when you want deployment from registry images without local source builds:

1. Copy an image env template:
   ```bash
   mkdir -p .local/docker/env
   cp infra/docker/env/examples/images.postgres.env.example .local/docker/env/images.postgres.env
   # or
   cp infra/docker/env/examples/images.oracle.env.example .local/docker/env/images.oracle.env
   ```
2. Set image refs in the copied file:
   - `BACKEND_IMAGE`
   - `FRONTEND_IMAGE`
   - `IMAGE_TAG` (`sha-<commit>` or `vX.Y.Z`)
3. Start from images:
   ```bash
   npm run prod:images:postgres
   # or
   npm run prod:images:oracle
   ```
4. Roll back by changing `IMAGE_TAG` to a previous working tag and re-running the same command.

## Stop the stack
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

```bash
npm run prod:images:postgres:down
npm run prod:images:oracle:down
```

## Notes
- Docker uses a PostgreSQL container by default (see `.local/docker/env/docker.env` / `.local/docker/env/production.env`).
- Docker dev serves frontend through Nginx (production-parity pathing and proxy behavior).
- Frontend source changes in Docker dev require rebuilding the frontend image (`npm run dev` already runs with `--build`).
- Git repositories are stored at `./data/repos` inside the backend container.
- To change ports or database settings, update the active env file.
- If email verification is enabled, configure `RESEND_API_KEY` to receive verification links.

## Non-Docker local deployment
For a localhost deployment (build + preview) using the production-style script, see:
- [Localhost Deployment (First-time install)](deploy-localhost.md)
  - First-time installs should use `--first-time` to apply migrations.
