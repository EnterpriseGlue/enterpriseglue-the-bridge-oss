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
  `EG_CONFIG_EXPECTED_SHA256`, and require
  `EG_CONFIG_EXPECTED_TENANT_SCOPE=platform` for OSS apply. Do not treat that
  assertion as a native pooled-tenant selector.
- Before enabling native `pooled` mode, use PostgreSQL, set
  `EG_TENANT_RLS_ENFORCED=true`, and verify the application role is neither a
  superuser nor granted `BYPASSRLS`. Complete the two-tenant segregated-SSO
  qualification lane documented in
  [Native SaaS Tenancy](../architecture/11-native-saas-tenancy.md#repeatable-pooled-end-to-end-qualification).

## Database
- Use strong database credentials.
- Enable TLS where supported (e.g., `POSTGRES_SSL=true`).
- Ensure schemas are non-public and distinct.
- Keep `tenants`, `tenant_discovery_domains`, and
  `tenant_discovery_challenges` outside tenant RLS; they are deliberately
  limited to bounded pre-authentication lookup and scoped administration
  services. Tenant-owned business and identity rows must remain covered by
  forced RLS in pooled mode.

## Network & Access
- Restrict access to backend/admin endpoints.
- Use TLS termination at the edge.
- Limit access to the database to trusted networks.
- Require shared engines to use resource-aware access and one resolved
  same-tenant inventory row before runtime access. Never use default tenant,
  broad engine, or Engine Set access to bypass quarantine.
- Keep topology/mapping diagnostics authenticated. The public `/metrics`
  endpoint must remain aggregate and identifier-free.
- Populate `EG_ENGINE_ALLOWED_HOSTS` before enabling engine, sidecar, or OAuth
  token traffic in production. Production cannot disable the endpoint policy.
  Use exact hosts or narrow organizational suffixes, and enable
  `EG_ENGINE_ALLOW_PRIVATE_HOSTS` only with an exact entry for a reviewed
  private endpoint. The separate insecure-HTTP switch is a temporary migration
  exception, not an allowlist bypass.
- Treat the engine allowlist as hostname validation, not DNS pinning. Keep its
  DNS zones under trusted control and enforce network-level egress denial for
  loopback, private, and cloud-metadata destinations reached through unexpected
  DNS answers.
- Populate `EG_IDENTITY_PROVIDER_ALLOWED_HOSTS` before enabling direct SSO in
  production. Keep the production endpoint policy enabled, use exact entries
  for private-host/address-literal providers, reject redirects, and enable
  `EG_IDENTITY_PROVIDER_ALLOW_PRIVATE_HOSTS` only for a reviewed internal
  IdP/directory. Callback URLs must match `FRONTEND_URL` and the canonical
  provider-neutral callback path exactly.
- Treat the IdP allowlist as a reviewed hostname policy, not DNS pinning. Keep
  allowlisted DNS zones under trusted control and enforce network-level egress
  denial for private and cloud-metadata destinations.
- Keep `EG_IDENTITY_FLOW_RATE_LIMIT_MAX` bounded and monitor pre-authentication
  429 responses. Set an LDAP reconciliation identity budget appropriate for
  the directory; a budget failure must stop without authoritative removals.
- Keep `SSO_DIAGNOSTICS_INTERVAL_MS=60000` (or another reviewed positive
  cadence) in deployed configuration. Production falls back to 60 seconds
  rather than silently disabling authoritative LDAP revocation.

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
