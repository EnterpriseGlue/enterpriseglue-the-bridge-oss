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

Set `database.profile.databaseType=postgres` and
`database.profile.tenancyMode=pooled` together to activate the schema-epoch bridge. The chart
renders those values explicitly into each database workload so the ConfigMap cannot select a
different runtime contract. The exact environment name is `EG_TENANCY_MODE`; legacy
`TENANCY_MODE` data in a projected ConfigMap has no effect. Application startup is then verify-only. The separately credentialed
owner hook always renders and can apply only the exact signed 0130-to-0131 transition;
`database.migration.enabled` cannot skip it or extend it to the later enforcement migration.
The owner rejects a fresh database, empty ledger, partial ledger, or any other predecessor before
DDL; new managed shards need a separate signed bootstrap/recovery artifact.

Managed PostgreSQL pooled releases may enable `database.releaseEffectCohort`. The chart then
orders the owner migration at hook weight `-20`, restricted schema/policy preflight at `-10`, and
the cohort opener at `0`, before Kubernetes creates API or worker Deployments. The opener uses
`database.applicationSecretName`, a dedicated ServiceAccount with no Kubernetes API token, and
only `ReleaseEffectSettlementService.open`; it has no migration, synchronization, repair, seed,
or owner-credential path. The explicit release ID, positive cohort epoch, inventory version, and
inventory SHA-256 are placed on the opener, API, and worker environments and rollout annotations.
The opener verifies the returned identity, inventory, `state=open`, and `revision=1`. A retry of
the same open cohort converges; a changed identity, changed inventory, or closing/settled cohort
blocks rollout.

```yaml
database:
  profile: { databaseType: postgres, tenancyMode: pooled }
  releaseEffectCohort:
    enabled: true
    releaseId: sha256:<digest-of-the-verified-candidate-receipt-bytes>
    cohortEpoch: <positive-safe-integer>
    inventoryVersion: release-effect-inventory.enterpriseglue.io/v1
    inventorySha256: <sha256-from-the-signed-release-receipt>
serviceAccounts:
  cohort: { create: true, name: "", annotations: {}, automountServiceAccountToken: false }
```

The deployment controller must verify the candidate signature, source revision, backend/chart
subjects, manifest, owner-transition implementation digest, and effect inventory. It then computes
the SHA-256 of those exact verified receipt bytes and supplies `sha256:<64 lowercase hex>` as the
release ID; the value is propagated and stored unchanged. The chart requires the inventory values to equal its packaged
manifest. `database.releaseEffectCohort` also requires the explicit `postgres`/`pooled` profile;
that profile always renders the owner and restricted preflight hooks even when their legacy enable
booleans are false. The separate settlement runbook defines retirement and fail-closed coverage;
opening a cohort does not establish maintenance or shutdown eligibility.

For the managed bridge, application, migration, and preflight Secret names are pairwise distinct.
Migration and preflight ServiceAccounts are distinct, and an enabled cohort opener uses a third
distinct ServiceAccount. The preflight database login is membership-free and reads PostgreSQL
relation ACL catalogues without inheriting either owner or runtime privileges.

For PostgreSQL, `database.migration.runtimeRole` names an existing restricted runtime login. Outside
the bridge profile it refreshes ordinary grants after successful owner migrations. In the bridge
profile it grants only `SELECT`, `INSERT`, and `UPDATE` on the exact 0131
`release_effect_cohorts` table and verifies that exact result; it does not use the generic refresh
or alter default privileges. The value is emitted as `EG_POSTGRES_RUNTIME_ROLE` only
on the owner and read-only preflight jobs, never API or worker. The login must have no memberships,
ownership, administrative attributes, database CREATE or schema CREATE privilege. The migration
identity must own all tables and sequences in the configured schema. Roles and credentials remain
operator-managed; the hook never creates or alters roles.

Refresh atomically replaces direct grants with CRUD on current tables, SELECT on the TypeORM
migration ledger, and USAGE/SELECT (not UPDATE) on sequences. Future owner-created tables and
sequences default to SELECT only until another successful refresh. Unsafe PUBLIC privileges or
global default ACLs fail closed instead of silently retaining write authority. Existing RLS is
unchanged. An unset value preserves existing behavior; explicitly configuring this environment
variable on a non-PostgreSQL connection or an ordinary verify-mode process is an error. The signed
bridge preflight is the sole verify-mode exception and only inspects the exact cohort grant.
Removing the setting stops future refreshes but does not revoke existing grants.

For private managed databases that require a local authentication proxy, enable the cloud-neutral
`database.connectionProxy` sidecar with a digest-pinned image and deployment-owned arguments.
The API, worker, migration and preflight service accounts may then opt into projected workload
identity tokens with `automountServiceAccountToken: true`; the default remains `false`, and the
frontend and cohort opener never receive a service-account token. Jobs use Kubernetes native sidecars so the proxy
does not prevent completion. Provider-specific instances, identities and arguments stay outside
this chart.

When the profile is omitted, uses another adapter, or selects single tenancy,
`database.migration.enabled` retains its historical contract: `true` renders the generic owner
job and verify-only applications; `false` omits the owner job and selects the backward-compatible
application-owned migration path. The bridge profile never sends its bounded runtime-role grant
setting to application containers; preflight receives only the role name for read-only verification.

## API-only platform configuration bootstrap

`apiConfigBundle` is disabled by default. It delivers an existing non-secret JSON configuration
bundle envelope and exactly one dedicated Secret key only to the split API container. It is not
a new configuration administration API, does not create Kubernetes credentials, and does not
change identity-provider verification or database permissions. The existing bootstrap owns
preview, secret preflight, hash checking, apply receipts and readiness behavior.

```yaml
apiConfigBundle:
  enabled: true
  configMapName: platform-config-bundle-<content-hash>
  configMapKey: config-bundle.json
  expectedSha256: <sha256-of-exact-final-envelope-bytes>
  mode: validate
  secret:
    name: api-platform-credential-<version>
    key: client-secret
```

The deployment operator creates the immutable, version-specific ConfigMap and dedicated Secret
before rollout. Secret bytes must not appear in Helm values, the ConfigMap or rollout artifacts.
The API receives `EG_CONFIG_BUNDLE_SECRET` through a non-optional `secretKeyRef`; the envelope
references it as `env://EG_CONFIG_BUNDLE_SECRET` (without a leading `ref:`). No arbitrary
environment names, additional credentials or extra volumes are accepted through this setting.

Only `configMapKey` is projected read-only at
`/etc/enterpriseglue/platform-config/<configMapKey>`. The API receives
`EG_CONFIG_BUNDLE_PATH`, `EG_CONFIG_BOOTSTRAP_MODE`, and `EG_CONFIG_EXPECTED_SHA256` along with
fixed platform scope, required secret preflight, fail-closed behavior and the environment secret
provider. The same file hash is recorded in `enterpriseglue.io/api-config-bundle-sha256` on the
API pod, so a changed approved hash triggers rollout. Reserved bootstrap annotations cannot be
overridden by global `podAnnotations`. The chart advertises
`enterpriseglue.io/api-config-bundle-contract: v1`; consumers must also verify its actual schema
and rendered mount/environment isolation, not trust the annotation alone.

First qualify `mode: validate`, then explicitly select `mode: apply` with the same approved file
hash. Validate mode does not persist a provider or prove signup works. Apply is a platform/global
configuration mutation even when deployed in a preview API: retained releases sharing the
database must remain compatible and must have the appropriate API-only credential available
before they can route the configured identity callback. The bundle's explicit ownership and
additive semantics govern what is changed; repeated identical bootstrap bytes reuse the durable
apply identity rather than granting permission to reset unrelated provider configuration.

Workers, frontend, migration/preflight hooks and Plugin Manager receive neither the bootstrap
mount nor these environment settings. Enabled delivery requires `workers.enabled=true` to avoid
placing the credential in a combined background-worker runtime. Reusing the shared application,
migration, preflight or Plugin Manager Secret, or the shared database ConfigMap, is rejected.
Operators must likewise keep those resources dedicated outside this chart.

Qualify bootstrap under the application's restricted database role and real RLS configuration;
successful rendering is not database or authentication acceptance. This setting never enables
DDL, owner credentials, RLS bypass or a global tenant administration endpoint. Disabling delivery
removes the API mount/environment but does not revert configuration already persisted by apply.
Use the normal reviewed configuration ownership workflow for any persisted change.

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
