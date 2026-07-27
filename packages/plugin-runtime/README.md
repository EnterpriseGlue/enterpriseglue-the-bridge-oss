# `@enterpriseglue/plugin-runtime`

Plural, owner-aware runtime primitives for EnterpriseGlue OSS plugins.

The implementation provides:

- Signed catalog, extracted-package index, air-gap index, and artifact verification.
- Compatibility/dependency/conflict resolution and lifecycle state.
- Shared execution-gate primitives consumed by the durable host-level deployment, tenant, and
  platform-emergency controls.
- Fixed signed gateway and scoped host/secret broker primitives.
- One active version per plugin in the frontend contribution registry.
- A reusable `assertSafePluginFrontendEntryV1` gate for the trusted native UI profile. It accepts
  only a bounded valid-UTF-8 self-contained ESM entry and rejects module imports/import metadata,
  direct browser networking/navigation, eval-like code, unsafe HTML sinks, global stylesheet
  installation, executable-Markdown fingerprints, and duplicate React-runtime fingerprints.
- Namespaced and manifest-declared routes, navigation, settings, and typed slots.
- Deterministic composition across plugins.
- Independent activation, replacement, and deactivation.
- Failed replacement leaves the prior plugin active.

Deployment persistence, HTTP routes, reconciliation, durable events/jobs, and
additional brokers live in the generic OSS host packages.

The frontend policy is enforced before installer staging and again by the host after entry digest
verification. It is defense in depth for approved same-origin publisher code, not a sandbox for
untrusted JavaScript. The host CSP, publisher review, backend authorization, revocation, and
emergency disable remain mandatory.
