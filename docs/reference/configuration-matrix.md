# Configuration Matrix

Summary: Required and optional environment variables for the platform.

Audience: Developers and architects.

This matrix lists current executable settings; see [Deploy Authorization Configuration](../how-to/deploy-authorization-config.md) for the configuration-bundle operating procedure.

Engine topology is not an environment-variable switch. Declare
dedicated/shared topology in the UI/API or `engines.json`, and shared mappings
in `engine-tenant-mappings.json`. See
[Configure Dedicated and Shared Engine Tenancy](../how-to/configure-engine-tenancy.md).

## Backend (Common Required)
| Variable | Required | Default (Docker) | Notes |
| --- | --- | --- | --- |
| API_PORT | Yes | 8787 | Backend port |
| BACKEND_HOST_PORT | No | 8787 | Backend host port (Docker dev) |
| EXPOSE_BACKEND | No | true | Publish backend on host in Docker dev (`true`/`false`) |
| FRONTEND_HOST_PORT | No | 5173 (dev), 8080 (prod) | Frontend host port |
| DATABASE_TYPE | Yes | postgres | Database engine type |
| EG_DATABASE_STARTUP_MODE | No | apply | `apply` retains automatic schema migration/bootstrap. `verify` performs fail-closed readiness and integrity checks without DDL for split Kubernetes API/worker identities. |
| EG_RUNTIME_ROLE | No | all | `all` preserves the combined server/worker process; `api` serves HTTP without background pollers; `worker` runs pollers without a public listener. |
| JWT_SECRET | Yes | dev value | Must be strong in production |
| ADMIN_EMAIL | Yes | admin@enterpriseglue.ai | Bootstrap admin user |
| ADMIN_PASSWORD | Yes | dev value | Change in production |
| FRONTEND_URL | Yes | http://localhost:5173 (dev), http://localhost:8080 (prod) | Frontend origin used by backend auth links |
| ENCRYPTION_KEY | Yes | dev value | 64-char hex key |
| ENTERPRISE_SCHEMA | No | enterprise | Must be non-public and distinct from active main schema |

## Backend (Native Tenancy)

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| EG_TENANCY_MODE | No | single | `single` permits only the canonical default tenant; `pooled` enables the pre-production multi-tenant foundation and requires PostgreSQL RLS plus the complete deployment qualification gates. |
| EG_TENANT_BASE_DOMAIN | No | unset | Managed tenant hostname suffix; `<tenant-slug>.<base-domain>` resolves the canonical tenant. |
| EG_TENANT_PLACEMENT_KEY | Required for production pooled mode when v2 is unset | unset | Secret of at least 32 characters used to verify legacy placement v1 assertions during the compatibility window. |
| EG_TENANT_PLACEMENT_MAX_AGE_SECONDS | No | 120 | Maximum assertion lifetime in seconds; maximum 3600. |
| EG_TENANT_PLACEMENT_V2_JWKS_JSON | Required for cloud-required pooled mode | unset | Public ES256 JWKS. Each accepted key has a unique `kid`; overlapping keys permit rotation. |
| EG_TENANT_PLACEMENT_V2_ISSUER | Required for cloud-required pooled mode | unset | Exact trusted placement assertion issuer. |
| EG_TENANT_PLACEMENT_V2_AUDIENCE | Required for cloud-required pooled mode | unset | Exact shard assertion audience and workload receipt audience. |
| EG_TENANT_PLACEMENT_V2_SHARD_ID | Required for cloud-required pooled mode | unset | Canonical shard identity; must match the durable tenant placement key. |
| EG_TENANT_PLACEMENT_RELEASE_ID | Required for managed mixed-release shards | unset | Exact immutable SaaS release identity accepted by placement v3. Omit it for ordinary self-hosted single or pooled deployments. |
| EG_TENANT_PLACEMENT_V2_CLOCK_SKEW_SECONDS | No | 5 | Clock tolerance for `iat`, `nbf`, and `exp`; maximum 60. |
| EG_TENANCY_CLOUD_REQUIRED | No | false | Requires placement v2, signed workload receipts, forced RLS, the tenant secret broker, and signed tenant application eligibility without changing the self-hosted default. |
| EG_TENANT_CLOUD_IDENTITY_AUDIENCE | Required with a managed release ID | unset | Exact Cloud control-plane audience for the host-issued, short-lived tenant administrator identity assertion. |
| EG_TENANT_RELEASE_CONTROLLER_TOKEN | Required with a managed release ID | unset | Dedicated workload bearer used only by the private release controller to hand tenant jobs, events, and schedules to the assigned release. Store and rotate it as a secret. |
| EG_TENANT_APP_ELIGIBILITY_REQUIRED | No | false | Set true for SaaS shards. Requires the complete tenant application eligibility issuer, audience, and JWKS configuration. |
| EG_TENANT_APP_ELIGIBILITY_JWKS_JSON | Required when eligibility is required | unset | Public P-256 ES256 JWKS with unique `kid` values; overlapping keys support rotation. |
| EG_TENANT_APP_ELIGIBILITY_ISSUER | Required when eligibility is required | unset | Exact trusted issuer for signed tenant/plugin eligibility projections. |
| EG_TENANT_APP_ELIGIBILITY_AUDIENCE | Required when eligibility is required | unset | Exact shard audience for signed tenant/plugin eligibility projections. |
| EG_TENANT_APP_ELIGIBILITY_CLOCK_SKEW_SECONDS | No | 60 | Projection clock tolerance from 0 to 300 seconds. |
| EG_TENANT_APP_ELIGIBILITY_MAX_LIFETIME_SECONDS | No | 604800 | Maximum projection lifetime from 60 to 2592000 seconds. |
| EG_TENANT_WORKLOAD_RECEIPT_PRIVATE_KEY | Required for cloud-required pooled mode | unset | PEM-encoded P-256 private key; may use escaped newlines. Never expose it through APIs or logs. |
| EG_TENANT_WORKLOAD_RECEIPT_KEY_ID | Required for cloud-required pooled mode | unset | Public identifier for the workload receipt signing key. |
| EG_TENANT_WORKLOAD_RECEIPT_ISSUER | Required for cloud-required pooled mode | unset | Stable shard receipt issuer verified by the control plane. |
| EG_TENANT_RLS_ENFORCED | Required for pooled mode | false | Must be `true`; startup verifies forced PostgreSQL row-level security and rejects superuser or `BYPASSRLS` application roles before serving pooled traffic. |
| EG_TENANT_SECRET_BROKER_URL | Required for cloud-required mode | unset | Private HTTPS broker base URL; loopback HTTP is development-only. |
| EG_TENANT_SECRET_BROKER_TOKEN_REF | Required for cloud-required mode | unset | Broker bearer-token reference resolved by the existing environment, file, or Docker provider; tenant-secret references are forbidden. |
| EG_TENANT_SECRET_BROKER_TIMEOUT_MS | No | 5000 | Private broker request timeout in milliseconds; range 100-30000. |
| EG_TENANT_SECRET_BROKER_CACHE_TTL_MS | No | 15000 | Bounded in-memory resolved-value TTL in milliseconds; 0 disables caching, maximum 60000. |
| EG_TENANT_SECRET_BROKER_CACHE_MAX_ENTRIES | No | 256 | Maximum resolved tenant-secret values cached per backend process; maximum 1024. |
| EG_TENANT_SECRET_BROKER_REQUIRED | Required for cloud-required mode | false | Fails startup unless URL and token reference are present. |
| EG_TENANT_SECRET_BREAK_GLASS_ENABLED | No | false | Enables the `tenant:lifecycle` service-account recovery route for already-available local references; never accepts secret values. |
| ENTERPRISEGLUE_TENANT_APP_ACTIVATION_POLICY | No | direct | `direct` lets tenant administrators activate applications; `approval_required` requires a member request and tenant-admin decision. Invalid values fail startup. |

## Backend (Required by DATABASE_TYPE)

### Postgres
| Variable | Required | Default (Docker) | Notes |
| --- | --- | --- | --- |
| POSTGRES_URL | No (alt. to individual vars) | — | Connection string: `postgresql://USER:PASS@HOST:PORT/DB?schema=SCHEMA`. When set, HOST/PORT/USER/PASSWORD/DATABASE are not required. |
| POSTGRES_HOST | Yes (unless POSTGRES_URL set) | db | Docker service name |
| POSTGRES_PORT | No | 5432 | Postgres port |
| POSTGRES_USER | Yes (unless POSTGRES_URL set) | enterpriseglue | Postgres user |
| POSTGRES_PASSWORD | Yes (unless POSTGRES_URL set) | enterpriseglue | Postgres password |
| POSTGRES_DATABASE | Yes (unless POSTGRES_URL set) | enterpriseglue | Database name |
| POSTGRES_SCHEMA | Yes | main | Must be non-public |
| POSTGRES_SSL | No | false | Enable TLS for Postgres |
| POSTGRES_SSL_REJECT_UNAUTHORIZED | No | false | Verify server TLS certificate |

### Oracle
| Variable | Required | Notes |
| --- | --- | --- |
| ORACLE_CONNECTION_STRING | No (alt. to individual vars) | Easy Connect Plus or TNS descriptor. Required for multi-host HA/failover. When set, HOST/PORT/SERVICE_NAME/SID are not required. Example: `host1:1521,host2:1521/MYSERVICE` |
| ORACLE_HOST | Yes (unless ORACLE_CONNECTION_STRING set) | Oracle host |
| ORACLE_PORT | No | Defaults to 1521 |
| ORACLE_USER | Yes | Oracle username |
| ORACLE_PASSWORD | Yes | Oracle password |
| ORACLE_SERVICE_NAME or ORACLE_SID | Yes (unless ORACLE_CONNECTION_STRING set) | At least one is required |
| ORACLE_SCHEMA | No | Defaults to `MAIN` |

### SQL Server
| Variable | Required | Notes |
| --- | --- | --- |
| MSSQL_HOST | Yes | SQL Server host |
| MSSQL_PORT | No | Defaults to 1433 |
| MSSQL_USER | Yes | SQL Server username |
| MSSQL_PASSWORD | Yes | SQL Server password |
| MSSQL_DATABASE | Yes | Database name |
| MSSQL_SCHEMA | No | Defaults to `dbo` |

### MySQL
| Variable | Required | Notes |
| --- | --- | --- |
| MYSQL_HOST | Yes | MySQL host |
| MYSQL_PORT | No | Defaults to 3306 |
| MYSQL_USER | Yes | MySQL username |
| MYSQL_PASSWORD | Yes | MySQL password |
| MYSQL_DATABASE | Yes | Database name |

### Spanner
| Variable | Required | Notes |
| --- | --- | --- |
| SPANNER_PROJECT_ID | Yes | GCP project |
| SPANNER_INSTANCE_ID | Yes | Spanner instance |
| SPANNER_DATABASE_ID | Yes | Spanner database |

## Backend (Optional Integrations)
| Variable | Required | Notes |
| --- | --- | --- |
| EMAIL_CONFIG_NAME | No | Display name for the seeded default email config |
| EMAIL_PROVIDER | No | Email provider to seed on first deploy (`resend`, `sendgrid`, `mailgun`, `mailjet`, `smtp`) |
| EMAIL_API_KEY | No | Provider API key or SMTP password used when seeding the default email config |
| EMAIL_FROM_NAME | No | Sender name for the seeded default email config |
| EMAIL_FROM_EMAIL | No | Sender email for the seeded default email config |
| EMAIL_REPLY_TO | No | Optional reply-to address for the seeded default email config |
| EMAIL_SMTP_HOST | No | SMTP host when `EMAIL_PROVIDER=smtp` |
| EMAIL_SMTP_PORT | No | SMTP port when `EMAIL_PROVIDER=smtp` |
| EMAIL_SMTP_SECURE | No | SMTP TLS flag when `EMAIL_PROVIDER=smtp` |
| EMAIL_SMTP_USER | No | SMTP username when `EMAIL_PROVIDER=smtp` |
| CAMUNDA_BASE_URL | No | External Camunda engine |
| EG_ENGINE_ALLOWED_HOSTS | Required for production engine traffic | unset | Comma-separated exact host names or narrow organizational patterns such as `*.engines.example.com` for direct engines, sidecars, and OAuth token endpoints; public/effective-suffix patterns are rejected and private hosts require an exact entry |
| EG_ENFORCE_ENGINE_ENDPOINT_POLICY | No | true in production | Enforce HTTPS and `EG_ENGINE_ALLOWED_HOSTS`; production cannot disable the policy, while `true` exercises it outside production |
| EG_ENGINE_ALLOW_PRIVATE_HOSTS | No | false | Additional explicit opt-in for a reviewed private/address-literal/single-label/loopback/Docker-local engine or sidecar; also requires an exact allowlist entry |
| EG_ALLOW_INSECURE_ENGINE_HTTP | No | false | Separate temporary migration override for an allowlisted private HTTP endpoint; it does not bypass the private-host opt-in |
| EG_ADMIN_INTEGRATION_ALLOWED_HOSTS | Required for custom production Git/PII endpoints | built-in public Git hosts only | Exact hosts or narrow organizational suffixes for Git OAuth/API and external PII calls; broad wildcards are rejected and private hosts require an exact entry |
| EG_ENFORCE_ADMIN_INTEGRATION_ENDPOINT_POLICY | No | true in production | Enforce HTTPS, DNS/private-address validation and pinning, redirect rejection, timeouts, and bounded bodies; production cannot disable it |
| EG_ADMIN_INTEGRATION_ALLOW_PRIVATE_HOSTS | No | false | Explicit opt-in for a reviewed private/single-label/address-literal Git or PII endpoint; also requires an exact allowlist entry |
| EG_IDENTITY_PROVIDER_ALLOWED_HOSTS | Required for production direct SSO | unset | Comma-separated exact OIDC/SAML/LDAP hosts or narrow organizational patterns such as `*.login.example.com`; broad public/effective-suffix patterns are rejected and private hosts require an exact entry |
| EG_ENFORCE_IDENTITY_PROVIDER_ENDPOINT_POLICY | No | true in production | Enforce HTTPS/LDAPS, host allowlisting, redirect rejection, and bounded responses; production cannot disable it |
| EG_IDENTITY_PROVIDER_ALLOW_PRIVATE_HOSTS | No | false | Additional explicit opt-in for a private/single-label/loopback identity endpoint; also requires an exact allowlist entry |
| EG_IDENTITY_FLOW_RATE_LIMIT_MAX | No | 300 in production | Successful and failed unauthenticated provider start/callback requests allowed per IP per 15 minutes |
| SSO_DIAGNOSTICS_INTERVAL_MS | No | 60000 in production; disabled outside production | Scheduler cadence for authoritative LDAP reconciliation. Production treats omitted, zero, or malformed values as 60000 so scheduled revocation cannot silently stop |
| EG_LDAP_RECONCILIATION_IDENTITY_LIMIT | No | 10000 | Hard identity budget for one authoritative LDAP reconciliation; maximum 50000 |
| EG_LDAP_RECONCILIATION_CONCURRENCY | No | 4 | Bounded worker count for group resolution during directory reconciliation; maximum 16 |
| EG_LDAP_RECONCILIATION_GROUP_QUERY_LIMIT | No | 10000 | Aggregate reverse-group query budget for one complete reconciliation; maximum 100000 |
| EG_LDAP_RECONCILIATION_GROUP_RESULT_LIMIT | No | 100000 | Aggregate returned group-entry budget for one complete reconciliation; maximum 500000 |
| EG_LDAP_GROUP_SEARCH_QUERY_LIMIT | No | 100 | Hard reverse-group query budget per identity; maximum 1000 |
| EG_LDAP_GROUP_SEARCH_RESULT_LIMIT | No | 5000 | Hard returned/unique-group budget per identity; maximum 10000 |
| CAMUNDA_USERNAME | No | Camunda auth |
| CAMUNDA_PASSWORD | No | Camunda auth |
| Identity provider and provisioning credentials | Platform settings | Configure OIDC, SAML, or LDAP providers as `IdentityProvider` records with secret references; configure independent SCIM 2.0 directories as `IdentityProvisioningDirectory` records with a reveal-once credential or a configuration-bundle secret reference; set the production endpoint allowlist separately. Legacy `MICROSOFT_*` and `GOOGLE_*` environment variables are unsupported. Background OIDC/SAML lifecycle is provider-push through SCIM rather than a vendor-specific Microsoft Graph polling job. |
| RUNTIME_INVENTORY_RECONCILIATION_INTERVAL_MS | No | disabled | Positive milliseconds for scheduled runtime inventory refresh of active resource-aware engines |
| RUNTIME_INVENTORY_RECONCILIATION_TENANT_IDS | No | global | Comma-separated tenant ids; use `global`/`null` for the OSS/default tenant |
| RUNTIME_INVENTORY_RECONCILIATION_RUN_ON_START | No | false | Run a reconciliation pass after backend startup |
| EG_CONFIG_BUNDLE_PATH | No | unset | Absolute path to a mounted JSON configuration envelope or folder-style ZIP archive |
| EG_CONFIG_BOOTSTRAP_MODE | No | disabled | `disabled`, `validate`, or `apply`; no bundle is read when disabled |
| EG_CONFIG_EXPECTED_SHA256 | No | unset | Optional SHA-256 of the mounted payload |
| EG_CONFIG_EXPECTED_TENANT_SCOPE | No | unset | Expected `platform` scope; required for OSS bootstrap apply and used as a fail-closed assertion, not as a native pooled-tenant selector |
| EG_CONFIG_FAIL_CLOSED | No | true in production | Stop startup after a configured bootstrap failure |
| EG_CONFIG_REQUIRE_SECRET_PREFLIGHT | No | false | Require referenced `env://`, `file://`, or `docker://` secrets to be available before configured bootstrap validation or apply |
| EG_CONFIG_MAX_BYTES | No | 1048576 | Maximum mounted payload size in bytes |
| EG_CONFIG_SECRET_PROVIDER | No | env | `env`, `file`, or `docker` secret-reference provider |
| EG_CONFIG_SECRET_FILE_ROOT | No | unset | Required allowed root for `file://`; optional Docker secret mount root (defaults to `/run/secrets`) |

SAML 2.0 (including Microsoft Entra as IdP) is configured via **Platform Settings → Identity Providers**
using provider fields (`entityId`, `idpEntityId`, `ssoUrl`, `signingCertificateRef`, `signatureAlgorithm`), not
via dedicated backend environment variables.

Provider-neutral SSO callbacks are global:

- OIDC (including Microsoft Entra ID): `/api/auth/identity/callback`
- OIDC back-channel logout: `/api/auth/providers/{providerId}/oidc/backchannel-logout`
- SAML ACS / Reply URL: `/api/auth/providers/saml/callback`
- SAML single logout: `/api/auth/identity/{providerKey}/saml/logout`

Tenant-scoped login pages pass tenant context through OAuth `state` or SAML
`RelayState`; do not register `/api/t/:tenantSlug/...` callback URLs with Entra.

## Dev launcher behavior
- `pnpm run dev` defaults to Postgres and can auto-create `.local/docker/env/docker.env` from `infra/docker/env/examples/docker.postgres.env.example`.
- `pnpm run dev -- --db <db>` uses `.local/docker/env/docker.<db>.env` and auto-creates it from `infra/docker/env/examples/docker.<db>.env.example` if missing.
- `scripts/db-preflight.sh` validates required DB variables and installs missing DB driver packages into local `node_modules`.

## Frontend
| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| API_BASE_URL | No | empty in prod | Preferred compose-level env alias for API origin; consumed at frontend image build time |
| VITE_API_BASE_URL | No | mapped from `API_BASE_URL` | Frontend runtime variable exposed by Vite |
| API_UPSTREAM | No | `backend:${API_PORT}` | Frontend Nginx runtime upstream override |
| EG_FRONTEND_RUNTIME_API_BASE_URL | No | empty | Container-start browser API origin override; absolute HTTP(S), no credentials/query/fragment; generated into the same-origin runtime configuration document |
| EG_FRONTEND_RUNTIME_CONFIG_REQUIRED | No | `false` | Fail frontend startup when the generated runtime document does not provide a usable API base URL |
| VITE_RUNTIME_CONFIG_URL | No | Docker default `/.well-known/enterpriseglue/runtime-config.json` | Build-time pointer for custom static deployments; the standard image uses the stable same-origin endpoint |
| VITE_RUNTIME_CONFIG_REQUIRED | No | `false` | Build-time fail-closed policy; runtime `required: true` can strengthen it but never weaken it |
| VITE_FEATURE_* | No | true | Feature flags per module |

## Git & Encryption
| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| GIT_REPOS_PATH | Yes | ./data/repos | Server-side git storage |
| GIT_DEFAULT_BRANCH | Yes | main | Default git branch |
| ENCRYPTION_KEY | Yes | dev value | 64-char hex key |
