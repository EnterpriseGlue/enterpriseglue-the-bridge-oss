# Configuration Reference

Summary: Environment variables for backend and frontend configuration.

Audience: Developers and architects.

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

### Plugin platform and local diagnostics

- `ENTERPRISEGLUE_PLUGIN_STATE_FILE`: installer-rendered read-only plugin state.
- `ENTERPRISEGLUE_PLUGIN_EXECUTION_OBSERVATION_FILE`: installer-rendered read-only, browser-safe
  lifecycle observation. It is display-only and never authorizes plugin execution.
- `ENTERPRISEGLUE_PLUGIN_INVOCATION_PRIVATE_KEY_FILE`: host-only Ed25519 invocation key.
- `ENTERPRISEGLUE_PLUGIN_SECRET_BROKER_POLICY_FILE`: host-only closed secret-use policy.
- `ENTERPRISEGLUE_PLUGIN_SECRET_BROKER_SECRET_ROOT`: host-only credential root.
- `ENTERPRISEGLUE_PLUGIN_GATEWAY_RATE_WINDOW_SECONDS`,
  `ENTERPRISEGLUE_PLUGIN_GATEWAY_SUBJECT_REQUESTS_PER_WINDOW`, and
  `ENTERPRISEGLUE_PLUGIN_GATEWAY_PLUGIN_REQUESTS_PER_WINDOW`: deployment-wide database-backed
  plugin request ceilings. Defaults are `60`, `120`, and `2000`.
- `ENTERPRISEGLUE_PLUGIN_GATEWAY_MAX_CONCURRENT_PER_OPERATION`: deployment-wide active
  concurrency ceiling backed by crash-expiring database leases. Default `32`.
- `ENTERPRISEGLUE_PLUGIN_GATEWAY_CIRCUIT_FAILURE_THRESHOLD` and
  `ENTERPRISEGLUE_PLUGIN_GATEWAY_CIRCUIT_OPEN_SECONDS`: per-host immediate failure containment.
  Defaults are `3` and `30`.
- `ENTERPRISEGLUE_PLUGIN_EVENT_MAX_OUTSTANDING_PER_PLUGIN` and
  `ENTERPRISEGLUE_PLUGIN_EVENT_MAX_OUTSTANDING_PER_SUBSCRIPTION`: durable active event-backlog
  ceilings. Defaults are `10000` and `1000`.
- `ENTERPRISEGLUE_PLUGIN_EVENT_CIRCUIT_FAILURE_THRESHOLD` and
  `ENTERPRISEGLUE_PLUGIN_EVENT_CIRCUIT_OPEN_SECONDS`: durable
  per-plugin/deployment/tenant/event-subscription circuit. Consecutive retryable failures reject
  new automatic work during the cooldown; one database-owned half-open probe either closes the
  circuit or reopens it. Defaults are `3` and `60`.

The deployment-admin control API exposes this lifecycle only through bounded aggregate
`GET /api/plugin-platform/v1/metrics/events` output. It includes plugin/event type and closed
enqueue/delivery/circuit classes, but no tenant, deployment, event, delivery, operation, endpoint,
exception, or payload fields. The registry is process-local and resets on rollout.
- `ENTERPRISEGLUE_PLUGIN_ENGINE_EVENT_POLLING_ENABLED`: disabled by default; `true` opts into
  minimized incident/failed-job polling and one product/version-only inventory event per
  configured Operaton/Camunda 7 engine and UTC day. Inventory delivery additionally requires an
  explicit plugin `host.events.subscribe.engine_inventory` grant; enabling the poller alone does
  not authorize a subscriber.
- `ENTERPRISEGLUE_PLUGIN_DIAGNOSTIC_COLLECTOR_POLICY_FILE`: optional absolute path to the
  deployment-owned closed local collector policy. Merely setting the path does not enable
  automatic collection.
- `ENTERPRISEGLUE_PLUGIN_DIAGNOSTIC_AUTO_COLLECTION_ENABLED`: disabled by default; `true`
  permits the diagnostics broker to use the configured customer-local collector.

The local collector policy, signing key, handoff credential, and approved raw log source must be
mounted read-only into the backend only. Plugins and browsers receive none of these values. The
policy fixes plugin/source/engine/profile, byte/line limits, Ed25519 key ID/file, bearer-token
file, HTTPS destination, timeout, and bundle lifetime. There is no raw-upload fallback.
Each source has one closed parser kind:

- `file_tail` for bounded UTF-8 application logs;
- `docker_json_file_tail` for a fixed mounted Docker JSON-file log; or
- `kubernetes_cri_file_tail` for a fixed mounted Kubernetes/OpenShift CRI log.

The two structured adapters validate and normalize records before redaction. They use only the
operator-approved mounted file; they do not use a Docker/CRI socket, kubeconfig, Kubernetes API,
pod/container/namespace selector, command, or caller-provided time window. Mount only the one
active/rotated file required by the policy instead of a whole runtime log tree where the
deployment supports that restriction.
Start from the disabled
[generic policy example](../../packages/backend-host/examples/diagnostic-collector/policy.example.json)
and copy it outside source control before replacing publisher, engine, endpoint, key, and mount
placeholders. The backend test suite parses this exact file with the production policy schema.
The signed diagnostics status broker can validate those deployment-owned inputs and return only
safe health/reason/source-count classes for a plugin settings page. It never returns the policy
revision, source ID/path, endpoint, key/credential identity, or raw content, and it does not make
a network handoff during the check.

### Database Compatibility (TypeORM Adapters)
Database support is provided via TypeORM adapters and driver packages:
- **Postgres**: `pg`
- **Oracle**: `oracledb` (requires Oracle Instant Client)
- **SQL Server**: `mssql`
- **Spanner**: `@google-cloud/spanner`
- **MySQL**: `mysql2`

Notes:
- The Spanner driver is a pinned OSS runtime dependency because the connected plugin-platform
  migration/store gate and selected Spanner deployment require it.
- Its transitive `protobufjs` postinstall is explicitly disabled in `pnpm-workspace.yaml`; the
  immutable-install check and connected Spanner acceptance gate verify operation without
  executing that third-party install script.
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
