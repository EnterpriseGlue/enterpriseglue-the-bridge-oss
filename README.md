# EnterpriseGlue Platform

Summary: Docker-first platform for process and decision modeling, deployment, and
operations across Starbase and Mission Control modules.

Audience: Developers and architects.

## Quickstart (Docker)
1. Copy the Docker env file:
   ```bash
   cp .env.docker.example .env.docker
   ```
2. Start the stack:
   ```bash
   npm run dev
   ```
3. Open the app:
   - Frontend: http://localhost:5173
   - Backend: http://localhost:8787

Admin credentials come from `.env.docker` (`ADMIN_EMAIL` / `ADMIN_PASSWORD`).
Optional: set `ADMIN_EMAIL_VERIFICATION_EXEMPT=true` to allow the seeded admin to bypass email verification.

## Stop
```bash
npm run down
```

## Documentation
- [Developer/Architect Docs](docs/index.md)
- [Docker Deployment](docs/how-to/deploy-docker.md)
- [Configuration Reference](docs/reference/configuration.md)
- [Platform Modules Overview](docs/explanation/platform-modules.md)

## Modules (High-Level)
- **Voyager**: UI shell and feature modules.
- **Starbase**: Projects, files, versions, deployments.
- **Mission Control**: Camunda processes, instances, tasks, decisions.
- **Engines**: Engine management and connectivity.
- **Platform Admin**: Tenant settings and policy tooling.
- **Git Integration**: OAuth and repository connections.
