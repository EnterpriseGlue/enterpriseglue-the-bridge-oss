# Troubleshooting

Summary: Common issues and fixes for EnterpriseGlue setup.

Audience: Developers and architects.

## Backend fails to start (missing env)
- Ensure `.local/docker/env/docker.env` (Docker) or `backend/.env` (host) exists.
- Legacy fallback: root `.env.docker` is still accepted.
- Check required variables: `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`.

## Schema validation errors
- `POSTGRES_SCHEMA` must not be `public`.
- `ENTERPRISE_SCHEMA` must be distinct from `POSTGRES_SCHEMA`.

## Database connection errors
- Confirm `POSTGRES_HOST` and credentials.
- Ensure the `db` container is healthy in Docker.

## Frontend cannot reach API
- Verify `API_BASE_URL` in the active Docker env file (`.local/docker/env/docker.env` or `.local/docker/env/production.env`) or `VITE_API_BASE_URL` (frontend env).
- If production uses same-origin mode, keep `API_BASE_URL` empty and confirm Nginx proxy is running.
- Confirm backend is reachable on the configured backend port (`API_PORT`, default `8787`).

## Docker compose ports in use
- Stop conflicting services on configured ports.
- Or change ports in `.local/docker/env/docker.env` using `BACKEND_HOST_PORT`, `FRONTEND_HOST_PORT`, and `POSTGRES_HOST_PORT`.

## Migrations fail
- Verify database credentials and schema permissions.
- Check backend logs for migration errors.

## Tests fail with "relation does not exist" errors
- First-time test setup requires database schema sync:
  ```bash
  cd backend
  npm run build:skip-generate
  npm run db:schema:sync
  ```
- The test environment (`NODE_ENV=test`) uses schema synchronization instead of migrations.
- CI automatically runs schema sync before tests.
