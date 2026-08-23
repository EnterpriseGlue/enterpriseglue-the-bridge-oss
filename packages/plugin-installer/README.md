# `@enterpriseglue/plugin-installer`

Deployment-side renderer for verified EnterpriseGlue OSS plugins.

It accepts catalog-selected, signature/digest-verified plugin records and
produces deterministic Compose and Helm values. It does not build source,
execute plugin scripts, accept arbitrary deployment templates, or expose
registry credentials to a browser.

The installer also accepts one extracted private release package:

```text
eg-plugin install-package \
  --package ./example-diagnostics-package \
  --trust ./publisher-trust.json \
  --host-version 0.4.6 \
  --output ./.enterpriseglue/plugins
```

Publisher release CI verifies the separately signed current/previous compatibility matrix against
the same signed catalog and trust root:

```text
eg-plugin verify-compatibility-matrix \
  --catalog ./catalog.json \
  --catalog-signature ./catalog.signature.json \
  --matrix ./compatibility-matrix.json \
  --matrix-signature ./compatibility-matrix.signature.json \
  --trust ./publisher-trust.json
```

The matrix must contain exactly the four passed combinations formed by distinct current/previous
OSS host versions and distinct current/previous plugin versions. Each cell binds both versions to
exact immutable host-image and plugin-bundle OCI digest references plus a suite revision, UTC test
time, and retained-evidence SHA-256. One version cannot change artifact between cells, and the
plugin artifact must equal the matching signed catalog bundle. Current versions must be newer
than previous versions; both plugin releases must be stable, non-revoked entries in the verified
catalog; and both catalog releases must list both exact host versions in `testedHostVersions`. A
missing or failed combination, signer/publisher mismatch, artifact drift, stale/revoked release,
or catalog disagreement fails closed. The command only verifies publisher release evidence and
prints bounded metadata; it does not publish artifacts, mutate installation state, or create a
customer CI requirement.

`install-package` and `upgrade-package` derive plugin ID/version from a signed,
closed package index. They verify the signed catalog, publisher/key identity,
catalog revision, every indexed file's exact size and SHA-256, manifest/resource
digests, and every runtime reference. Symlinks, traversal, unindexed files,
unreferenced runtime files, mutable image tags, and revoked catalog releases are
rejected. The exact `--host-version` must appear in the release's signed
private-CI-tested host matrix; a broad SemVer range alone is insufficient.
Before staging a declared frontend entry, the installer also runs the public
native-frontend policy. The v1 entry must be one self-contained ESM file and is
rejected for module imports/import metadata, direct browser networking,
eval-like execution, unsafe HTML, global stylesheet installation,
executable-Markdown fingerprints, or duplicate UI-runtime fingerprints. The
OSS host repeats this check after its own entry digest verification.
Only verified runtime files are staged; SBOM, provenance, vulnerability, license, malware,
secret-scan, and documentation evidence remains outside the host-served asset tree.
If no permission-grant file is supplied, only the manifest's required
permissions are granted. The `--output` directory must resolve below the mounted customer
workspace so generated asset paths stay portable for Compose and Helm. This check uses resolved
filesystem identity, so equivalent macOS `/var` and `/private/var` workspace spellings are
accepted without allowing an output outside the mounted workspace.

The lower-level `install` and `upgrade` commands accept individually supplied
catalog, manifest, resource, and permission files for controlled publisher and
platform testing. They require the same exact `--host-version` preflight as the
package, OCI, and air-gap paths; they are not a compatibility-check bypass.

Desired-state writes use a transaction journal. An interrupted operation
restores the complete previous state/Compose/Helm snapshot before another
lifecycle operation is accepted. Staged files from a failed operation are
removed. The implemented connected acquisition command is:

```text
eg-plugin install-oci \
  --subject registry.example/plugin@sha256:<digest> \
  --trust ./publisher-trust.json \
  --cosign-policy ./publisher-workflow-policy.json \
  --host-version <exact-host-version> \
  --output ./.enterpriseglue/plugins
```

It requires a digest, uses deployment-owned read-only OCI credentials, verifies the Cosign
workflow identity, discovers exactly one matching signed catalog and all six required categories
of indexed evidence referrers, reconstructs a bounded temporary package, re-verifies the
Ed25519 catalog/package trust chain, requires the signed catalog bundle to equal the requested
subject, delegates to the same package installation path, cleans up on every exit, and installs
disabled. Manifest-declared download size, direct-referrer count, attachment inventory, media
type, path, size, and SHA-256 are bounded before anything is staged. Missing, duplicate,
mis-typed, oversized, or unindexed attachments fail closed.

Registry reads use at most three attempts with bounded exponential delay for only transient
`408`/`425`/`429`/`5xx`, timeout, connection-reset/refusal, temporary-unavailability, and
interrupted-EOF failures. Authentication/authorization, CA/certificate, signature, digest,
policy, and unknown-manifest failures are not retried. Before retrying a package or referrer pull,
the installer deletes and recreates that download directory, so partial bytes cannot survive into
inventory or hash verification. The successful acquisition receipt records the retry count and
the fixed attempt ceiling.

The production keyless Cosign policy is closed and uses exact workflow claims:

```json
{
  "apiVersion": "cosign-policy.plugin.enterpriseglue.io/v1",
  "kind": "EnterpriseGluePluginCosignPolicy",
  "mode": "keyless",
  "certificateIdentity": "https://github.com/example-org/example-plugin/.github/workflows/plugin-release.yml@refs/heads/main",
  "certificateOidcIssuer": "https://token.actions.githubusercontent.com",
  "githubWorkflowRepository": "example-org/example-plugin",
  "githubWorkflowRef": "refs/heads/main"
}
```

Keyless policy cannot disable transparency-log verification. A `public-key` policy is supported
for an explicitly managed key or local/offline acceptance and may set
`ignoreTransparencyLog: true`; its `publicKeyFile` is resolved relative to the policy file.
Plain HTTP and insecure TLS are explicit, mutually exclusive test/deployment options and are
never defaults.

The packaged `scripts/eg-plugin` wrapper mounts the customer's standard Docker/OCI
`config.json` read-only, copies it into an ephemeral private acquisition directory, permits only
the selected registry network, and supplies no Docker socket, kubeconfig, host database
credential, plugin secret, or browser request. The installer image includes digest-pinned ORAS
1.3.3 and Cosign 3.1.2, their Apache-2.0 notice and license text, and the generated JavaScript
runtime-dependency license inventory. Image loading and cluster reconciliation remain separate
deployment-owned adapters. Customers run neither publisher CI nor source builds. Publication of
the installer image and customer-registry acceptance remain release gates.

The connected wrapper accepts these deployment-owned settings:

- `EG_PLUGIN_REGISTRY_CONFIG`: regular, non-symlinked Docker/OCI `config.json`;
- `EG_PLUGIN_REGISTRY_CA`: optional regular, non-symlinked private CA bundle;
- `EG_PLUGIN_REGISTRY_PROXY`: optional HTTP(S) proxy URL; and
- `EG_PLUGIN_REGISTRY_NO_PROXY`: optional proxy bypass list.

When a proxy is configured, the wrapper writes `HTTP_PROXY`, `HTTPS_PROXY`, and optional
`NO_PROXY` to an ephemeral mode-`0600` env file and passes only that file path to Docker. Proxy
credentials and registry-config contents do not appear in the container command arguments.
Carriage returns and newlines are rejected.

Every candidate lifecycle transition is evaluated against the complete
installed set and, separately, the enabled set. Required dependencies must be
present, version-compatible, and enabled before a dependent is enabled;
conflicts and cycles fail closed. Rejected install, enable, disable, upgrade,
rollback, or uninstall operations do not mutate the input state.

The same atomic output transaction writes `plugin-lifecycle-plan.json`. It
binds the desired revision and canonical plan SHA-256 to ordered stage/checkpoint/migrate/readiness/
activation/drain/deactivation/commit phases, explicit uninstall data
disposition, current/target data-schema versions, and an immutable migration
image when required. Upgrade migrations must start at the installed schema.
Rollback is rejected when the prior schema falls outside the new release's
declared `rollbackThrough` boundary. State written before this field existed is
normalized to schema zero unless its verified manifest declares a migration.

The lifecycle plan is an execution contract for a deployment-owned
Compose/Kubernetes reconciler. Writing it alone does not claim that a backup,
migration, readiness check, workload switch, export, or deletion already ran.
The OSS application never shells to this installer and never receives a
container socket, cluster credential, registry credential, or migration
command.

The transaction also writes `plugin-lifecycle-observation.json`. This is a
strict display-only derivative for the admin control API and Carbon UI. It
contains only opaque execution/revision identity, plan hash, plugin/operation,
safe phase/status/reason/timestamps, and `workloadReconciliation:
not_checked`. Raw plans, history, worker identity, commands, paths,
credentials, cluster details, and customer payload are excluded by schema.
Compose mounts only this safe derivative into the host; the full execution
record remains deployment-owned. The observation never authorizes execution.

The package also exports the deployment-worker execution contract,
`FilePluginLifecycleExecutionStoreV1`, and a strict phase runner. The private
filesystem store atomically persists a queued execution for one exact plan
hash/revision, uses compare-and-swap revisions plus an exclusive recoverable
lock, and retains bounded prior execution history. The runner enforces a single
1-300 second worker lease, calls only the strict next phase with the stable
`executionId:phase` idempotency key, preserves completed phases across
expired-lease recovery, rejects plan drift, and requires manual intervention
when failure occurs after a migration whose signed plan says rollback is
unavailable. Only an exact failed/manual-intervention revision may be
superseded, and only by the operation-specific inverse command for the same
plugin; a live execution cannot be replaced.

The package includes the fixed deployment-only Compose phase adapter and
`apply-compose` command. `scripts/eg-plugin` gives that one worker local Docker
socket access while retaining a non-root UID, read-only root, no network, no
capabilities, and a same-path deployment mount. The adapter validates bounded
regular inputs, stages immutable images/volumes, stops an enabled source before
checkpoint and migration, uses schema-versioned volumes, runs fixed no-network
migration utilities, removes an unhealthy candidate, and performs
retain/export/delete. It records one context-bound receipt after each completed
effect and SHA-256/size manifests for checkpoint/export archives. A failed
phase can therefore resume safely.

The package also includes `apply-kubernetes`, a Kubernetes/OpenShift phase
adapter, and a cluster-authoritative execution store. The store persists the
exact plan envelope, bounded history, execution lease, and safe result in one
namespace ConfigMap and uses Kubernetes `resourceVersion` replacement as its
compare-and-swap boundary. It also writes a private local mirror so socket- and
credential-free lifecycle commands cannot replace active cluster work.

The cluster adapter lints and renders the fixed chart, creates
schema-versioned identity-annotated PVCs, applies a deny-all lifecycle-job
NetworkPolicy, and runs only fixed utility or signed migration Jobs. It uses
immutable images, disables service-account tokens, applies restricted pod
security controls, drains before checkpoint/migration, re-creates a removed
candidate on readiness retry, and executes explicit retain/export/delete.
`apply-kubernetes --rollout-timeout-seconds N` bounds each workload readiness
wait to an integer from 10 through 1800 seconds; the production default is 300
seconds. A timed-out or crashing candidate is removed before the phase fails,
so an exact failed-revision inverse operation can recover without exposing the
unhealthy workload.
Checkpoint and export archives plus their SHA-256/size manifests remain on a
retained per-plugin artifact PVC. Context-bound phase receipts are immutable
ConfigMaps. OpenShift mode omits fixed UIDs so SecurityContextConstraints can
assign them while preserving the other controls.

The plan, local mirror, or cluster execution ConfigMap alone is never evidence
that an infrastructure effect ran. Require the authoritative final succeeded
execution, matching phase receipts, expected workload state, and artifact
manifest where applicable.

Customer Compose execution is two explicit steps:

```text
./scripts/eg-plugin install-package ... --output ./.enterpriseglue/plugins
./scripts/eg-plugin apply-compose \
  --output ./.enterpriseglue/plugins \
  --project-directory . \
  --compose-files compose.yaml,.enterpriseglue/plugins/docker-compose.plugins.generated.yaml \
  --project-name enterpriseglue
```

Customer Kubernetes/OpenShift execution uses the same desired-state step and
one cluster apply command:

```text
helm upgrade --install enterpriseglue-plugin-installer-rbac \
  infra/kubernetes/helm/enterpriseglue-plugin-installer-rbac \
  --namespace enterpriseglue-plugins \
  --create-namespace

./scripts/eg-plugin install-package ... --output ./.enterpriseglue/plugins

EG_PLUGIN_KUBECONFIG=./deployment-plugin-worker.kubeconfig \
./scripts/eg-plugin apply-kubernetes \
  --output ./.enterpriseglue/plugins \
  --project-directory . \
  --chart infra/kubernetes/helm/enterpriseglue-plugin-runtime \
  --values .enterpriseglue/plugins/helm.plugins.generated.values.yaml \
  --namespace enterpriseglue-plugins \
  --release-name enterpriseglue-plugins \
  --platform kubernetes
```

The first command is a one-time customer cluster-administrator bootstrap, not
CI. Use `--platform openshift` for an SCC-assigned runtime UID. The kubeconfig
must be one regular, non-symlinked, self-contained file for the dedicated
namespace-scoped installer service account created by the bootstrap chart. The wrapper mounts
only that file and the deployment directory, never the Docker socket. It uses
Helm's ConfigMap release driver, so no Kubernetes Secret access is needed.
The Role cannot access Secrets, RBAC, `pods/exec`, `pods/log`, other
namespaces, or cluster-scoped resources.
`EG_PLUGIN_KUBERNETES_NETWORK` may select a reviewed Docker network when the
API server is not reachable from the default bridge.

For an exact failed execution, inspect its safe status and either resume the
same plan with the matching apply command or create only its documented inverse plan with
`--supersede-execution-revision N`, then pass the same exact revision to
the matching apply command. Never remove a lock or edit the
plan/execution/receipt resources.

For an offline release, EnterpriseGlue delivers one directory containing the
signed package, signed `airgap-index.json`, and real digest-indexed OCI-layout
tar archives. The customer performs three offline installer steps:

```text
eg-plugin prepare-airgap \
  --airgap ./example-diagnostics-airgap \
  --trust ./publisher-trust.json \
  --host-version 0.4.6 \
  --registry-prefix registry.customer.example \
  --output ./.enterpriseglue/airgap-prepared

EG_PLUGIN_OCI_NETWORK=customer-registry-network eg-plugin import-airgap \
  --airgap ./example-diagnostics-airgap \
  --trust ./publisher-trust.json \
  --host-version 0.4.6 \
  --registry-map ./.enterpriseglue/airgap-prepared/airgap-registry-map.json

eg-plugin install-airgap-package \
  --airgap ./example-diagnostics-airgap \
  --trust ./publisher-trust.json \
  --host-version 0.4.6 \
  --registry-map ./.enterpriseglue/airgap-prepared/airgap-registry-map.json \
  --output ./.enterpriseglue/plugins
```

`prepare-airgap` verifies both signatures, publisher/catalog identity, the
package, every archive's streamed size/SHA-256 and OCI-layout media type, the
exact required bundle/backend/migration-image set, and the exact tested host.
It writes a portable import plan and a mapping whose target references retain
each source digest. `import-airgap` then reads every archive by that digest,
copies it only to the mapped customer registry through ORAS, and independently
requires the destination registry descriptor to report the same digest. It
never contacts the source registry. The final command renders only mapped
immutable references while retaining the original signed manifest in control
state. The process needs no internet connection and uses only deployment-owned,
read-only target-registry credentials.

Customers do not need Node or CI. EnterpriseGlue publishes this package as a
digest-pinned installer image; `scripts/eg-plugin` runs it with no capabilities
and a read-only root filesystem. Connected `install-oci`/`upgrade-oci` and
target-only `import-airgap` receive the selected registry network and a
read-only registry credential; ordinary verification/render commands have no
network and mount only the current deployment directory. Only `apply-compose`
additionally receives the
local Docker socket. `apply-kubernetes` instead receives only the selected
kubeconfig and cluster network. Ordinary verification/render commands receive
neither. Artifact
acquisition and signature evidence are prepared before this offline render
step.

When an enabled plugin declares a `secret_reference`, the Compose output gives
the plugin only an opaque `*_REFERENCE`, the internal host broker URL, and the
invocation public key. It mounts `plugin-secret-broker-policy.json` and
`plugin-broker-secrets/` only into the OSS backend. The CLI creates a valid
empty policy and private secret directory on first render, so use fails closed
until an operator installs a reviewed deployment policy and credential. Raw
secrets are never rendered into YAML or mounted into plugin containers.

A `deployment_file` is different: it is bounded non-secret configuration such
as a signed license document or public verification trust. The renderer
creates mode-`0600` placeholders below
`plugin-config-files/<plugin-id>/`, mounts only that plugin's declared filename
read-only, and injects a deterministic `*_FILE` path. It never permits a
manifest to select an arbitrary host path. Kubernetes filters the shared
deployment-owned ConfigMap to the current plugin's declared keys and mounts
them at the same fixed plugin configuration root.
