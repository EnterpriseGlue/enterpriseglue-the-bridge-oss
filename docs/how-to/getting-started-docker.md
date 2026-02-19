# Getting Started (Docker Quickstart)

Summary: Run the EnterpriseGlue platform locally using Docker Compose.

Audience: Developers and architects.

## Prerequisites
- Docker Desktop (or Docker Engine)
- Docker Compose plugin (`docker compose`)

## Steps (Dev)
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
   - If `EXPOSE_BACKEND=false`, call backend via frontend origin (for example `http://localhost:5173/api/...`).
4. Log in with the admin credentials from `.env.docker`:
   - `ADMIN_EMAIL`
   - `ADMIN_PASSWORD`
   - Optional: set `ADMIN_EMAIL_VERIFICATION_EXEMPT=true` to allow the seeded admin to bypass email verification

## Steps (Production)
1. Copy the production env file:
   ```bash
   cp .env.production.example .env.production
   ```
2. Update production secrets in `.env.production` (JWT, admin password, encryption key).
3. Keep `FRONTEND_URL` and `FRONTEND_HOST_PORT` aligned.
4. Keep `API_BASE_URL` empty for same-origin API calls through Nginx proxy.
5. Start the production stack:
   ```bash
   npm run prod
   ```
6. Open the app:
   - Frontend: http://localhost:8080 (default)
   - Backend is internal-only in production and is reached via proxied paths (for example `/api` and `/health`) on the frontend origin.

## Stop the stack
```bash
npm run down
```

```bash
npm run prod:down
```

## Notes
- Docker uses a PostgreSQL container by default (see `.env.docker` / `.env.production`).
- Docker dev serves frontend through Nginx (production-parity pathing and proxy behavior).
- Frontend source changes in Docker dev require rebuilding the frontend image (`npm run dev` already runs with `--build`).
- Git repositories are stored at `./data/repos` inside the backend container.
- To change ports or database settings, update the active env file.
- If email verification is enabled, configure `RESEND_API_KEY` to receive verification links.

## Non-Docker local deployment
For a localhost deployment (build + preview) using the production-style script, see:
- [Localhost Deployment (First-time install)](deploy-localhost.md)
  - First-time installs should use `--first-time` to apply migrations.
