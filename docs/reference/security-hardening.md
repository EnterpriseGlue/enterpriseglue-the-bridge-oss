# Security Hardening Checklist

Summary: Minimum security steps before running in production.

Audience: Developers and architects.

Implemented config-bundle controls and remaining customer-sidecar controls are documented in [Deploy Authorization Configuration](../how-to/deploy-authorization-config.md) and [Configure Authorization, Identity, And Engines](../how-to/configure-authorization-and-engines.md).

## Secrets and Credentials
- Set a strong `JWT_SECRET` (no dev defaults).
- Use a strong `ADMIN_PASSWORD`.
- Generate a secure `ENCRYPTION_KEY` (64-char hex).
- Rotate any leaked credentials immediately.
- Keep credentials out of configuration bundles. Use `env://` or approved
  `file://` references and enable `EG_CONFIG_REQUIRE_SECRET_PREFLIGHT=true` for
  production bootstrap.
- Mount bundle and file-secret projections separately and read-only. Do not bake
  either into an image or commit local projection directories.

## Environment & Flags
- Set `NODE_ENV=production`.
- Ensure `IMPERSONATION_ENABLED` is **false** in production.
- Disable unused feature flags.
- Keep `EG_CONFIG_FAIL_CLOSED=true`, pin reviewed bundle content with
  `EG_CONFIG_EXPECTED_SHA256`, and require the expected tenant scope for apply.

## Database
- Use strong database credentials.
- Enable TLS where supported (e.g., `POSTGRES_SSL=true`).
- Ensure schemas are non-public and distinct.

## Network & Access
- Restrict access to backend/admin endpoints.
- Use TLS termination at the edge.
- Limit access to the database to trusted networks.
- Require shared engines to use resource-aware access and one resolved
  same-tenant inventory row before runtime access. Never use default tenant,
  broad engine, or Engine Set access to bypass quarantine.
- Keep topology/mapping diagnostics authenticated. The public `/metrics`
  endpoint must remain aggregate and identifier-free.

## Operational Hygiene
- Keep dependencies updated.
- Back up databases regularly.
- Monitor logs and health endpoints.
- Route traffic on `/ready`, not `/health`. Monitor the bounded
  `enterpriseglue_config_bootstrap_*` metrics and retain apply-run receipts for
  deployment evidence. Metrics deliberately omit the bundle hash.
- Monitor `enterpriseglue_engine_tenancy_metrics_collection_success`,
  unresolved/conflicting/stale resource gauges, and default-fallback rates.
  Investigate with authenticated diagnostics; never weaken fail-closed runtime
  enforcement to clear an alert.
- Monitor `enterpriseglue_login_experience_total` and the corresponding
  duration aggregates by their bounded `method` and `event` labels. Do not add
  provider, tenant, user, email, domain, IP, request, or session labels; those
  would turn an operational aggregate into identity-tracking data.
- Treat the hash in health/readiness, logs, and receipts as configuration
  metadata. Those surfaces use stable generic issue codes and must never be
  changed to expose raw parser, provider, or secret-resolution exceptions.
