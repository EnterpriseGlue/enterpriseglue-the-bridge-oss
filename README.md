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
   On first run, if `.local/docker/env/docker.env` is missing, it is created from `infra/docker/env/examples/docker.postgres.env.example`.
2. Open the app:
   - Frontend: http://localhost:5173 (default)
   - Backend: http://localhost:8787 (default when `EXPOSE_BACKEND=true`)
   - If `EXPOSE_BACKEND=false`, call backend through frontend origin (for example `http://localhost:5173/api/...`).
   - Ports are configurable in the active env file (`.local/docker/env/docker.env` by default).
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
- On first run for a DB, `.local/docker/env/docker.<db>.env` is auto-created from `infra/docker/env/examples/docker.<db>.env.example`.
- `dev.sh` runs `scripts/db-preflight.sh` to validate env requirements and install missing DB drivers.
- Docker compose automatically includes the matching DB overlay from `infra/docker/compose/` (`docker-compose.<db>.yml`).

## Production (Docker Compose)
1. Copy the production env file:
   ```bash
   mkdir -p .local/docker/env
   cp infra/docker/env/examples/production.env.example .local/docker/env/production.env
   ```
2. Update secrets in `.local/docker/env/production.env` (JWT, admin password, encryption key).
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
   mkdir -p .local/docker/env
   cp infra/docker/env/examples/images.postgres.env.example .local/docker/env/images.postgres.env
   # or
   cp infra/docker/env/examples/images.oracle.env.example .local/docker/env/images.oracle.env
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

Admin credentials come from the active env file (`.local/docker/env/docker.env` for dev, `.local/docker/env/production.env` for prod).
Optional: set `ADMIN_EMAIL_VERIFICATION_EXEMPT=true` to allow the seeded admin to bypass email verification.

## OpenShift deployment assets
- Kustomize base and overlays:
  - `infra/kubernetes/openshift/kustomize/base/`
  - `infra/kubernetes/openshift/kustomize/overlays/{dev,staging,prod}`
- OpenShift examples:
  - `infra/kubernetes/openshift/examples/`
- OpenShift env template:
  - `infra/docker/env/examples/openshift.env.example`
- Deploy entrypoint:
  - `npm run deploy:openshift`
  - Optional overlay selector: `OPENSHIFT_OVERLAY=staging npm run deploy:openshift`

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
- [OpenShift Deployment](docs/how-to/deploy-openshift.md)
- [Configuration Reference](docs/reference/configuration.md)
- [Platform Modules Overview](docs/explanation/platform-modules.md)

## Modules (High-Level)
- **Voyager**: UI shell and feature modules.
- **Starbase**: Projects, files, versions, deployments.
- **Mission Control**: Camunda processes, instances, tasks, decisions.
- **Engines**: Engine management and connectivity.
- **Platform Admin**: Tenant settings and policy tooling.
- **Git Integration**: OAuth and repository connections.
