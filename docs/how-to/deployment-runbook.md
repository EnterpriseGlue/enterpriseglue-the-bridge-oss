# Deployment Runbook (Docker-First)

Summary: Operational steps for running EnterpriseGlue with Docker Compose.

Audience: Developers and architects.

This runbook covers the current deployment flow, including optional startup configuration bootstrap. The full CI/CD and rollback contract is in [Deploy Authorization Configuration](./deploy-authorization-config.md).

## Preflight
- Docker and Docker Compose installed.
- Ports available (defaults): `8787` (backend), `5173` (frontend), `5432` (postgres).
- If these are occupied, change `.local/docker/env/docker.env` values (`BACKEND_HOST_PORT`, `FRONTEND_HOST_PORT`, `POSTGRES_HOST_PORT`).
- `.local/docker/env/docker.env` exists (auto-created by `pnpm run dev` or copied from `infra/docker/env/examples/docker.postgres.env.example`).

## Start
```bash
pnpm run dev
```

## Verify
- Backend health: `http://localhost:8787/health` (when `EXPOSE_BACKEND=true`)
- Backend readiness: `http://localhost:8787/ready`. A configured bundle apply is
  not ready until materialization and required identity replay complete.
- Bootstrap metrics: `http://localhost:8787/metrics`.
- Engine-tenancy metrics on the same endpoint: require collection success,
  investigate non-zero unresolved/conflicting/stale counts, and track
  default-fallback increases as client migration debt.
- If `EXPOSE_BACKEND=false`, use proxied health endpoint on frontend origin (for example `http://localhost:5173/health`).
- Frontend: `http://localhost:5173`
- Login using `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.local/docker/env/docker.env`.

## Optional Configuration Bootstrap

1. Preview and review the bundle before deployment.
2. Set `EG_CONFIG_BOOTSTRAP_MODE=validate` for a validation-only rollout, or
   `apply` for a hash-bound startup apply.
3. Set `EG_CONFIG_BUNDLE_HOST_PATH` when invoking Compose and configure
   `EG_CONFIG_EXPECTED_SHA256`; `apply` also requires
   `EG_CONFIG_EXPECTED_TENANT_SCOPE`.
4. Keep `EG_CONFIG_FAIL_CLOSED=true` in production. Enable
   `EG_CONFIG_REQUIRE_SECRET_PREFLIGHT=true` when the deployment must prove every
   referenced secret is available before validation or apply.
5. Confirm `/ready`, `enterpriseglue_config_bootstrap_info`, and the apply-run
   receipt all report completion before handing traffic to the new backend.
6. When the bundle changes engine topology or mappings, confirm tenancy
   diagnostics, mapping version, reconciliation, and one allowed plus one
   denied Effective Access result before tenant traffic is enabled.

The bundle mount and file-secret mount are independent and read-only. Bundle
JSON must contain references such as `env://NAME` or `file://name`, never secret
values.

## Production Compose Notes
- `pnpm run prod` serves frontend via Nginx on `FRONTEND_HOST_PORT` (default `8080`).
- Backend is internal-only in production; API calls are proxied through the frontend origin.
- Keep `FRONTEND_URL` aligned with `FRONTEND_HOST_PORT` in `.local/docker/env/production.env`.

## Production from Images (Runbook)
1. Copy one template:
   - `cp infra/docker/env/examples/images.postgres.env.example .local/docker/env/images.postgres.env`
   - or `cp infra/docker/env/examples/images.oracle.env.example .local/docker/env/images.oracle.env`
2. Set `BACKEND_IMAGE`, `FRONTEND_IMAGE`, and `IMAGE_TAG`.
3. Start from images:
   - `pnpm run prod:images:postgres`
   - or `pnpm run prod:images:oracle`

### Verify (image mode)
- Frontend: `http://localhost:8080`
- Proxied backend health: `http://localhost:8080/health`

### Rollback (image mode)
1. Edit active `.local/docker/env/images.*.env` file.
2. Set `IMAGE_TAG` to previous known-good version.
3. Re-run same `pnpm run prod:images:*` command.

For bundle rollback, restore the previous reviewed payload and matching expected
SHA-256, then rerun the same command. A failed fail-closed bootstrap must be
corrected; do not work around it by turning off readiness or secret preflight.

### Stop (image mode)
- `pnpm run prod:images:postgres:down`
- `pnpm run prod:images:oracle:down`

## Logs
```bash
docker compose --project-directory . -f infra/docker/compose/docker-compose.yml logs -f backend
```
```bash
docker compose --project-directory . -f infra/docker/compose/docker-compose.yml logs -f frontend
```

## Stop
```bash
pnpm run down
```

## Reset (clean volumes)
```bash
pnpm run down -- -v
```

## Production-Style Local Deployment
For a host-based build and preview flow:
```bash
bash ./scripts/deploy-localhost.sh
```
Requires `backend/.env` and a frontend env file.
