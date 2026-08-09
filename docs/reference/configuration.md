# Configuration Reference

Summary: Environment variables for backend and frontend configuration.

Audience: Developers and architects.

Configuration-bundle bootstrap is optional and disabled by default. Its operational contract is documented in [Deploy Authorization Configuration](../how-to/deploy-authorization-config.md).

Source development and CI use Node.js 24 (`>=24 <25`) and pnpm 11.0.8.
Every workspace manifest declares the same Node runtime range; the root
`packageManager` field pins pnpm. Use Corepack so package scripts do not fall
back to an incompatible globally installed pnpm.

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

- `EG_CONFIG_BUNDLE_PATH`: Absolute path to one JSON payload with `bundle` and `files` properties, or a folder-style ZIP archive containing `bundle.json` and its declared imported JSON files.
- `EG_CONFIG_BOOTSTRAP_MODE`: `disabled`, `validate`, or `apply`; default `disabled`.
- `EG_CONFIG_EXPECTED_SHA256`: Optional SHA-256 of the mounted payload; rejects unexpected content.
- `EG_CONFIG_EXPECTED_TENANT_SCOPE`: Required expected target scope for an `apply` bootstrap, such as `platform` or a tenant id.
- `EG_CONFIG_FAIL_CLOSED`: `true` or `false`; defaults to `true` in production and controls whether a configured bootstrap failure stops startup.
- `EG_CONFIG_REQUIRE_SECRET_PREFLIGHT`: `true` or `false`; default `false`. When enabled, validation and apply bootstrap modes require every referenced `env://`, `file://`, or `docker://` secret to be available, and apply is bound to that availability check.
- `EG_CONFIG_MAX_BYTES`: Maximum payload size; defaults to `1048576`.
- `EG_CONFIG_SECRET_PROVIDER`: `env`, `file`, or `docker`; defaults to `env`.
- `EG_CONFIG_SECRET_FILE_ROOT`: Required root directory for `file://` secret references when the provider is `file`; optional Docker secret mount root, which defaults to `/run/secrets` when the provider is `docker`.

### Engine endpoint policy

Production outbound engine traffic always enforces this policy and fails closed
unless `EG_ENGINE_ALLOWED_HOSTS` contains the endpoint host. Use comma-separated
exact host names or narrowly scoped organizational patterns such as
`*.engines.example.com`; top-level/effective-suffix patterns such as `*.com`
and `*.co.uk` are rejected. The policy covers direct engine,
customer-sidecar, and OAuth client-credentials token URLs; redirects remain
disabled and TLS certificates use the runtime's normal verification.

- `EG_ENGINE_ALLOWED_HOSTS`: Required for production engine traffic. Private
  address literals, loopback, single-label, `.local`, and Docker-local hosts
  require an exact entry; a wildcard never authorizes them.
- `EG_ENFORCE_ENGINE_ENDPOINT_POLICY`: Production enforces the policy even if
  this variable is unset or `false`; set `true` to exercise the same policy in
  another environment.
- `EG_ENGINE_ALLOW_PRIVATE_HOSTS`: Defaults to `false`. Set `true` only for a
  reviewed private/address-literal/Docker-local engine or sidecar and only with
  an exact `EG_ENGINE_ALLOWED_HOSTS` entry.
- `EG_ALLOW_INSECURE_ENGINE_HTTP`: Defaults to `false`; a separate, explicit
  temporary migration override for a reviewed private-network HTTP endpoint.
  The private-host opt-in and exact allowlist entry are still required. Prefer
  HTTPS and remove this override after migration.

Host allowlisting validates the configured name and address literals; it is
not DNS pinning. Allowlist only names below a reviewed administrative boundary,
and enforce network egress rules that block private, loopback, and cloud-metadata
destinations reached through an unexpected DNS answer.

### Identity-provider endpoint and pre-authentication policy

Production OIDC, SAML, and LDAP traffic fails closed until
`EG_IDENTITY_PROVIDER_ALLOWED_HOSTS` contains each reviewed provider host.
OIDC discovery-derived authorization, token, and JWKS hosts are validated
again; HTTP redirects are rejected and remote response bodies are capped at
1 MiB. Related public IdP hosts may use a narrowly scoped organizational
subdomain entry such as `*.login.example.com`; top-level/effective-suffix
patterns such as `*.com` and `*.co.uk` are rejected. Private-address
literals, single-label, `.local`, loopback, and Docker-local providers additionally
require `EG_IDENTITY_PROVIDER_ALLOW_PRIVATE_HOSTS=true` and an **exact** host
entry; wildcards never authorize a private provider.

- `EG_IDENTITY_PROVIDER_ALLOWED_HOSTS`: Required for production direct OIDC,
  SAML metadata/SSO, and LDAPS traffic.
- `EG_ENFORCE_IDENTITY_PROVIDER_ENDPOINT_POLICY`: Defaults to `true` in
  production; production cannot disable the policy. Set `true` to exercise it
  in a local or test environment.
- `EG_IDENTITY_PROVIDER_ALLOW_PRIVATE_HOSTS`: Defaults to `false`. Enable only
  for a reviewed private-host/address-literal IdP or directory together with
  an exact allowlist entry. Host allowlisting does not pin DNS answers; review
  DNS ownership and enforce private-network/metadata egress controls outside
  the application for every allowlisted name.
- `EG_IDENTITY_FLOW_RATE_LIMIT_MAX`: Successful and failed unauthenticated
  provider discovery/start/callback requests allowed per IP per 15 minutes;
  defaults to `300` in production.
- `SSO_DIAGNOSTICS_INTERVAL_MS`: Scheduler cadence for authoritative LDAP
  reconciliation. Production defaults to `60000` and treats an omitted, zero,
  or malformed value as `60000`; non-production stays disabled unless a
  positive interval is configured. Per-provider `intervalSeconds` still
  controls when each LDAP provider is due.
- `EG_LDAP_RECONCILIATION_IDENTITY_LIMIT`: Maximum identities accepted in one
  authoritative LDAP reconciliation run; defaults to `10000` and is capped at
  `50000`. Exceeding it stops the run before removals are applied.
- `EG_LDAP_RECONCILIATION_CONCURRENCY`: Bounded group-resolution worker count
  for one directory reconciliation; defaults to `4` and is capped at `16`.
- `EG_LDAP_RECONCILIATION_GROUP_QUERY_LIMIT`: Aggregate reverse-group query
  budget for the complete reconciliation; defaults to `10000` and is capped at
  `100000`.
- `EG_LDAP_RECONCILIATION_GROUP_RESULT_LIMIT`: Aggregate group-entry budget for
  the complete reconciliation; defaults to `100000` and is capped at `500000`.
  An aggregate-budget failure stops the run before any absence-based access
  removal is applied.
- `EG_LDAP_GROUP_SEARCH_QUERY_LIMIT`: Maximum reverse-group lookup queries per
  login/reconciliation identity; defaults to `100` and is capped at `1000`.
- `EG_LDAP_GROUP_SEARCH_RESULT_LIMIT`: Maximum returned/unique groups accepted
  per identity; defaults to `5000` and is capped at `10000`. Cycles are
  deduplicated and every budget failure is fail closed. The per-identity limits
  apply inside the aggregate reconciliation limits.

OIDC and SAML callback URLs are not outbound allowlist targets. They must use
the exact `FRONTEND_URL` origin and canonical protocol path:
`/api/auth/identity/callback` or `/api/auth/providers/saml/callback`.

`/health` exposes sanitized bootstrap state for diagnostics. `/ready` returns
`503` after a non-fail-closed bootstrap error. Successful apply receipts report
Engine Set and runtime-resource materialization counts; identity-provider
mapping changes must also finish applying their bounded saved membership data
(the `replay-memberships` API operation) before readiness opens. Live
identity-provider directory synchronization remains a separate scheduled
operation.

`/metrics` publishes `enterpriseglue_config_bootstrap_ready`,
`enterpriseglue_config_bootstrap_applied`, and
`enterpriseglue_config_bootstrap_info`. Metric labels contain bounded status
enums and a stable issue code only; the bundle hash is retained in JSON health
and apply-run receipts but omitted from metrics to avoid high-cardinality data.
The same endpoint publishes bounded aggregate engine-tenancy resolution gauges,
a collection-success gauge, and process-local default-fallback counters. These
series contain no engine, tenant, mapping, resource, URL, or principal
identifiers; see
[Configure Dedicated and Shared Engine Tenancy](../how-to/configure-engine-tenancy.md#monitor-resolution-and-default-fallback).
It also publishes bounded `enterpriseglue_login_experience_*` counters and
duration aggregates. Login labels are restricted to authentication-method and
outcome enums and never include provider, tenant, user, email, domain, IP,
request, or session identifiers; see
[Authentication and SSO](../how-to/auth-sso.md#privacy-safe-login-experience-metrics).

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
