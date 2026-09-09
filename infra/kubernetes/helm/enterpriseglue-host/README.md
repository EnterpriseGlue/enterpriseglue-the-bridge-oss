# EnterpriseGlue OSS host chart

This chart is the cloud-neutral production composition for the OSS frontend, API and durable
workers. It consumes existing PostgreSQL configuration and Secret resources; it does not create a
database, public cloud resource, TLS certificate, load balancer or Secret value.

All application images must be immutable `repository@sha256:digest` references. With the default
split runtime, API replicas serve HTTP without running background pollers and worker replicas run
pollers without listening publicly. Set `workers.enabled=false` to retain the historical combined
process. That option and `EG_RUNTIME_ROLE=all` preserve self-hosted compatibility.

## Database authority

The pre-install/pre-upgrade migration hook uses `database.migrationSecretName` and applies schema
changes. The following preflight hook uses `database.preflightSecretName` and verifies that no
migration is pending. API and worker pods use `database.applicationSecretName` and
`EG_DATABASE_STARTUP_MODE=verify`, so their normal startup cannot synchronize tables, apply
migrations or install RLS. Give the migration identity DDL privileges and application/preflight
identities only the least database authority they need.

For PostgreSQL, set `database.migration.runtimeRole` to an existing restricted runtime login to
refresh its grants after successful owner migrations. This emits `EG_POSTGRES_RUNTIME_ROLE` only
on the migration job, never API, worker, or preflight. The login must have no memberships,
ownership, administrative attributes, database CREATE or schema CREATE privilege. The migration
identity must own all tables and sequences in the configured schema. Roles and credentials remain
operator-managed; the hook never creates or alters roles.

Refresh atomically replaces direct grants with CRUD on current tables, SELECT on the TypeORM
migration ledger, and USAGE/SELECT (not UPDATE) on sequences. Future owner-created tables and
sequences default to SELECT only until another successful refresh. Unsafe PUBLIC privileges or
global default ACLs fail closed instead of silently retaining write authority. Existing RLS is
unchanged. An unset value preserves existing behavior; explicitly configuring this environment
variable on a non-PostgreSQL connection or verify-mode process is an error. Removing the setting
stops future refreshes but does not revoke existing grants.

For private managed databases that require a local authentication proxy, enable the cloud-neutral
`database.connectionProxy` sidecar with a digest-pinned image and deployment-owned arguments.
The API, worker, migration and preflight service accounts may then opt into projected workload
identity tokens with `automountServiceAccountToken: true`; the default remains `false`, and the
frontend never receives a service-account token. Jobs use Kubernetes native sidecars so the proxy
does not prevent completion. Provider-specific instances, identities and arguments stay outside
this chart.

If `database.migration.enabled=false`, application pods use the backward-compatible `apply` startup
mode. This is intended for existing self-hosted installations, not pooled SaaS.

## Plugin topology

Set `pluginAssets.enabled=true` and provide a versioned ReadWriteMany claim. Every API and worker
replica mounts that claim read-only at the same path. The trusted installer is the only writer.
The optional Plugin Manager has no Service and denies all inbound pod traffic; supply the existing
namespace-scoped installer ServiceAccount/RBAC or install the dedicated installer RBAC chart.

## Ingress and rollouts

The chart's Ingress targets only the frontend. Nginx proxies same-origin API and plugin asset
requests to the internal API Service. NetworkPolicy permits backend ingress only from the frontend;
there is no direct backend or Plugin Manager ingress. HPA, PDB, topology spread, startup/readiness/
liveness probes, zero-unavailable rolling updates, resource bounds and non-root/read-only security
contexts are included.

Example:

```bash
helm upgrade --install enterpriseglue \
  oci://ghcr.io/enterpriseglue/charts/enterpriseglue-host \
  --namespace enterpriseglue --create-namespace \
  --set-string images.backend.repository=ghcr.io/enterpriseglue/enterpriseglue-the-bridge-oss-backend \
  --set-string images.backend.digest=sha256:<backend-digest> \
  --set-string images.frontend.repository=ghcr.io/enterpriseglue/enterpriseglue-the-bridge-oss-frontend \
  --set-string images.frontend.digest=sha256:<frontend-digest>
```

For rollback, keep database changes forward-compatible with the previous application release,
then run `helm rollback`. Database down migrations are never run automatically. Preserve Plugin
Manager state and plugin-owned data during disable, rollback or uninstall.
