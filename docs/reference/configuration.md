# Configuration Reference

Summary: Environment variables for backend and frontend configuration.

Audience: Developers and architects.

Configuration-bundle bootstrap is optional and disabled by default. Its operational contract is documented in [Deploy Authorization Configuration](../how-to/deploy-authorization-config.md).

## Backend Configuration
Primary sources:
- `.local/docker/env/docker.env` (Docker Compose, Postgres default)
- `.local/docker/env/docker.<db>.env` (Docker Compose with `pnpm run dev -- --db <db>`)
- `backend/.env` (host-based runs)

Legacy fallback support:
- root `.env.docker`
- root `.env.docker.<db>`

Launcher and validation scripts:
- `dev.sh` / `down.sh` select DB overlays from `infra/docker/compose/` (`docker-compose.<db>.yml`) and env files.
- `scripts/db-preflight.sh` validates DB-specific env requirements and can install a missing DB driver into local `node_modules`.

### Core Settings
- `API_PORT`: backend port (default 8787)
- `BACKEND_HOST_PORT`: backend host port (Docker dev)
- `EXPOSE_BACKEND`: publish backend on host in Docker dev (`true`/`false`)
- `FRONTEND_HOST_PORT`: frontend host port (Docker dev/prod)
- `DATABASE_TYPE`: `postgres | oracle | mssql | spanner | mysql`
- `FRONTEND_URL`: frontend origin for auth links

### Database Required Variables (by `DATABASE_TYPE`)
- `postgres`: either `POSTGRES_URL` (connection string) **or** `POSTGRES_HOST` + `POSTGRES_USER` + `POSTGRES_PASSWORD` + `POSTGRES_DATABASE` + `POSTGRES_SCHEMA` (non-public)
- `oracle`: `ORACLE_USER` + `ORACLE_PASSWORD` + either `ORACLE_CONNECTION_STRING` **or** (`ORACLE_HOST` + one of `ORACLE_SERVICE_NAME` / `ORACLE_SID`)
- `mssql`: `MSSQL_HOST`, `MSSQL_USER`, `MSSQL_PASSWORD`, `MSSQL_DATABASE`
- `mysql`: `MYSQL_HOST`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`
- `spanner`: `SPANNER_PROJECT_ID`, `SPANNER_INSTANCE_ID`, `SPANNER_DATABASE_ID`

### Database (Postgres default)
- `POSTGRES_URL` — connection string alternative; when set, individual host/port/user/password/database vars are not required. Format: `postgresql://USER:PASSWORD@HOST:PORT/DATABASE?schema=SCHEMA&sslmode=require`
- `POSTGRES_HOST`
- `POSTGRES_PORT`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `POSTGRES_DATABASE`
- `POSTGRES_SCHEMA` (must be non-public)
- `POSTGRES_SSL`
- `POSTGRES_SSL_REJECT_UNAUTHORIZED`

### Database (Oracle)
- `ORACLE_CONNECTION_STRING` — Easy Connect Plus or TNS descriptor; required for multi-host HA/failover. When set, `ORACLE_HOST`/`ORACLE_PORT`/`ORACLE_SERVICE_NAME`/`ORACLE_SID` are not required.
- `ORACLE_HOST`, `ORACLE_PORT`, `ORACLE_SERVICE_NAME` / `ORACLE_SID` (single-host alternative)
- `ORACLE_USER`, `ORACLE_PASSWORD`, `ORACLE_SCHEMA`

### Enterprise Schema
- `ENTERPRISE_SCHEMA` (must be non-public and distinct from the active main schema)

### Auth & Admin Bootstrap
- `JWT_SECRET`
- `JWT_ACCESS_TOKEN_EXPIRES`
- `JWT_REFRESH_TOKEN_EXPIRES`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`

### Git & Encryption
- `GIT_REPOS_PATH`
- `GIT_DEFAULT_BRANCH`
- `ENCRYPTION_KEY`

### Runtime Inventory Reconciliation

These settings are disabled by default. They schedule bounded process/decision
inventory refreshes for active `resource_aware` engines only; distributed
engine-wide engines are not polled because they do not use runtime-resource
authorization.

- `RUNTIME_INVENTORY_RECONCILIATION_INTERVAL_MS`: Positive interval in milliseconds. Unset or `0` disables the scheduler.
- `RUNTIME_INVENTORY_RECONCILIATION_TENANT_IDS`: Optional comma-separated tenant ids. Use `global` or `null` for the OSS/default tenant. Defaults to `global`.
- `RUNTIME_INVENTORY_RECONCILIATION_RUN_ON_START`: Set to `true` to run one reconciliation after server startup.

The scheduler isolates individual engine failures and never revokes resources
when an engine listing fails. Operators can use the Access Control runtime
resource reconciliation action for immediate, one-engine repair.

### Authorization Configuration Bundle Bootstrap

These settings are optional. Leave `EG_CONFIG_BOOTSTRAP_MODE` unset or set it
to `disabled` for ordinary standalone deployments. A configured production
bootstrap fails closed by default; use the optional Compose overlay or the
OpenShift ConfigMap projection to mount the non-secret JSON payload.

- `EG_CONFIG_BUNDLE_PATH`: Absolute path to one JSON payload with `bundle` and `files` properties.
- `EG_CONFIG_BOOTSTRAP_MODE`: `disabled`, `validate`, or `apply`; default `disabled`.
- `EG_CONFIG_EXPECTED_SHA256`: Optional SHA-256 of the mounted payload; rejects unexpected content.
- `EG_CONFIG_EXPECTED_TENANT_SCOPE`: Required expected target scope for an `apply` bootstrap, such as `platform` or a tenant id.
- `EG_CONFIG_FAIL_CLOSED`: `true` or `false`; defaults to `true` in production and controls whether a configured bootstrap failure stops startup.
- `EG_CONFIG_MAX_BYTES`: Maximum payload size; defaults to `1048576`.
- `EG_CONFIG_SECRET_PROVIDER`: `env` or `file`; defaults to `env`.
- `EG_CONFIG_SECRET_FILE_ROOT`: Required root directory for `file://` secret references when the provider is `file`.

`/health` exposes sanitized bootstrap state for diagnostics. `/ready` returns
`503` after a non-fail-closed bootstrap error. Successful apply receipts report
Engine Set and runtime-resource materialization counts; identity-provider
directory reconciliation remains a separate operation.

### Database Compatibility (TypeORM Adapters)
Database support is provided via TypeORM adapters and driver packages:
- **Postgres**: `pg`
- **Oracle**: `oracledb` (requires Oracle Instant Client)
- **SQL Server**: `mssql`
- **Spanner**: `@google-cloud/spanner`
- **MySQL**: `mysql2`

Notes:
- In Docker dev, backend startup also checks/install the selected DB driver package into local `node_modules`.
- For host runs, use `scripts/db-preflight.sh` before backend startup.

See for detailed settings:
- `backend/.env.example`
- `infra/docker/env/examples/docker.postgres.env.example`
- `infra/docker/env/examples/docker.mysql.env.example`
- `infra/docker/env/examples/docker.mssql.env.example`
- `infra/docker/env/examples/docker.oracle.env.example`
- `infra/docker/env/examples/docker.spanner.env.example`

## Frontend Configuration
Primary sources:
- `frontend/.env.local` or `frontend/.env`
- `.local/docker/env/docker.env` (Docker Compose dev)
- `.local/docker/env/production.env` (Docker Compose production)

### Core Settings
- `API_BASE_URL`: preferred compose-level env alias for API origin
- `VITE_API_BASE_URL`: frontend runtime variable consumed by browser code (Vite-exposed)
- `API_UPSTREAM`: frontend Nginx upstream override (defaults to `backend:${API_PORT}` in Docker)

In Docker compose, `API_BASE_URL` is mapped to `VITE_API_BASE_URL` for frontend runtime.
For production same-origin routing through Nginx, leave `API_BASE_URL` empty.
For source-built Docker images, `API_BASE_URL` is consumed at frontend image build time. In published-image mode, use `API_UPSTREAM` only for runtime proxy changes.

### Feature Flags
The UI is gated by `VITE_FEATURE_*` flags (see `frontend/.env.example`), such as:
- `VITE_FEATURE_VOYAGER`
- `VITE_FEATURE_STARBASE`
- `VITE_FEATURE_MISSION_CONTROL`
- `VITE_FEATURE_ENGINES`

## Related Files
- `backend/.env.example`
- `frontend/.env.example`
- `infra/docker/env/examples/docker.default.env.example`
- `infra/docker/env/examples/docker.<db>.env.example`
- `infra/docker/env/examples/production.env.example`
- `infra/docker/env/examples/images.postgres.env.example`
- `infra/docker/env/examples/images.oracle.env.example`
- `infra/docker/env/examples/openshift.env.example`
- `infra/docker/compose/docker-compose.yml`
- `infra/docker/compose/docker-compose.<db>.yml`
- `infra/docker/compose/docker-compose.prod.yml`
- `infra/kubernetes/openshift/kustomize/base/`
- `infra/kubernetes/openshift/kustomize/overlays/{dev,staging,prod}`
- `backend/src/shared/config/index.ts`
- `scripts/db-preflight.sh`
- `dev.sh`
- `down.sh`
