# Plugin Manager operations

Status: OSS `v0.16.0` operator runbook

Audience: deployment administrators and platform operators

The EnterpriseGlue Plugin Manager is an optional, customer-local OSS workload. It owns plugin
registry, signature-verification, offline-delivery, and deployment credentials. The browser and
ordinary backend store only safe installation intents, reviews, approvals, and observations.

## Supported v0.16 lifecycle

| Operation | Native manager | Existing fallback |
| --- | --- | --- |
| Discover and inspect | Carbon UI, signed catalog v2 | `eg-plugin catalog` |
| Plan and approve | Carbon UI, API, GitOps | Installer CLI plan output |
| Install and upgrade | Connected or signed offline manager flow | `eg-plugin install-*` / `upgrade-*` |
| Retry and cancel | Carbon UI and API | Resume or supersede the installer execution |
| Enable and disable | Existing host runtime controls | `eg-plugin enable` / `disable` |
| Roll back | Not yet in manager intent v1 | `eg-plugin rollback` |
| Export or uninstall | Not yet in manager intent v1 | `eg-plugin uninstall --data-action ...` |
| Host-upgrade preflight | Compatibility matrix CLI | `eg-plugin verify-compatibility-matrix` |

Do not represent the last three fallback operations as manager capabilities. Their future manager
protocol needs explicit prior-release authority, application-data disposition, and whole-fleet
target-host inputs that installation intent v1 deliberately does not guess.

## Required material

Prepare a deployment-owned directory readable only by the OSS backend and manager identities:

- `manager-config.json` using `manager-config.plugin.enterpriseglue.io/v1`;
- `workload-token`, shared only between backend and manager;
- `trust.json`, containing public publisher trust only;
- `cosign-policy.json`, binding protected workflow, source repository, builder, and subject;
- optional read-only registry authentication and private CA files;
- signed `catalog-v2.json` and its detached signature for safe discovery; and
- an optional local-registry authentication file for air-gapped import.

Use immutable image subjects (`repository@sha256:digest`) everywhere. Reject tags such as
`latest`. Files containing tokens or registry credentials must be mode `0600`; directories must
not be group/world writable.

## Compose deployment

Released Compose installations use the source-free deployment kit. The release process creates it
with `scripts/build-plugin-compose-deployment-kit.mjs` only after the backend, frontend, and Plugin
Manager multi-architecture image digests are known. Its manifest checksums the Compose, config,
doctor, and CDN routing material.

1. Verify the release lock's Sigstore bundle and confirm the deployment-kit
   archive SHA-256 recorded in that lock, then extract the kit to its recorded
   absolute deployment root.
2. Run `scripts/prepare-compose-runtime.sh <deployment-root>`. This creates the protected manager
   state, prepares a planner configuration, and creates the external plugin gateway network.
3. Review `.env`, replace all `change_me` values, and install the workload token, signed catalog,
   catalog signature, trust policy, Cosign policy, and optional registry material in `config/`.
4. Confirm the exact OSS host version, image digests, database, architecture, and deployment mode.
5. Run `scripts/plugin-deployment-doctor.sh <deployment-root>`. It verifies
   every extracted component against the kit manifest before rendering the
   selected Compose topology.
6. Start planner mode first:

```bash
docker compose \
  --project-directory /opt/enterpriseglue/plugin-deployment \
  --env-file /opt/enterpriseglue/plugin-deployment/kit/infra/docker/compose/.env \
  -f /opt/enterpriseglue/plugin-deployment/kit/infra/docker/compose/docker-compose.selfhost.yml \
  -f /opt/enterpriseglue/plugin-deployment/kit/infra/docker/compose/docker-compose.plugin-manager.yml \
  --profile plugins-planner up -d
```

Planner mode verifies, produces the exact approved lifecycle output, and leaves application of the
deployment change to the operator. Managed mode is explicit opt-in because Docker socket access is
host-equivalent authority:

```bash
DOCKER_GID="$(stat -f '%g' /var/run/docker.sock 2>/dev/null || stat -c '%g' /var/run/docker.sock)" \
docker compose \
  --project-directory /opt/enterpriseglue/plugin-deployment \
  --env-file /opt/enterpriseglue/plugin-deployment/kit/infra/docker/compose/.env \
  -f /opt/enterpriseglue/plugin-deployment/kit/infra/docker/compose/docker-compose.selfhost.yml \
  -f /opt/enterpriseglue/plugin-deployment/kit/infra/docker/compose/docker-compose.plugin-manager.yml \
  --profile plugins-managed up -d
```

Keep the manager read-only, capability-free, `no-new-privileges`, and without a published port.
Only the local health probe uses port 8788.

The managed adapter requires its project directory, fixed self-host Compose input, generated plugin
overlay, and installer output to remain below one non-symlink state root. The production kit mounts
the deployment input read-only below that root and uses the same absolute path for the host state
bind and container state target. Do not change only one side: generated plugin asset and state paths
would cease to be visible to the host Docker daemon. Back up this state directory rather than the
legacy named volume.

## Kubernetes and OpenShift deployment preview

Kubernetes and OpenShift remain a technical preview in v0.16.0. The namespace
RBAC and manager charts render and pass security checks, but OSS does not yet
ship the host chart integration and shared read-only plugin-asset mount needed
by every backend replica. Do not describe this topology as production-ready or
use the chart-only flow for a customer deployment.

For a controlled development environment, install the namespace-scoped
installer RBAC once, then render the manager chart with an immutable image:

```bash
helm upgrade --install enterpriseglue-plugin-installer-rbac \
  ./infra/kubernetes/helm/enterpriseglue-plugin-installer-rbac \
  --namespace enterpriseglue-plugins --create-namespace

helm upgrade --install enterpriseglue-plugin-manager \
  ./infra/kubernetes/helm/enterpriseglue-plugin-manager \
  --namespace enterpriseglue-plugins \
  --set-string image='ghcr.io/enterpriseglue/plugin-manager@sha256:<digest>'
```

Create the configuration Secret before the second command. The chart has no
browser-facing Service, denies inbound pod traffic, runs with a read-only root
filesystem, and retains its PVC on chart removal. A production qualification
still requires the future OSS host integration, a multi-replica shared asset
volume, end-to-end upgrade/rollback tests, and the published-artifact matrix.

## Connected installation

1. Add an immutable release subject from the approved registry or select one from the signed
   catalog.
2. Inspect all seven review sections: identity; compatibility; permissions/data; infrastructure;
   migration/backup/rollback; entitlement/update policy; exact review and plan digests.
3. Approve only the exact displayed review digest, plan digest, and revision.
4. Watch **Installation activity**. Security failures are terminal; bounded transport failures may
   be retried.
5. After the workload is staged and ready, enable it separately from **Installed**.

The manager rejects mutable subjects, unknown contract fields, missing exact-host evidence,
revoked releases, inactive entitlement, expired approvals, changed plans, and revision conflicts
before deployment mutation.

## Offline installation preview

The manager can consume a signed `.egdelivery` directory produced from the same
release graph as the connected path. It is never uploaded through the browser
or backend. The v0.16.0 OSS release permanently publishes the generic
installation toolchain air-gap archive, but a complete commercial-plugin
delivery with entitlement and private artifact closure remains preview until
the customer portal/export service is available.

```bash
eg-plugin-manager import-delivery \
  --delivery /media/customer-transfer/example.egdelivery \
  --intake /opt/enterpriseglue/plugin-manager/state/releases \
  --trust /etc/enterpriseglue/plugin-manager/trust.json
```

The importer validates path normalization, file count/size bounds, hashes, the detached delivery
signature, release signature, signed air-gap inventory, and all referenced content before an
atomic move into the protected intake. The lifecycle then imports OCI content into the approved
local registry and verifies destination digests before planning. Air-gapped configuration must
deny public egress; transfer media is not itself trusted.

Renew trust, revocation, entitlement, and catalog snapshots before their signed expiry. v0.16 does
not define delta delivery; provide a new complete signed delivery.

## GitOps reconciliation

`PluginInstallation` desired state uses the same host API and therefore the same release, review,
approval, and execution records as the UI:

```bash
eg-plugin-manager reconcile \
  --host https://enterpriseglue.customer.example \
  --token-file /run/secrets/enterpriseglue-gitops-token \
  --desired ./plugin-installations.json
```

The reconciler creates at most one install or upgrade intent per run. It does not bypass human
approval, expand manager authority, or place deployment credentials in CI.

## Backup and restore

Back up these items together at a consistent point:

- PostgreSQL plugin installation intent/review/approval/observation/capability tables;
- the manager PVC or production Compose manager state bind (or the legacy
  `plugin_manager_state` volume for an older planner-only deployment);
- the deployment-owned installer state and rendered deployment files;
- signed catalogs, releases, trust snapshots, acquisition receipts, and prior artifacts; and
- deployment-owned secrets through the customer's secret-management backup process.

Do not put registry credentials, workload tokens, or private keys in an application database or
support bundle. After restore, start the backend first, then the manager. A manager resumes by
execution ID and plan digest; it must not repeat a completed phase. If the database and execution
journal revisions disagree, stop mutation and use manual recovery rather than deleting either
record.

## Recovery and rollback

- **Transport/acquisition failure:** correct registry, proxy, CA, or local-registry configuration,
  then use **Retry**. Signature, provenance, revocation, compatibility, entitlement, and digest
  failures are not retryable without new signed authority.
- **Expired or changed review:** create a new installation intent and approve its new digest.
- **Lease expiry or manager restart:** allow the manager to reclaim the intent; do not create a
  duplicate request.
- **Operator cancellation:** cancellation stops an unapproved/requested change and preserves prior
  state.
- **Plugin rollback:** use the retained `eg-plugin rollback` v0.14-compatible CLI path and the exact
  prior signed artifact. Respect the signed rollback class and required backup.
- **Uninstall:** use `eg-plugin uninstall --data-action retain|export|delete`. Entitlement expiry
  never chooses a data action and never deletes customer data.
- **Manager rollback:** stop the optional manager workload. Existing plugins and v0.14 CLI controls
  remain usable; manager database records are additive and have down migrations.

## Host upgrade procedure

Before changing the OSS host:

1. Pin the target backend/frontend/manager image digests.
2. Obtain the signed current/previous host and plugin compatibility matrix.
3. Run `eg-plugin verify-compatibility-matrix` for every installed plugin release.
4. Confirm rollback artifacts and database backups are available.
5. Upgrade a non-production topology, verify plugin readiness, then promote.

The v0.16 manager UI does not yet aggregate this fleet check. Do not infer target-host compatibility
from the current green runtime state.

## Incident checklist

- Record installation ID, plugin ID, safe reason code, revision, review digest, plan digest, and
  timestamps.
- Preserve the execution journal and acquisition receipts before retrying.
- Check `/_manager/health` and `/_manager/ready` locally; never publish these endpoints publicly.
- Check backend/manager clock skew when approvals or catalogs appear expired.
- Verify workload identity and capability freshness when the UI reports the manager unavailable.
- Never attach registry configuration, tokens, kubeconfig, Docker socket paths, raw plans, private
  keys, or plugin/customer payloads to a support case.

## Release acceptance

Before declaring a Plugin Manager release customer-ready, require green SDK compatibility
fixtures, manager restart/idempotency tests, installer adapter tests, clean-database migration,
strict authz inventory, Helm security lint, paid-plugin source and image boundaries, connected and
offline fail-closed tests, deterministic Carbon screenshots, and a private-plugin qualification
against the exact released OSS commit. Record image digests and CI URLs; a local build alone is not
a release receipt.

If protected toolchain publication needs recovery, manually dispatch `Publish plugin installation
toolchain` from `main` with the exact existing OSS `release_tag` and its exact 40-character
`source_ref`. The protected environment and workflow revalidate that binding and resume only
digest-addressed images/charts before regenerating signed receipts and distribution assets. Never
use recovery to replace an immutable artifact, repoint a release tag, or publish an untagged source
commit.
