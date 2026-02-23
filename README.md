# EnterpriseGlue Platform

Summary: Docker-first platform for process and decision modeling, deployment, and
operations across Starbase and Mission Control modules.

Audience: Developers and architects.

## Quickstart (Docker - Dev)
### Fast path (Postgres default)
1. Start the stack:
   ```bash
   npm run dev
   ```
   On first run, if `.env.docker` is missing, it is created from `.env.docker.postgres.example`.
2. Open the app:
   - Frontend: http://localhost:5173 (default)
   - Backend: http://localhost:8787 (default when `EXPOSE_BACKEND=true`)
   - If `EXPOSE_BACKEND=false`, call backend through frontend origin (for example `http://localhost:5173/api/...`).
   - Ports are configurable in `.env.docker`.
   - Docker dev serves frontend via Nginx for production-parity routing.

### One-click alternative databases
Use a database selector for Docker dev:

```bash
npm run dev -- --db mysql
npm run dev -- --db mssql
npm run dev -- --db oracle
npm run dev -- --db spanner
```

Behavior:
- On first run for a DB, `.env.docker.<db>` is auto-created from `.env.docker.<db>.example`.
- `dev.sh` runs `scripts/db-preflight.sh` to validate env requirements and install missing DB drivers.
- Docker compose automatically includes the matching DB overlay from `infra/docker/compose/` (`docker-compose.<db>.yml`).

## Production (Docker Compose)
1. Copy the production env file:
   ```bash
   cp .env.production.example .env.production
   ```
2. Update secrets in `.env.production` (JWT, admin password, encryption key).
3. Start the production stack:
   ```bash
   npm run prod
   ```
4. Open the app:
   - Frontend: http://localhost:8080 (default)
   - Backend is internal-only in production and is reached via Nginx proxy routes (`/api`, `/starbase-api`, `/mission-control-api`, etc.)

### Production from published images (no local source build)
Use this mode when you want to run exactly what CI published:

1. Copy one image env template:
   ```bash
   cp .env.images.postgres.example .env.images.postgres
   # or
   cp .env.images.oracle.example .env.images.oracle
   ```
2. Set these in the copied env file:
   - `BACKEND_IMAGE`
   - `FRONTEND_IMAGE`
   - `IMAGE_TAG` (`sha-<commit>` or `vX.Y.Z`)
3. Start stack from images:
   ```bash
   npm run prod:images:postgres
   # or
   npm run prod:images:oracle
   ```
4. Roll back by changing only `IMAGE_TAG` and re-running the same command.

Admin credentials come from the active env file (`.env.docker` for dev, `.env.production` for prod).
Optional: set `ADMIN_EMAIL_VERIFICATION_EXEMPT=true` to allow the seeded admin to bypass email verification.

## Stop
```bash
npm run down
```

To stop a specific DB stack explicitly:

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

## Documentation
- [Developer/Architect Docs](docs/index.md)
- [Docker Deployment (Dev + Production)](docs/how-to/deploy-docker.md)
- [Configuration Reference](docs/reference/configuration.md)
- [Platform Modules Overview](docs/explanation/platform-modules.md)

## Modules (High-Level)
- **Voyager**: UI shell and feature modules.
- **Starbase**: Projects, files, versions, deployments.
- **Mission Control**: Camunda processes, instances, tasks, decisions.
- **Engines**: Engine management and connectivity.
- **Platform Admin**: Tenant settings and policy tooling.
- **Git Integration**: OAuth and repository connections.
