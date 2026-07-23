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
| JWT_SECRET | Yes | dev value | Must be strong in production |
| ADMIN_EMAIL | Yes | admin@enterpriseglue.ai | Bootstrap admin user |
| ADMIN_PASSWORD | Yes | dev value | Change in production |
| FRONTEND_URL | Yes | http://localhost:5173 (dev), http://localhost:8080 (prod) | Frontend origin used by backend auth links |
| ENCRYPTION_KEY | Yes | dev value | 64-char hex key |
| ENTERPRISE_SCHEMA | No | enterprise | Must be non-public and distinct from active main schema |

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
| EG_ENGINE_ALLOWED_HOSTS | Required for production engine traffic | unset | Comma-separated exact host names or `*.suffix` patterns allowed for direct engines, sidecars, and OAuth token endpoints |
| EG_ENFORCE_ENGINE_ENDPOINT_POLICY | No | true in production | Enforce HTTPS and `EG_ENGINE_ALLOWED_HOSTS`; set `true` to exercise the production policy outside production |
| EG_ALLOW_INSECURE_ENGINE_HTTP | No | false | Explicit temporary migration override for HTTP endpoints when endpoint policy is enforced |
| CAMUNDA_USERNAME | No | Camunda auth |
| CAMUNDA_PASSWORD | No | Camunda auth |
| Identity provider credentials | Platform Settings | Configure OIDC, SAML, LDAP, or Graph-enabled Microsoft providers as `IdentityProvider` records with secret references; legacy `MICROSOFT_*` and `GOOGLE_*` environment variables are unsupported. |
| RUNTIME_INVENTORY_RECONCILIATION_INTERVAL_MS | No | disabled | Positive milliseconds for scheduled runtime inventory refresh of active resource-aware engines |
| RUNTIME_INVENTORY_RECONCILIATION_TENANT_IDS | No | global | Comma-separated tenant ids; use `global`/`null` for the OSS/default tenant |
| RUNTIME_INVENTORY_RECONCILIATION_RUN_ON_START | No | false | Run a reconciliation pass after backend startup |
| EG_CONFIG_BUNDLE_PATH | No | unset | Absolute path to a mounted JSON configuration envelope or folder-style ZIP archive |
| EG_CONFIG_BOOTSTRAP_MODE | No | disabled | `disabled`, `validate`, or `apply`; no bundle is read when disabled |
| EG_CONFIG_EXPECTED_SHA256 | No | unset | Optional SHA-256 of the mounted payload |
| EG_CONFIG_EXPECTED_TENANT_SCOPE | No | unset | Expected `platform` or tenant scope; required for bootstrap apply |
| EG_CONFIG_FAIL_CLOSED | No | true in production | Stop startup after a configured bootstrap failure |
| EG_CONFIG_REQUIRE_SECRET_PREFLIGHT | No | false | Require referenced `env://`, `file://`, or `docker://` secrets to be available before configured bootstrap validation or apply |
| EG_CONFIG_MAX_BYTES | No | 1048576 | Maximum mounted payload size in bytes |
| EG_CONFIG_SECRET_PROVIDER | No | env | `env`, `file`, or `docker` secret-reference provider |
| EG_CONFIG_SECRET_FILE_ROOT | No | unset | Required allowed root for `file://`; optional Docker secret mount root (defaults to `/run/secrets`) |

SAML 2.0 (including Microsoft Entra as IdP) is configured via **Platform Settings → SSO**
using provider fields (`entityId`, `ssoUrl`, `certificate`, `signatureAlgorithm`), not
via dedicated backend environment variables.

SSO callbacks are global:
- Microsoft OAuth: `/api/auth/microsoft/callback`
- SAML ACS / Reply URL: `/api/auth/saml/callback`

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
| VITE_FEATURE_* | No | true | Feature flags per module |

## Git & Encryption
| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| GIT_REPOS_PATH | Yes | ./data/repos | Server-side git storage |
| GIT_DEFAULT_BRANCH | Yes | main | Default git branch |
| ENCRYPTION_KEY | Yes | dev value | 64-char hex key |
