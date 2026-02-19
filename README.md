# EnterpriseGlue Platform

Summary: Docker-first platform for process and decision modeling, deployment, and
operations across Starbase and Mission Control modules.

Audience: Developers and architects.

## Quickstart (Docker - Dev)
1. Copy the Docker env file:
   ```bash
   cp .env.docker.example .env.docker
   ```
2. Start the stack:
   ```bash
   npm run dev
   ```
3. Open the app:
   - Frontend: http://localhost:5173 (default)
   - Backend: http://localhost:8787 (default when `EXPOSE_BACKEND=true`)
   - If `EXPOSE_BACKEND=false`, call backend through frontend origin (for example `http://localhost:5173/api/...`).
   - Ports are configurable in `.env.docker`.
   - Docker dev serves frontend via Nginx for production-parity routing.

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

Admin credentials come from the active env file (`.env.docker` for dev, `.env.production` for prod).
Optional: set `ADMIN_EMAIL_VERIFICATION_EXEMPT=true` to allow the seeded admin to bypass email verification.

## Stop
```bash
npm run down
```

```bash
npm run prod:down
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
