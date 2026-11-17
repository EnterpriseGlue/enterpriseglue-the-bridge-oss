# Observability and Logs

Summary: How to monitor health and access logs for the platform.

Audience: Developers and architects.

## Health Checks
- Dev backend health endpoint: `http://localhost:8787/health` (default)
- Production (same-origin via Nginx): `http://localhost:8080/health` (default frontend host/port)

## Engine Tenancy Metrics

`/metrics` exposes bounded engine topology/resolution gauges, active
runtime-resource resolution gauges, a persistence collection-success gauge,
and process-local default-provisioning fallback counters. These series contain
no object identifiers. Use
[Diagnose Engine Tenant Resolution](../how-to/diagnose-engine-tenant-resolution.md)
for alert thresholds and authenticated investigation.

## Login Experience Metrics

The same `/metrics` response includes bounded
`enterpriseglue_login_experience_*` counters and elapsed-time aggregates for
local, recovery, OIDC, SAML, and LDAP authentication. Labels contain only the
method and event enums. They never contain provider keys, tenants, users,
emails, domains, IP addresses, request IDs, or session IDs. See
[Authentication and SSO](../how-to/auth-sso.md#privacy-safe-login-experience-metrics)
for the exact series and intended use.

## Runtime Logging

Set these variables in the backend process environment and restart to apply
changes. For a host-based run, use `backend/.env`. For Docker Compose, use the
backend environment file selected by the deployment. In Kubernetes, set the
environment on the API and worker workloads that should emit these logs.

| Variable | Values | Default |
|---|---|---|
| `EG_LOG_LEVEL` | `error\|warn\|info\|debug\|trace`, from most to least severe | `debug` |
| `EG_LOGGER_LEVELS` | Comma-separated `category:level` pairs | Inherit the global level |
| `EG_LOG_FORMAT` | `pretty\|json` | `pretty`. The production Compose example sets `json`. |
| `EG_DB_LOGGING` | `off\|error\|slow\|all` | `error` |
| `EG_DB_SLOW_QUERY_MS` | Positive integer in milliseconds | `1000` in `slow` mode |

Categories include `app` (the default for application logs), `db`, `http`,
`config-bundle`, and `auth`. A category setting replaces the global threshold
for that category. For example, `EG_LOG_LEVEL=warn` with
`EG_LOGGER_LEVELS=config-bundle:info` keeps config bundle successes visible.
Invalid values and duplicate category entries fail startup with the name of
the invalid variable.

The database policy determines which TypeORM query events are eligible. The
`db` category threshold then filters those events. The policy is independent of
`NODE_ENV` and applies across the supported TypeORM database adapters.

| `EG_DB_LOGGING` | Query events |
|---|---|
| `off` | Suppress all TypeORM query events. Schema and migration progress can still be logged. |
| `error` | Query failures at `error`. |
| `slow` | Query failures at `error` and driver-reported slow queries at `warn` when execution exceeds the threshold. |
| `all` | Query attempts at `info` and query failures at `error`. |

Database query events contain the operation and a parameter count. Slow
queries include elapsed time. SQL text, literal values, bound parameters, and
driver error messages are excluded in every mode. Set `EG_DB_LOGGING=off` to
silence query events while keeping unrelated application logs at their
configured levels.

## JSON Records

With `EG_LOG_FORMAT=json`, collect one JSON object per line from the backend's
standard output and standard error. CLI output, direct console messages, and
other services can have their own formats. Decode the container log envelope
first if the container runtime wraps the line. The log paths below use dotted
notation for nested JSON fields.

| Field | Meaning |
|---|---|
| `@timestamp` | UTC ISO 8601 timestamp. |
| `log.level` | Lowercase severity. |
| `log.logger` | Logger category, using the ECS logger field. |
| `service.name` | `enterpriseglue-backend`. |
| `message` | Human-readable message. |
| `event.action` | Stable action on instrumented events. |
| `event.outcome` | `success` or `failure` when the producer knows the outcome. |
| `event.code` | Fixed issue code when available. |
| `event.duration` | Elapsed time in nanoseconds on timed events. |
| `request.id` | HTTP correlation ID. The backend uses a bounded, safe-character `X-Request-Id` or `X-Correlation-Id`, or generates an ID if no header is supplied. |
| `trace.id` | Trace ID from a valid version-00 W3C `traceparent` header when supplied. |

The common fields follow the Elastic Common Schema logging conventions. See
[Elastic's logging reference](https://www.elastic.co/docs/reference/ecs/logging/intro)
and the [W3C Trace Context specification](https://www.w3.org/TR/trace-context/).
`request.id`, `http.route`, `config_bundle.*`, and `db.*` are application
fields. Treat inbound correlation IDs as untrusted metadata. Use opaque values
for them at the ingress.

HTTP access records use the `info` level and include the method, response
status when sent, and registered route pattern when available. Unexpected
request errors use the `error` level. Query strings, interpolated paths, and
request bodies are excluded.

Filter on `log.logger: "config-bundle"` and
`event.action: "config_bundle_validate"` or
`event.action: "config_bundle_apply"`. These actions cover startup bundle
processing and authorized config bundle preview and apply requests. The
`config_bundle.status` values are `validated`, `applied`, `accepted` (HTTP 202
with reconciliation queued), and `failed`. Failed API requests have a fixed
`validation_failed` or `apply_failed` code. Startup failures can include more
specific codes such as `hash_mismatch` or `secret_preflight_failed`. These
events carry no bundle names, paths, hashes, payloads, or error text from the
operation.

```json
{"@timestamp":"2026-11-17T08:30:00.000Z","log":{"level":"info","logger":"config-bundle"},"service":{"name":"enterpriseglue-backend"},"message":"Configuration bundle operation finished","event":{"action":"config_bundle_validate","outcome":"success"},"config_bundle":{"status":"validated"},"request":{"id":"req-01"},"trace":{"id":"4bf92f3577b34da6a3ce929d0e0e4736"}}
{"@timestamp":"2026-11-17T08:30:01.000Z","log":{"level":"warn","logger":"db"},"service":{"name":"enterpriseglue-backend"},"message":"Slow database query","event":{"action":"db_query_slow","duration":1250000000},"db":{"operation":"SELECT","parameter_count":1}}
```

## Docker Logs
```bash
docker compose --project-directory . -f infra/docker/compose/docker-compose.yml logs -f backend
```
```bash
docker compose --project-directory . -f infra/docker/compose/docker-compose.yml logs -f frontend
```
```bash
docker compose --project-directory . -f infra/docker/compose/docker-compose.yml logs -f db
```

## Host-Based Logs (deploy-localhost)
- Backend: `backend/server.log`
- Frontend: `frontend/preview.log`

## Startup Validation
- Backend prints configuration and database type on startup.
- Feature flags can be logged via backend configuration helpers.
