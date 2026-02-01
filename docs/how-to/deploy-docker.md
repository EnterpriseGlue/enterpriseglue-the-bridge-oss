# Docker Compose Deployment

Summary: Deploy EnterpriseGlue using the Docker Compose stack defined in the repo.

Audience: Developers and architects.

## Services
The default `docker-compose.yml` defines:
- **db**: PostgreSQL 18 container
- **backend**: API service (TypeScript, runs migrations on startup)
- **frontend**: Vite dev server

## Configuration
1. Copy `.env.docker.example` to `.env.docker`.
2. Update database and admin credentials if needed.
3. Optional: set `ADMIN_EMAIL_VERIFICATION_EXEMPT=true` to allow the seeded admin to bypass email verification.

Key defaults:
- Backend: `http://localhost:8787`
- Frontend: `http://localhost:5173`
- PostgreSQL exposed on `POSTGRES_HOST_PORT`

## Start
```bash
npm run dev
```

## Stop
```bash
npm run down
```

## Volumes
Docker creates persistent volumes for:
- `postgres_data` (database)
- `backend_node_modules`
- `frontend_node_modules`
- `git_repos` (server-side git repositories)

## Notes
- This is a **Docker-first** deployment for now (per MVP focus).
- For a host-based production-style run, see `scripts/deploy-localhost.sh`.
- If email verification is enabled, configure `RESEND_API_KEY` to receive verification links.
