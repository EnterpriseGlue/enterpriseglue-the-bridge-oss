# OSS Plugin Platform and Authoring Guide

Status: as-built technical architecture for the OSS `v0.16.0` release candidate.

Last reviewed: 2026-08-25

## Purpose

EnterpriseGlue OSS provides a reusable, product-neutral plugin platform. It lets a separately
distributed plugin add additive Carbon UI and an isolated backend service without rebuilding an
OSS deployment or giving the plugin host-internal privileges.

The OSS repository owns generic contracts, host runtime, lifecycle controls, installer, and
security policy. A plugin publisher owns plugin behavior, entitlement, private product source,
and its signed release. The platform is intentionally not coupled to any particular paid plugin.

## OSS host integration

The generic platform is native OSS functionality. The optional customer-local Plugin Manager uses
the same host contracts and Carbon navigation rather than adding a separate administration
application. Published releases inject the exact host version into the final backend image and
bind that image to the SDK, manager, deployment kit, and static frontend in one signed
distribution lock.

| Surface | Host behavior | Why it belongs there |
| --- | --- | --- |
| Main or tenant plugin route | The responsive desktop header and mobile SideNav group active signed plugin navigation under **Plugins**. Root and tenant route scopes retain their own canonical paths. | A general-purpose plugin may have a product page, but it must remain visibly separate from built-in OSS navigation. |
| Platform Settings → Operations → Plugins | The generic lifecycle and emergency controls live here. Deployment-owned plugin settings appear as host-rendered links below the controls. `/admin/plugins` remains a redirect for old bookmarks. | Lifecycle state changes the whole deployment and is therefore a platform operation, not an engine action. |
| Mission Control engine, incident, failed-job, and process-instance actions | Diagnostic plugins contribute compact contextual actions at the object being investigated. A plugin may also declare one Mission Control child workspace, such as a case overview, through `parentDestination: mission-control`. | The user sends exact context at the source, while longer-running investigations remain discoverable in the same product area. |

Every added surface inherits the existing OSS Carbon Design System runtime and responsive
navigation behavior. Plugin frontend code uses the host's React, router, Carbon package, page
layout primitives, spacing tokens, and accessible fallback controls; it must not ship a parallel
design system or a second React runtime.

### Release-image immutability and browser self-containment

Release-producing Dockerfiles pin every external base and declared BuildKit
syntax image by exact `sha256`. Mission Control also renders without a public
font host: pinned IBM Plex packages ship with the application, external Carbon
font faces are removed during bundling, and production keeps
`font-src 'self' data:`.

Maintainers verify both invariants with:

```text
pnpm run guard:release-dockerfile-pins
pnpm run guard:frontend-self-contained
```

Updating a base image, syntax image, or font package is therefore an explicit
reviewed source change. Do not widen CSP or restore a mutable tag to repair a
build. Private-plugin publisher acceptance must still exercise the resulting
immutable Mission Control image; a source-server browser test is not a
substitute.

### Control-plane authorization

The plugin control API uses static OSS FGA actions instead of a broad administrator middleware:

- `platform.settings.read` protects safe plugin lifecycle, capability, audit, metrics, and
  tenant-enablement reads.
- `platform.settings.manage` protects enable/disable, emergency stop, and dead-letter replay
  mutations.
- contextual diagnostic slots use the selected engine's `engine.instances.read` decision. A
  denied engine hides the action; the invocation gateway independently enforces the static action
  before contacting the plugin.

The temporary `deploymentAdminMiddleware` and `tenantAdminMiddleware` route options remain only
as compatibility aliases for existing host tests and deployments. New integrations must use the
explicit read/manage lanes above.

## Supported plugin shapes

| Shape | Uses | Example purpose |
| --- | --- | --- |
| UI-only | Carbon frontend module and declared contributions | Read-only dashboard |
| Backend-only | Isolated service and declared operation | Policy check |
| Full-stack | Both frontend and backend | Product workflow |
| Event-driven | Minimized event subscription | Incident classification |
| Scheduled | Fixed manifest schedule | Inventory reconciliation |
| Diagnostic | Approved local collector and sanitized handoff | Support-bundle analysis |

The first version does not allow arbitrary internet-loaded UI, in-process backend extensions,
plugin install scripts, direct host-database access, caller-selected files or URLs, unrestricted
cron jobs, or arbitrary network egress.

## Host and plugin compatibility across OSS releases

The host version has two authorities with distinct purposes:

| Context | Version authority | Reason |
| --- | --- | --- |
| Source and unreleased builds | Checked-in plugin-platform release identity | Gives developers one deterministic candidate version |
| Published backend image | Immutable `vX.Y.Z` release tag injected by protected image CI | Prevents a later patch image from advertising an older host version |

The published-image workflow validates the injected value from inside the final runtime image.
Repository contract tests also require the source and production Docker defaults to match the
checked-in candidate and require both protected image-build attempts to inject the release value.

A plugin manifest may declare a SemVer host range, but that range is not sufficient for
activation. The signed private catalog must also list the exact host patch in
`testedHostVersions`, and the signed current/previous compatibility matrix must bind every tested
host/plugin pair to immutable image digests and retained evidence. Therefore a new OSS patch is
safe by default: an existing plugin remains unavailable on that exact patch until the private
plugin pipeline has tested it and published updated signed evidence. No customer-side CI or OSS
rebuild is required.

For each paid plugin repository, keep its current and previous supported plugin releases in the
matrix. Test both against the current and previous supported OSS host releases. Older combinations
remain installable only while their signed catalog entry and entitlement are active; they are not
silently treated as compatible with newer hosts.

## System boundary

```mermaid
flowchart LR
  subgraph Publisher["Plugin publisher"]
    Source["Plugin source"]
    CI["Publisher CI"]
    Bundle["Signed plugin package"]
    Catalog["Signed catalog"]
  end

  subgraph Deployment["Customer deployment control plane"]
    Installer["eg-plugin installer"]
    Policy["Publisher, entitlement, and grant policy"]
    Registry["Approved OCI registry"]
    Desired["Verified desired state"]
  end

  subgraph Host["EnterpriseGlue OSS host"]
    Control["Lifecycle and emergency controls"]
    Frontend["Same-origin Carbon module runtime"]
    Gateway["Fixed signed operation gateway"]
    Brokers["Scoped host brokers"]
  end

  subgraph Plugin["Installed plugin"]
    UI["Frontend ESM"]
    Service["Isolated backend service"]
    Data["Plugin-owned data"]
  end

  Source --> CI --> Bundle --> Registry
  CI --> Catalog --> Installer
  Registry --> Installer
  Policy --> Installer
  Installer --> Desired --> Control
  Control --> Frontend
  Control --> Gateway
  Frontend --> UI
  UI -->|"declared same-origin operation"| Gateway
  Gateway -->|"short-lived signed invocation"| Service
  Gateway --> Brokers --> Service
  Service --> Data
```

The installer is the only component that changes deployment desired state or renders Compose and
Helm output. The host can enable, disable, or emergency-stop an already installed plugin; it does
not receive Docker, Kubernetes, registry, or publisher-build authority.

## Public contracts

The authoritative TypeScript and Zod contracts are in
[`packages/plugin-sdk`](../../packages/plugin-sdk). The runtime implementation is in
[`packages/plugin-runtime`](../../packages/plugin-runtime).

| Contract | Rule |
| --- | --- |
| Manifest | Closed, versioned, reverse-DNS identity, immutable image digest, declared compatibility, permissions, and an optional static end-user authorization action for each interactive backend operation |
| Frontend module | Same-origin ESM, manifest-equal identity and contributions, shared host React/router/Carbon runtime |
| Backend capability | Fixed health/readiness/capability paths plus closed declared operations |
| Invocation claim | Short-lived Ed25519 token with plugin, tenant, deployment, subject, operation, request digest, and one-time ID |
| Broker request | Declared permission, operation-specific schema, and host-derived scope are all required |
| Lifecycle state | Installed, enabled, healthy, compatible, degraded, or disabled; installation and enablement are separate |

Generated manifest and capability schemas are packaged with the SDK:

```text
@enterpriseglue/plugin-sdk/schema/enterpriseglue-plugin-manifest-v1.schema.json
@enterpriseglue/plugin-sdk/schema/enterpriseglue-plugin-platform-capabilities-v1.schema.json
```

The host exposes a safe, no-store capability projection to deployment administrators. It includes
supported protocol and SDK lines, exact shared frontend runtime, named permissions, slots, events,
egress-policy identifiers, and trusted publishers. It does not expose credentials, destinations,
tenant/resource identifiers, customer content, or plugin payloads.

### Fine-grained authorization contract

Fine-grained access control (FGA) in OSS is the authority for an end user's ability to invoke a
plugin operation. Plugin installation, entitlement, and `permissions.required` are separate
controls: they decide whether the plugin may exist or use a host capability; they never grant a
user access to customer data.

An interactive operation may declare exactly one host-owned authorization mapping:

```yaml
authorization:
  actionId: engine.instances.read
  resource: engine.binding
```

`actionId` must be an existing, static EnterpriseGlue action. The SDK only permits
`platform.self` or `engine.binding` as the resource mapping. An engine mapping also requires the
operation's declared engine resource binding. The gateway—not the plugin—resolves the current
user, tenant, and bound engine reference. It rejects unknown actions, mismatched resource types,
missing bindings, tenant-invisible engines, FGA permission denials, and ABAC policy denials.

No dynamic plugin action identifiers, caller-provided resource references, permission snapshots,
or raw browser access tokens are passed to the plugin. This keeps the action registry reviewable
and prevents a paid plugin from becoming an authorization bypass.

Older manifests that have no `authorization` mapping remain wire-compatible but are fail-closed
behind a deliberately conservative host baseline: `platform.dashboard.read` for an unbound
operation and `engine.instances.read` for an engine-bound operation. Plugin publishers should
migrate to an explicit mapping before relying on a more specific action. A future support-case
resource type must add its resolver and static action to OSS before a case-bound operation is
allowed; it must not be simulated with a customer-provided case ID.

## Frontend authoring

Plugin frontend modules are trusted, publisher-approved, same-origin code. They share the exact
host React, React Router, and Carbon Design System runtime; a plugin must not bundle another
runtime.

Native plugins are additive:

- declare routes, navigation, settings, and slots in the signed manifest;
- use only the typed host extension and UI APIs;
- namespace every contribution with the plugin identity;
- treat host UI primitives as optional and provide an accessible fallback;
- use host routing and notification APIs rather than direct browser networking; and
- clean up every contribution when deactivated.

The initial host extension points include global header actions, platform settings, engine and
incident actions, process-instance detail actions, and plugin-owned tenant routes/navigation.
Native plugins cannot replace host features or components. The legacy override seam is reserved
for the existing transitional loader and is rejected for ordinary plugin ownership.

```mermaid
sequenceDiagram
  participant Browser
  participant Frontend as "OSS frontend host"
  participant Gateway as "OSS gateway"
  participant Service as "Plugin backend"

  Browser->>Frontend: "Load verified same-origin module"
  Frontend->>Frontend: "Check identity, digest, manifest, and slot ownership"
  Frontend->>Browser: "Render additive Carbon contribution"
  Browser->>Gateway: "Invoke declared operation"
  Gateway->>Gateway: "Authenticate; resolve tenant and bound resource"
  Gateway->>Gateway: "Evaluate static FGA action and ABAC policy"
  Gateway->>Gateway: "Apply optional host-only resource policy"
  Gateway->>Service: "Closed request plus signed one-time invocation"
  Service-->>Gateway: "Closed response or bounded SSE"
  Gateway-->>Browser: "Validated response"
```

The frontend host keeps a bounded browser-local failure circuit for exact
`plugin-id/version/bootstrap-revision` activation failures. It removes partial contributions,
does not expose customer content in the record, and never disables the ordinary Mission Control
experience.

The host passes its already-computed FGA decision into contextual slots. A denied slot does not
render, including its label or action, while the gateway independently enforces the same class of
decision for every request. Hiding an action is therefore an ergonomics improvement, not the
security control.

## Backend isolation and brokers

A plugin backend is a separate process or workload. It never receives the Express application,
host database connection, Docker socket, Kubernetes credential, raw secret, or unrestricted
network access.

For every operation the host validates the plugin/version/protocol/schema hashes, authenticated
user and tenant context, deployment and tenant enablement, emergency state, permission grants,
the manifest's static FGA mapping, the resolved resource and policy decision, admission limits,
and the declared operation. Only then does it sign one short-lived invocation. The plugin must
verify the claim and durably consume the one-time ID before performing work.

```mermaid
flowchart TD
  Request["Browser API request"] --> Identity["Host authentication + canonical tenant"]
  Identity --> Lifecycle["Plugin lifecycle, grants, schema and path validation"]
  Lifecycle --> Binding["Host resolves declared platform or engine binding"]
  Binding --> FGA["Static action: permission + ABAC policy"]
  FGA -->|"deny"| Deny["403; sidecar is never contacted"]
  FGA -->|"allow"| Extra["Optional host resource policy"]
  Extra -->|"deny"| Deny
  Extra -->|"allow"| Token["One-time signed invocation with host-derived scope"]
  Token --> Sidecar["Plugin service"]
  Sidecar --> Broker["Scoped broker request"]
  Broker --> Scope["Broker verifies signed resourceRefs"]
```

The signed broker claim carries only the host-resolved `resourceRefs`. A broker rechecks that an
engine read is within that signed scope and the canonical tenant visibility boundary; it does not
recreate legacy role checks or trust an ID sent by the plugin.

The available broker families are deliberately scoped:

- safe identity and resource reads;
- plugin-owned storage with optimistic revision;
- minimized events and fixed schedules;
- locally filtered diagnostics;
- host-rendered notifications; and
- host-only secret use with opaque references.

Commercial entitlement remains a plugin/control-plane-owned decision. For tenant-enabled plugins,
the host now verifies and persists only a signed, commercial-data-free eligibility projection and
rechecks it before every interactive or asynchronous operation. A paid plugin may still enforce
finer product limits, but it cannot bypass the host's tenant, activation, eligibility, and user or
resource authorization gates.

### Customer-side diagnostics and full logs

The diagnostic collector is part of the OSS host and runs in the same customer environment as
the EnterpriseGlue adapter. Its PII/secret filtering executes before any support plugin or cloud
endpoint sees a bundle. The plugin receives a sanitized, bounded handoff only; raw logs are not
stored by the host broker or sent through a browser.

Full sanitized log bundles are an explicit opt-in diagnostic policy, not a default. The host
requires user confirmation and marks the signed evidence level as
`sanitized_full_log_bundle_confirmed`; it limits the handoff to 10 MiB and one million lines.
The customer adapter remains the privacy boundary whether EnterpriseGlue OSS is deployed
on-premises or the support agent itself is cloud-hosted. A plugin may distill a confirmed,
sanitized case into generic knowledge only through the separately governed knowledge-promotion
workflow; it must never infer permission to retain raw artifacts from the diagnostic request.

## Installation and lifecycle

Deployment installation and tenant activation are deliberately separate. Platform operators
install and verify one plugin workload; tenant administrators activate only the current tenant's
application projection. Members may request activation when deployment policy requires approval.
The safe statuses, actions, endpoints, configuration projection, compatibility alias, and rollback
contract are specified in the
[Tenant Application Marketplace reference](../reference/tenant-application-marketplace.md).

The public `@enterpriseglue/plugin-installer` package and `eg-plugin` command verify a signed
catalog/package inventory before writing deployment state. They support install, enable, disable,
upgrade, rollback, uninstall, status, local Compose application, and Kubernetes/OpenShift
application.

The installer verifies exact file hashes, manifest/resource hashes, publisher trust, immutable
image references, host compatibility, required permission grants, and the complete dependency and
conflict graph. It writes a canonical desired-state revision, a lifecycle plan, and a safe
display-only execution observation.

```mermaid
stateDiagram-v2
  [*] --> Verified: "verify package/catalog/compatibility"
  Verified --> Installed: "stage disabled"
  Installed --> Enabled: "enable after readiness"
  Enabled --> Disabled: "disable or emergency stop"
  Disabled --> Enabled: "resume after policy allows"
  Installed --> Upgrading: "upgrade"
  Upgrading --> Enabled: "ready and activate"
  Upgrading --> RollingBack: "failure with signed rollback range"
  RollingBack --> Enabled: "previous compatible version"
  Installed --> Uninstalled: "retain, export, or delete plugin data"
```

Customers consume publisher-built artifacts and do not clone plugin source or run publisher CI.
The following checks exercise the same public contracts used by a protected release:

```sh
pnpm test:plugin-installer
pnpm test:plugin-platform:chart
pnpm test:plugin-platform:compose-lifecycle
pnpm test:plugin-platform:multi-replica
pnpm test:plugin-platform:images
```

The pooled SaaS gate goes beyond manifest and deployment contracts by running
the compiled public reference plugin as a real sidecar with three tenants and
separate OIDC, SAML, and LDAP providers. It proves tenant activation isolation,
interactive admission, tenant-owned storage, exactly-once schedule and event
receipts, immediate eligibility revocation, deactivation, retained data, and
denial of host-owned delivery routes through the interactive gateway:

```sh
pnpm test:native-tenancy:pooled-e2e
```

The local combined gate adds the existing multi-replica lease qualification and
the populated v0.18.0 upgrade, restore, and previous-application rehearsal:

```sh
pnpm test:saas:combined
```

Cloud deployment repositories must consume the same digest-pinned host and
plugin artifacts and repeat the combined assertions on their real cluster;
local Compose evidence is not a substitute for GKE qualification.

## Distribution and air-gapped operation

The installer accepts a signed package inventory and digest-pinned OCI subject. The protected OSS
release publishes one `enterpriseglue-distribution-lock/v1` document that binds:

1. the exact OSS release and source revision;
2. multi-architecture backend, frontend, Plugin Manager, and installer image digests;
3. the Plugin Manager and installer charts;
4. the versioned static frontend archive;
5. the source-free Compose deployment kit; and
6. the generic connected/offline toolchain receipt and Sigstore verification material.

The Compose deployment kit contains no repository checkout or source build. Its own manifest
checksums every extracted component, and the deployment doctor verifies those checksums before it
renders the digest-pinned topology. A separately hosted static frontend uses the same build from
the release lock and must route all plugin asset and API prefixes back to the OSS backend before
its SPA fallback. See the [Plugin Manager runbook](../runbooks/plugin-manager-operations.md) and
[static frontend/CDN guide](../how-to/deploy-static-frontend-cdn.md).

Connected and offline installations resolve the same immutable release graph. Connected delivery
pulls entitled OCI subjects; offline delivery transfers a signed OCI closure into a customer-local
registry. Only transport changes. Complete paid-plugin air-gap export, entitlement issuance, and
customer-portal delivery remain outside the OSS `v0.16.0` production boundary.

The protected public release workflow is
[`plugin-toolchain-release.yml`](../../.github/workflows/plugin-toolchain-release.yml). It starts
after the release images succeed, can also resume manually for the same protected release commit,
publishes immutable multi-architecture toolchain subjects, verifies workflow-identity signatures,
and permanently attaches the signed lock, receipts, deployment kit, static frontend, and offline
archive to the GitHub release. Its local disposable-registry counterpart is:

```sh
pnpm test:plugin-toolchain-release-policy
pnpm test:plugin-toolchain-release:local
```

The local drill proves signed registry publication, digest re-pull, chart determinism, tamper
rejection, bundled-tool execution, and disconnected import. Protected CI additionally binds the
published backend and frontend image provenance, SBOMs, signatures, and attestations to the same
release identity.

## Public/private boundary

Public OSS contains generic host code only. A private plugin does not become an OSS workspace
dependency, source import, route, entitlement, credential, model configuration, or host-image
layer.

The source guard is mandatory for this boundary:

```sh
pnpm guard:paid-plugin-boundary
```

It discovers the public workspace package allowlist and rejects non-public EnterpriseGlue
dependencies, lockfile markers, source imports, and unsafe production-Dockerfile inputs. The
production-image acceptance command builds both final images from a clean Docker context, imports
the backend plugin host using its real package-resolution path, and scans final image paths and
compiled assets for non-public package markers:

```sh
pnpm test:plugin-platform:images
```

The lower-level `guard:paid-plugin-image-boundary` remains available when a release workflow has
already built immutable backend and frontend images and wants to scan those exact references.

## Technical acceptance boundaries

OSS `v0.16.0` supports a single-host Compose backend with either its packaged frontend container or
the versioned static frontend on a correctly configured CDN. The source-free deployment kit,
manifest verification, immutable image subjects, SDK compatibility fixtures, manager lifecycle,
and same-origin asset-route check are required release gates.

Kubernetes/OpenShift host-chart integration, shared multi-replica plugin assets, and a complete
commercial air-gap delivery are technical previews. They remain fail-closed and must not be
presented as production-supported until their published-artifact deployment matrix passes.
## Mission Control child navigation and readable-engine broker

Navigation contributions may use the existing host vocabulary
`parentDestination: mission-control`. The host places those contributions in the Mission Control
sidebar and omits them from the top-level Voyager plugin list. The contributed tenant route should
use a Mission Control-relative path such as `mission-control/<plugin-area>` so the normal
Mission Control shell and responsive navigation remain present.

Plugins that need to authorize a tenant-level workspace against the caller's current engine access
may request the explicit `host.engine.access.list_safe` permission. The matching host broker:

- derives subject and tenant exclusively from the signed invocation;
- returns a bounded, paged list of opaque engine references;
- includes only engines with full `engine:instance:view` permission;
- excludes runtime-resource-only grants from whole-engine visibility;
- never returns engine endpoints, credentials, names, health payloads, or arbitrary metadata; and
- does not replace the plugin backend's own object-level access check.

The request is closed and cannot contain a tenant or subject. A plugin operation must declare the
permission, the installer must grant it, and the signed invocation must include it. A navigation
entry, active contribution, or successful broker call is not authority to return plugin-owned
customer content.
