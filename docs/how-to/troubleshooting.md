# Troubleshooting

Summary: Common issues and fixes for EnterpriseGlue setup.

Audience: Developers and architects.

For the complete bundle deployment workflow, see [Deploy Authorization Configuration](./deploy-authorization-config.md).

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

## Configuration bootstrap keeps `/ready` closed

Read `/ready`, check `enterpriseglue_config_bootstrap_info` on `/metrics`, and
open the matching apply-run receipt in **Platform Settings → Configuration
Bundles**. These surfaces intentionally show the same safe issue code:

| Issue code | Operator action |
| --- | --- |
| `bundle_path_missing` | Configure the absolute in-container bundle path and its read-only mount. |
| `bundle_read_failed` | Check file existence, size limit, archive shape, and non-root readability. |
| `hash_mismatch` | Recompute the reviewed payload SHA-256; do not update the pin until the content is reviewed. |
| `validation_failed` | Run bundle preview and correct schema or cross-file reference errors. |
| `secret_preflight_failed` | Restore the referenced environment variable or approved file without putting its value in the bundle. |
| `tenant_scope_missing` | Set the exact expected platform or tenant scope for apply. |
| `apply_failed` | Inspect the sanitized preview/apply diagnostics and apply-run receipt. |
| `identity_reconciliation_failed` | Inspect the receipt's reconciliation tasks and correct the provider or stored-snapshot failure before retrying. |

Backend logs intentionally omit raw exceptions and secret/configuration
identifiers. Use preview diagnostics and receipt task state for detail; do not
disable `EG_CONFIG_FAIL_CLOSED` merely to make the pod ready.

## Configuration appears applied but access is stale

- Confirm the apply-run receipt reports bootstrap reconciliation `completed`.
- Confirm `/ready` reports `applied` rather than `failed`.
- For SSO-derived access, verify the entitlement mapping targets the intended
  internal group and that the canonical role assignment is attached to that
  group at the correct scope.
- For config-owned objects, review drift status before reapplying an
  authoritative bundle; destructive removals require explicit archive
  acknowledgements.

## Tests fail with "relation does not exist" errors
- First-time test setup requires database schema sync:
  ```bash
  cd backend
  pnpm run build:skip-generate
  pnpm run db:schema:sync
  ```
- The test environment (`NODE_ENV=test`) uses schema synchronization instead of migrations.
- CI automatically runs schema sync before tests.
