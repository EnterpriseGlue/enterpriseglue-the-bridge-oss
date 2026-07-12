# Security Hardening Checklist

Summary: Minimum security steps before running in production.

Audience: Developers and architects.

The target config-bundle and customer-sidecar security controls, including secret references, config API scopes, SSRF/TLS policy, audit redaction, and downstream peer-token exclusion, are tracked in [Deploy Authorization Configuration](../how-to/deploy-authorization-config.md) and [Configure Authorization, Identity, And Engines](../how-to/configure-authorization-and-engines.md).

## Secrets and Credentials
- Set a strong `JWT_SECRET` (no dev defaults).
- Use a strong `ADMIN_PASSWORD`.
- Generate a secure `ENCRYPTION_KEY` (64-char hex).
- Rotate any leaked credentials immediately.

## Environment & Flags
- Set `NODE_ENV=production`.
- Ensure `IMPERSONATION_ENABLED` is **false** in production.
- Disable unused feature flags.

## Database
- Use strong database credentials.
- Enable TLS where supported (e.g., `POSTGRES_SSL=true`).
- Ensure schemas are non-public and distinct.

## Network & Access
- Restrict access to backend/admin endpoints.
- Use TLS termination at the edge.
- Limit access to the database to trusted networks.

## Operational Hygiene
- Keep dependencies updated.
- Back up databases regularly.
- Monitor logs and health endpoints.
