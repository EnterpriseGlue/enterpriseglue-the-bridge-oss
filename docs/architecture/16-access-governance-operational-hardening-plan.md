# Access Governance Operational Hardening Plan

Status: In progress

Audience: EnterpriseGlue developers, security reviewers, operators, and API
integrators.

## Objective

Harden the implemented authorization, SSO, engine-governance, and headless
configuration foundations in four ordered slices:

1. make server-calculated action availability the canonical UI contract;
2. provide an explicit governance ownership-transfer and bundle-retirement
   workflow;
3. make the deployment evidence matrix repeatable and release-gated; and
4. introduce a stable `v1beta1` headless configuration contract while
   retaining deliberate `v1alpha1` compatibility.

The Effective Access change simulator is intentionally out of scope for this
plan. Existing Effective Access inspection and configuration diff behavior
remain unchanged.

## Design Principles

- Backend enforcement remains authoritative. UI state is explanatory and must
  never become a second authorization authority.
- Action availability combines RBAC, platform policy, source ownership,
  lifecycle state, and tenant context.
- A denied action has a stable reason and management source.
- Ownership changes require preview, acknowledgement, apply, audit, and an
  idempotent receipt.
- Existing data is preserved unless an exact preview explicitly states the
  mutation.
- Headless contracts reject unknown fields and never accept resolved secret
  values.
- Release evidence distinguishes locally reproducible proof from
  environment-dependent proof.

## Slice 1: Unified Server Action Availability

### Contract

- [x] Add one shared action-availability schema containing:
  - `allowedActions`;
  - denied `restrictions` keyed by action id;
  - stable reason codes and human-readable reasons;
  - `managementSource` and optional redacted `sourceRef`.
- [x] Add availability to the current-user authorization snapshot for:
  - platform actions;
  - each visible project; and
  - each visible engine.
- [x] Calculate action availability from the registered action catalog and the
  same effective permissions used by route enforcement.
- [x] Apply policy restrictions for:
  - SSO-managed engine membership and scoped assignments;
  - SSO-managed project membership and scoped assignments;
  - external-only engine onboarding;
  - external-only project-engine target changes;
  - configuration-locked governance settings;
  - configuration/external ownership of engine inventory; and
  - decommissioned engine lifecycle.
- [x] Preserve a compatibility fallback for older servers that return only
  permission arrays.

### UI adoption

- [x] Make the shared guard evaluator prefer server action availability.
- [x] Replace direct mode comparisons on Engine, Project Members, Access
  Control assignments, deployment targets, and Platform Settings controls.
- [x] Show stable denial reasons and management sources through the existing
  unavailable-action presentation.
- [x] Add state-space tests proving RBAC denial, SSO policy denial,
  configuration lock, external ownership, lifecycle denial, and allowed
  behavior.

### Acceptance

- A UI control and its protected route cannot disagree for the modeled policy
  and ownership conditions.
- Project creation remains independent from project membership authority.
- Engine registration remains independent from engine membership authority.
- Runtime-resource authorization remains server-filtered and is not expanded
  into the coarse browser snapshot.

## Slice 2: Governance Ownership Transfer and Bundle Retirement

### API

- [x] Add a strict preview request for:
  - transfer to another bundle;
  - release governance settings to editable/manual ownership; and
  - retire a bundle's governance ownership.
- [x] Return current source, desired source, affected governance fields,
  conflicts, required acknowledgements, preview hash, and expiry.
- [x] Add an apply endpoint requiring the exact preview hash, expiry,
  acknowledgements, and idempotency key.
- [x] Persist an immutable transfer receipt and expose it through a read API.
- [x] Audit preview and apply without serializing configuration secrets.

### Safety

- [x] Lock the settings row during apply.
- [x] Reject stale previews and source-owner mismatches.
- [x] Never delete engines, roles, groups, assignments, providers, mappings, or
  project targets as a side effect of governance-settings transfer.
- [x] Retiring settings ownership changes only governance provenance and
  ownership; source-owned objects require their existing explicit lifecycle.
- [x] Support idempotent retry and fail closed after partial-state or hash
  mismatch.

### UI and documentation

- [x] Add a bounded ownership panel to Configuration Bundles.
- [x] Present transfer/release/retire consequences before acknowledgement.
- [x] Update operator recovery, API, and migration documentation.

## Slice 3: Deployment-Grade CI Evidence Matrix

### Evidence manifest

- [ ] Add a machine-readable matrix with stable lane ids, prerequisites,
  commands, artifacts, success criteria, and environment classification.
- [ ] Cover:
  - no-bundle startup;
  - preview/apply/reapply and idempotency;
  - failed apply and rollback safety;
  - config drift `report`, `fail`, and `reconcile`;
  - standalone, OIDC/Entra-compatible, SAML, LDAP, and multiple-provider
    identity flows;
  - distributed, centralized/shared, external-registry, and customer-sidecar
    Operaton engines;
  - manual-record preservation;
  - secret/token absence from exports, APIs, logs, audit, and CI artifacts;
  - OpenShift ConfigMap/Secret rendering; and
  - OpenShift failed-rollout retention as environment-dependent evidence.

### CI

- [ ] Add a fast pull-request contract gate for the manifest, schemas,
  documentation, action decisions, bundle lifecycle, and secret boundaries.
- [ ] Add container/emulator lanes for locally reproducible identity and
  Operaton scenarios.
- [ ] Add an explicit environment gate for real OpenShift rollout evidence.
- [ ] Publish sanitized evidence indexes and mark incomplete external evidence
  as pending rather than passed.
- [ ] Add contract tests preventing required lanes from being silently skipped.

## Slice 4: `v1beta1` Headless Contract

### Versioning

- [ ] Accept both `enterpriseglue.ai/v1alpha1` and
  `enterpriseglue.ai/v1beta1`.
- [ ] Make `v1beta1` the default for new exports, UI-generated templates,
  examples, and CLI help.
- [ ] Preserve `v1alpha1` parsing with a normalized compatibility adapter and
  explicit deprecation metadata.
- [ ] Reject unsupported future versions with a stable error.

### Contract cleanup

- [ ] Publish unambiguous `v1beta1` governance field names while accepting
  deliberate `v1alpha1` aliases only at the compatibility boundary.
- [ ] Preserve strict engine, tenancy, runtime-scope, provider, mapping,
  assignment, and secret-reference validation.
- [ ] Include contract version and normalization warnings in preview, diff,
  apply, export, and apply-run receipts.
- [ ] Add canonical fixtures and generated TypeScript contract checks for the
  CLI and frontend.
- [ ] Document upgrade, downgrade, compatibility-window, and removal rules.

## Verification and Commit Strategy

Each slice is committed independently after:

- focused schema, service, route, OpenAPI, and frontend tests;
- shared/backend build and frontend typecheck;
- documentation/configuration contract tests;
- strict authorization route inventory and frontend guard checks where
  applicable; and
- `git diff --check`.

No slice may claim deployed OpenShift or third-party identity evidence from a
local emulator. No commit in this plan is merged to `main` automatically.
