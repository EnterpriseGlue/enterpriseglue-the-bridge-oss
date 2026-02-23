# Deployment Runbook (Docker-First)

Summary: Operational steps for running EnterpriseGlue with Docker Compose.

Audience: Developers and architects.

## Preflight
- Docker and Docker Compose installed.
- Ports available (defaults): `8787` (backend), `5173` (frontend), `5432` (postgres).
- If these are occupied, change `.local/docker/env/docker.env` values (`BACKEND_HOST_PORT`, `FRONTEND_HOST_PORT`, `POSTGRES_HOST_PORT`).
- `.local/docker/env/docker.env` exists (auto-created by `npm run dev` or copied from `infra/docker/env/examples/docker.postgres.env.example`).

## Start
```bash
npm run dev
```

## Verify
- Backend health: `http://localhost:8787/health` (when `EXPOSE_BACKEND=true`)
- If `EXPOSE_BACKEND=false`, use proxied health endpoint on frontend origin (for example `http://localhost:5173/health`).
- Frontend: `http://localhost:5173`
- Login using `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.local/docker/env/docker.env`.

## Production Compose Notes
- `npm run prod` serves frontend via Nginx on `FRONTEND_HOST_PORT` (default `8080`).
- Backend is internal-only in production; API calls are proxied through the frontend origin.
- Keep `FRONTEND_URL` aligned with `FRONTEND_HOST_PORT` in `.local/docker/env/production.env`.

## Production from Images (Runbook)
1. Copy one template:
   - `cp infra/docker/env/examples/images.postgres.env.example .local/docker/env/images.postgres.env`
   - or `cp infra/docker/env/examples/images.oracle.env.example .local/docker/env/images.oracle.env`
2. Set `BACKEND_IMAGE`, `FRONTEND_IMAGE`, and `IMAGE_TAG`.
3. Start from images:
   - `npm run prod:images:postgres`
   - or `npm run prod:images:oracle`

### Verify (image mode)
- Frontend: `http://localhost:8080`
- Proxied backend health: `http://localhost:8080/health`

### Rollback (image mode)
1. Edit active `.local/docker/env/images.*.env` file.
2. Set `IMAGE_TAG` to previous known-good version.
3. Re-run same `npm run prod:images:*` command.

### Stop (image mode)
- `npm run prod:images:postgres:down`
- `npm run prod:images:oracle:down`

## Logs
```bash
docker compose --project-directory . -f infra/docker/compose/docker-compose.yml logs -f backend
```
```bash
docker compose --project-directory . -f infra/docker/compose/docker-compose.yml logs -f frontend
```

## Stop
```bash
npm run down
```

## Reset (clean volumes)
```bash
npm run down -- -v
```

## Production-Style Local Deployment
For a host-based build and preview flow:
```bash
bash ./scripts/deploy-localhost.sh
```
Requires `backend/.env` and a frontend env file.
