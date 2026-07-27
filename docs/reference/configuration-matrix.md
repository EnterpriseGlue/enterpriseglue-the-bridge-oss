# Configuration Matrix

Summary: Required and optional environment variables for the platform.

Audience: Developers and architects.

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
| CAMUNDA_USERNAME | No | Camunda auth |
| CAMUNDA_PASSWORD | No | Camunda auth |
| ENTERPRISEGLUE_PLUGIN_STATE_FILE | No | Installer-rendered read-only plugin state |
| ENTERPRISEGLUE_PLUGIN_EXECUTION_OBSERVATION_FILE | No | Installer-rendered read-only safe lifecycle observation; display-only, with workload reconciliation explicitly not checked |
| ENTERPRISEGLUE_PLUGIN_GATEWAY_RATE_WINDOW_SECONDS | No | Shared rate window; default `60` seconds |
| ENTERPRISEGLUE_PLUGIN_GATEWAY_SUBJECT_REQUESTS_PER_WINDOW | No | Shared subject/operation request ceiling; default `120` |
| ENTERPRISEGLUE_PLUGIN_GATEWAY_PLUGIN_REQUESTS_PER_WINDOW | No | Shared per-plugin request ceiling; default `2000` |
| ENTERPRISEGLUE_PLUGIN_GATEWAY_MAX_CONCURRENT_PER_OPERATION | No | Shared active operation ceiling using crash-expiring database leases; default `32` |
| ENTERPRISEGLUE_PLUGIN_GATEWAY_CIRCUIT_FAILURE_THRESHOLD | No | Replica-local immediate circuit threshold; default `3` |
| ENTERPRISEGLUE_PLUGIN_GATEWAY_CIRCUIT_OPEN_SECONDS | No | Replica-local circuit cooldown; default `30` seconds |
| ENTERPRISEGLUE_PLUGIN_EVENT_MAX_OUTSTANDING_PER_PLUGIN | No | Durable active event backlog per plugin; default `10000` |
| ENTERPRISEGLUE_PLUGIN_EVENT_MAX_OUTSTANDING_PER_SUBSCRIPTION | No | Durable active event backlog per tenant subscription; default `1000` |
| ENTERPRISEGLUE_PLUGIN_EVENT_CIRCUIT_FAILURE_THRESHOLD | No | Deployment-wide consecutive retryable event-delivery failures before opening that tenant subscription circuit; default `3` |
| ENTERPRISEGLUE_PLUGIN_EVENT_CIRCUIT_OPEN_SECONDS | No | Deployment-wide event-delivery circuit cooldown before one durable half-open probe; default `60` seconds |
| ENTERPRISEGLUE_PLUGIN_ENGINE_EVENT_POLLING_ENABLED | No | `false` by default; opts into minimized incident/failed-job polling plus a daily product/version-only engine inventory event; inventory delivery still requires its explicit optional permission |
| ENTERPRISEGLUE_PLUGIN_DIAGNOSTIC_COLLECTOR_POLICY_FILE | No | Absolute backend-only path to a deployment-owned closed collector policy |
| ENTERPRISEGLUE_PLUGIN_DIAGNOSTIC_AUTO_COLLECTION_ENABLED | No | `false` by default; must be exactly `true` before locally filtered automatic bundles are allowed |
| MICROSOFT_CLIENT_ID | No | Microsoft Entra ID |
| MICROSOFT_CLIENT_SECRET | No | Microsoft Entra ID |
| MICROSOFT_TENANT_ID | No | Microsoft Entra ID |
| MICROSOFT_REDIRECT_URI | No | Microsoft Entra ID |
| GOOGLE_CLIENT_ID | No | Google OAuth |
| GOOGLE_CLIENT_SECRET | No | Google OAuth |
| GOOGLE_REDIRECT_URI | No | Google OAuth |

SAML 2.0 (including Microsoft Entra as IdP) is configured via **Platform Settings → SSO**
using provider fields (`entityId`, `ssoUrl`, `certificate`, `signatureAlgorithm`), not
via dedicated backend environment variables.

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
