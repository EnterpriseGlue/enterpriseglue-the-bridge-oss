# `@enterpriseglue/plugin-sdk`

Product-neutral contracts for signed EnterpriseGlue OSS plugins.

The runtime Zod manifest parser is authoritative because it also applies
cross-field semantic checks. A generated draft 2020-12 structural schema is
published at
`@enterpriseglue/plugin-sdk/schema/enterpriseglue-plugin-manifest-v1.schema.json`
for editors, catalogs, and installer preflight.
The signed four-cell release-evidence contract also has a portable schema at
`@enterpriseglue/plugin-sdk/schema/enterpriseglue-plugin-compatibility-matrix-v1.schema.json`.

Its runtime parser remains authoritative for exact Cartesian-product, artifact-consistency, and
timestamp checks that JSON Schema cannot fully express.

Cloud eligibility issuers can validate the strict signed claims contract with
`@enterpriseglue/plugin-sdk/schema/enterpriseglue-plugin-tenant-eligibility-claims-v1.schema.json`.
Tenant-facing integrations can validate the deliberately smaller safe response with
`@enterpriseglue/plugin-sdk/schema/enterpriseglue-plugin-tenant-eligibility-projection-v1.schema.json`.

The package defines:

- A closed, versioned plugin manifest with runtime and semantic validation.
- A closed host capability catalog and generated JSON Schema for the exact
  permissions, slots, events, named egress-policy identifiers, trusted
  publisher identifiers, shared runtime, protocols, and current/previous-minor
  support window enforced by one OSS host. It names both minor lines and the
  exact supported package versions so resolver behavior is reproducible. The projection cannot contain
  destinations, credentials, trust keys, tenant identifiers, or plugin
  payloads.
- Namespaced frontend route, navigation, settings, and typed slot contributions. Deployment
  settings are discovered by the native OSS Platform Settings → Plugins surface rather than
  creating a second product menu; the host projects only the signed label and route, never plugin
  configuration or credentials.
- An additive, feature-detectable host UI surface with responsive logical `PageLayout`, semantic
  `PageHeader`, Carbon-owned `ConfirmModal`, and locale/direction/reduced-motion presentation
  preferences. Existing SDK 0.1.x consumers remain compatible because plugins must retain an
  accessible fallback until their declared minimum host guarantees the optional helpers. The
  helpers perform no I/O and grant no authority. Plugins pass the mounted destructive-action
  launcher ref to `ConfirmModal` so the host can restore keyboard focus after close or successful
  submit.
  The optional `navigation.back()` helper returns to the browser location that opened a contextual
  plugin surface. It takes no route argument, so a plugin cannot discover or compose arbitrary
  host paths.
- Optional tenant-scoped contribution-availability declarations, closed boolean/reason
  projections, and a read-only frontend snapshot. The background host owns tenant selection,
  scheduling, CAS/lease/expiry state, and fail-closed filtering of only the declared IDs; this is
  presentation and never authorization.
- Backend gateway operations, capability and readiness responses, invocation claims, broker
  clients, and event envelopes.
- Safe lifecycle list/detail, enable/disable, tenant-enablement, operation-status, and
  platform-emergency contracts with strict expected-revision and idempotency fields. The global
  emergency state has a separate closed response and preserves per-plugin desired state. These
  contracts contain no artifact or infrastructure selection.
- A bounded recent control-audit response with safe event/state/reason fields and opaque
  actor/correlation references. Tenant references and request, manifest, entitlement, and plugin
  payloads are absent by schema.
- Closed resource sources for non-sensitive scalar config, per-plugin fixed-path non-secret
  deployment files, and opaque secret references.
- Resource-broker authorization contracts in which manifest declaration, operation
  `requiredPermissions`, installation grant, signed invocation grant, and the exact
  `resourceBinding`-derived reference must all agree. A resource binding scopes the object; it is
  never a permission grant. `PluginResourceBindingV1` is exported for host/plugin conformance
  tooling; the OSS gateway applies its separate host-owned `PluginResourceAuthorizerV1` before
  sidecar work. A body binding resolves only its declared nested field after closed-schema
  validation. A path binding requires exactly one complete `:field` operation-path segment, no
  other dynamic segment, and a safe opaque substituted value; body data cannot replace it.
  Because the gateway intentionally forwards no GET/DELETE body, those methods may bind only
  through the path.
- A closed `http.bearer-json-v1` secret-use request/result and deployment policy. The plugin
  supplies only a signed operation, opaque reference, call ID, relative path, and JSON; the host
  owns tenant binding, destination, credential file, limits, and redirect policy.
- Closed signed-catalog, package-inventory, resource, compatibility-matrix, and air-gap-index
  contracts. Package inventories classify runtime versus supply-chain evidence
  and bind every file by safe relative path, size, and SHA-256. Catalog releases
  include the unique exact host versions exercised by private CI; this is
  separate from the broader runtime SemVer compatibility range. The matrix binds the exact
  current/previous host and plugin versions to immutable OCI artifact digests and retained test
  evidence.

Package `0.3.1` aligns the native-manager distribution contracts with the current
host and SDK release identity. Package `0.3.0` introduced those contracts. The plugin-host
ABI is on SDK minor line `0.3`, with both `0.3.1` and `0.3.0` accepted so a
host patch does not invalidate an already-built plugin. SDK `0.2.0` is the
previous supported minor line. `fixtures/sdk-0.3.0` freezes the manager
contracts, while `fixtures/sdk-0.2.0` and `fixtures/sdk-0.1.0` retain historical
compatibility fixtures. A plugin manifest's declared SDK range must contain the
exact ABI used to build that plugin. A future SDK minor must add its own frozen
fixture and retire only the line outside the documented two-minor window.

The host capability schema is published at
`@enterpriseglue/plugin-sdk/schema/enterpriseglue-plugin-platform-capabilities-v1.schema.json`.
The runtime Zod parser remains authoritative. An authenticated deployment
administrator can read the active safe projection from
`GET /api/plugin-platform/v1/capabilities`; ordinary plugin and tenant routes
cannot use that endpoint to discover deployment policy.

It does not load plugins, grant permissions, verify OCI signatures, provide entitlements, or
authorize a browser request. Those responsibilities belong to the OSS plugin runtime and the
plugin backend.

The diagnostics broker includes closed collection contracts and an additive optional
`diagnostics.status(...)` client method. Status is deliberately class-only: collection
permission, bounded health/reason/source-set classes, check time, backend filtering, no raw
upload, and no browser editing. Source selectors, paths, endpoints, keys, credentials, pod names,
and diagnostic bytes are absent from both request and response.

The control contract also includes `pluginDiagnosticMetricsV1Schema` for the
deployment-admin-only aggregate diagnostics endpoint. Its series are bounded to closed
status/reason/source-count/sanitized-byte classes and plugin identity; customer, evidence,
infrastructure, credential, correlation, and exact byte values are not representable.

`pluginEventMetricsV1Schema` defines the separate deployment-admin event-lifecycle projection.
It permits only plugin identity, the closed incident/failed-job type, enqueue/delivery/circuit
outcomes, normalized reasons, first/retry/exhausted attempt classes, counts, and generation time.
Tenant, deployment, engine, event, delivery, operation, actor, correlation, endpoint, exception,
and payload fields are not representable.

The existing `@enterpriseglue/enterprise-plugin-api` remains a temporary compatibility contract.
New plugins should target this SDK.
