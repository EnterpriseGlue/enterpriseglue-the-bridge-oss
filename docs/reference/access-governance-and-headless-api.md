# Access Governance and Headless Configuration API

Summary: Authoritative developer contract for access-governance modes, their
UI effects, REST settings, configuration bundles, and headless engine
registration.

Audience: Platform developers, API integrators, identity engineers, and
operators automating EnterpriseGlue.

## Independent Control Axes

EnterpriseGlue intentionally keeps these concerns separate:

| Concern | Field | What it controls | What it does not control |
| --- | --- | --- | --- |
| Engine access | `engineAccessAuthority` | Engine members, delegates, owners, and engine/Engine Set/runtime-resource role assignments | Engine registration, login, or runtime authorization authority |
| Project access | `projectAccessAuthority` | Project members, delegates, owners, and project-scoped assignments | `project:create` or project-engine deployment targets |
| Engine onboarding | `engineOnboardingMode` | Whether manual engine inventory creation is available | Who can access a registered engine |
| Project-engine targets | `projectEngineTargetMode` | Whether manual project-to-engine deployment-target changes are available | Project membership or project creation |
| Runtime authorization | `engineRuntimeAuthorizationMode` | Whether EnterpriseGlue alone or EnterpriseGlue plus a mirrored engine backstop protects runtime operations | Login, membership, engine topology, or resource granularity |
| Settings ownership | `settings.ownershipMode` in a bundle | Whether the five fields above are portal-owned, configuration-locked, or editable with drift | Ownership of engines, groups, mappings, assignments, or members |
| Runtime granularity | `runtimeAccessScope` on each engine | Engine-wide versus resource-aware process/decision filtering | The platform-wide authorization authority |
| Engine topology | `tenancy` on each engine | Dedicated versus shared tenant resolution | SSO or member-screen editability |

Enabling an SSO provider does not automatically make access SSO-managed.
Adding an engine through JSON or the external API does not automatically grant
anyone access. Creating a project is controlled by `project:create`, regardless
of `projectAccessAuthority`.

## Effective UI and API Behavior

Authenticated `GET /api/authz/me/permissions` is the canonical UI contract.
In addition to the effective permission arrays, it returns:

- `platformActionAvailability`;
- `actionAvailability` on every visible project; and
- `actionAvailability` on every visible engine.

Each availability object contains `allowedActions` and a `restrictions` map
keyed by action id. A restriction includes a stable `reasonCode`, a
human-readable `reason`, a `managementSource`, and an optional redacted
`sourceRef`. The server combines effective RBAC permissions with SSO
authority, external-only policy, configuration ownership, and engine
lifecycle. Frontends must prefer this contract when it is present. During a
mixed-version rollout, a frontend may fall back to its existing permission and
settings checks when action availability is absent.

`GET /api/admin/settings` and authenticated
`GET /api/auth/platform-settings` also return a read-only
`governanceBehavior` object:

| Response field | `true` or allowed means |
| --- | --- |
| `manualEngineAccessMutationsAllowed` | Manual engine membership and engine-domain assignment controls may be enabled if the user also has permission |
| `manualProjectAccessMutationsAllowed` | Manual project membership and project assignment controls may be enabled if the user also has permission |
| `manualEngineRegistrationAllowed` | The manual **Add engine** path may be enabled if the user also has inventory-create permission |
| `manualProjectEngineTargetMutationsAllowed` | Manual project-engine target controls may be enabled if the user also has permission |
| `governanceSettingsMutations` | `allowed`, `allowed_marks_drift`, or `blocked` for the five governance fields |

These fields describe platform policy, not the current principal's RBAC
grants. They are useful for diagnostics, non-interactive clients, and
compatibility with older permission snapshots. Interactive controls should use
the server-calculated action availability because per-record ownership can
impose an additional restriction: for example, an external or
configuration-locked engine remains source-owned even when manual engine
onboarding is generally allowed.

Action availability is explanatory, not an enforcement substitute. Protected
routes still evaluate authorization and source ownership at mutation time.
Runtime-resource names and keys are deliberately not expanded into the browser
snapshot; runtime collections remain authoritatively filtered by their backend
routes.

In `sso_managed`, existing manual rows are not deleted or ignored. They stay
visible and continue to authorize until deliberately cleaned up in
`manual` or `transition_to_sso`; normal manual write APIs return HTTP 403.

## Portal-Owned REST Settings

Use `PUT /api/admin/settings` only while governance settings are editable
(`manual` or `config_warn`). The request is partial:

<!-- enterpriseglue-config-schema: UpdatePlatformSettingsRequest -->
```json
{
  "engineAccessAuthority": "sso_managed",
  "projectAccessAuthority": "manual",
  "engineOnboardingMode": "external_only",
  "projectEngineTargetMode": "hybrid",
  "engineRuntimeAuthorizationMode": "enterpriseglue_authoritative"
}
```

```bash
curl --fail-with-body \
  -X PUT "$ENTERPRISEGLUE_URL/api/admin/settings" \
  -H "Authorization: Bearer $ENTERPRISEGLUE_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "engineAccessAuthority": "sso_managed",
    "projectAccessAuthority": "manual",
    "engineOnboardingMode": "external_only",
    "projectEngineTargetMode": "hybrid",
    "engineRuntimeAuthorizationMode": "enterpriseglue_authoritative"
  }'
```

A configuration-locked settings row returns HTTP 403. Change it through the
owning bundle instead of retrying the portal endpoint.
The request schema is strict: `governanceBehavior` and the
`accessGovernance*` provenance fields are response-only and are rejected in a
PUT request.

## Headless Governance and Engine Bundle

Use the configuration-bundle preview, diff, secret-preflight, and apply APIs
for GitOps/headless administration. A bundle that intentionally owns
governance declares all five fields and an ownership mode:

<!-- enterpriseglue-config-schema: EnterpriseGlueConfigBundleSchema -->
```json
{
  "apiVersion": "enterpriseglue.ai/v1alpha1",
  "kind": "EnterpriseGlueConfigBundle",
  "metadata": {
    "key": "platform.operaton-estate",
    "owner": "platform-engineering"
  },
  "tenantKey": "default",
  "mode": "authoritative",
  "settings": {
    "engineAccessAuthority": "sso_managed",
    "projectAccessAuthority": "manual",
    "engineOnboardingMode": "external_only",
    "projectEngineTargetMode": "hybrid",
    "engineRuntimeAuthorizationMode": "enterpriseglue_authoritative",
    "ownershipMode": "config_locked"
  },
  "imports": ["./engines.json"]
}
```

The engine file controls connection, topology, and runtime granularity:

<!-- enterpriseglue-config-schema: ConfigEnginesFileSchema -->
```json
{
  "engines": [
    {
      "key": "engine.operaton-payments",
      "name": "Payments Operaton",
      "type": "operaton",
      "baseUrl": "https://operaton-payments.example.invalid/engine-rest",
      "auth": {
        "type": "basic",
        "username": "enterpriseglue",
        "passwordRef": "env://OPERATON_PAYMENTS_PASSWORD"
      },
      "connectionMode": "direct",
      "runtimeAccessScope": "engine_wide",
      "tenancy": {
        "mode": "dedicated",
        "tenantRef": { "type": "request_context" }
      },
      "ownershipMode": "config_locked"
    }
  ]
}
```

Secret fields accept references only. The full transport envelope example is
[access-governance-headless.example.json](./access-governance-headless.example.json).

### Engine-Only Bundle

Omit `settings` when a bundle should add or update engines without claiming or
resetting platform governance:

<!-- enterpriseglue-config-schema: EnterpriseGlueConfigBundleSchema -->
```json
{
  "apiVersion": "enterpriseglue.ai/v1alpha1",
  "kind": "EnterpriseGlueConfigBundle",
  "metadata": {
    "key": "inventory.operaton-estate",
    "owner": "platform-engineering"
  },
  "tenantKey": "default",
  "mode": "additive",
  "imports": ["./engines.json"]
}
```

Parsing supplies safe defaults internally, but diff/apply checks the raw
manifest. An omitted `settings` field—or the historical `settings: {}`—does
not claim the settings row and does not overwrite portal choices.
Bundle export follows the same rule: it includes `settings` only when the
requested bundle owns the current governance row; otherwise it omits the field.

The headless lifecycle is:

```text
POST /api/authz/config-bundles/preview
POST /api/authz/config-bundles/validate-secret-refs
POST /api/authz/config-bundles/diff
POST /api/authz/config-bundles/apply
GET  /api/authz/config-bundles/runs/{id}
GET  /api/admin/settings
```

Apply must use the exact reviewed preview hash. After apply, read Platform
Settings and verify `accessGovernanceSourceRef`,
`accessGovernanceOwnershipMode`, `accessGovernanceDriftStatus`, and
`governanceBehavior`.

## Governance Settings Ownership API

Do not edit `accessGovernance*` database columns to change which bundle owns
the five governance settings. Use the same bounded workflow available in
**Platform Settings > Configuration Bundles > Governance ownership**:

```text
GET  /api/authz/config-bundles/governance-ownership
POST /api/authz/config-bundles/governance-ownership/preview
POST /api/authz/config-bundles/governance-ownership/apply
GET  /api/authz/config-bundles/governance-ownership/receipts
GET  /api/authz/config-bundles/governance-ownership/receipts/{id}
```

The operations are deliberately distinct:

| Operation | Desired owner | Intended use | Objects changed |
| --- | --- | --- | --- |
| `transfer` | `config_bundle:<desiredBundleKey>` with `config_warn` or `config_locked` | Move the governance-settings source of truth to a reviewed bundle | The five governance settings' provenance only |
| `release` | Manual portal/API ownership | Stop configuration management of the five settings | The five governance settings' provenance only |
| `retire` | Manual portal/API ownership | Record retirement of the bundle that currently owns the five settings | The five governance settings' provenance only |

`release` and `retire` reach the same desired settings state but preserve
different operator intent in audit and receipt history. `retire` is accepted
only when the current source is a configuration bundle. None of these
operations deletes or transfers engines, Engine Sets, runtime resources,
runtime-resource sets, roles, assignments, groups, memberships, identity
providers, identity mappings, or project-engine targets.

Read the current owner, then send it back as the concurrency precondition:

<!-- enterpriseglue-config-schema: GovernanceOwnershipRequestSchema -->
```json
{
  "operation": "transfer",
  "expectedCurrentSourceRef": "config_bundle:old.authz",
  "desiredBundleKey": "new.authz",
  "desiredOwnershipMode": "config_warn",
  "reason": "Move governance settings to the reviewed platform bundle."
}
```

Preview returns the current and desired states, exactly five affected fields,
the preserved object types, conflicts, required acknowledgements, a SHA-256
preview hash, and a ten-minute expiry. Apply the same request without changing
it and add the exact preview evidence:

<!-- enterpriseglue-config-schema: GovernanceOwnershipApplyRequestSchema -->
```json
{
  "operation": "transfer",
  "expectedCurrentSourceRef": "config_bundle:old.authz",
  "desiredBundleKey": "new.authz",
  "desiredOwnershipMode": "config_warn",
  "reason": "Move governance settings to the reviewed platform bundle.",
  "previewHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "previewExpiresAt": 1785325200000,
  "acknowledgements": [
    "governance.settings-only",
    "governance.preserve-managed-objects",
    "governance.transfer-to-new-bundle"
  ],
  "idempotencyKey": "governance-transfer-change-1842"
}
```

The authenticated principal needs `platform:config-bundles:view` to read the
current state and receipts, `platform:config-bundles:preview` to preview, and
`platform:config-bundles:apply` to apply. A configuration-scoped API client
still needs both its machine scope and the corresponding RBAC permission.
Unknown fields are rejected. Preview and apply audit events contain only
operation metadata, source references, hashes, conflict codes, receipt IDs,
and preserved object-type names; they never serialize bundle contents or
secrets.

Apply locks the settings row, recomputes the preview, rejects expiry or source
drift, updates only governance provenance, and writes the receipt in the same
transaction. Retrying the same idempotency key and preview hash returns the
existing receipt. Reusing that key with another preview fails closed.

See [Migrate Governance Settings Ownership](../how-to/migrate-governance-settings-ownership.md)
for operator success criteria, rollback, and failure recovery.

## External Registry API

`POST /engines-api/external/engines` is for a CMDB, operator, or external
registry that owns engine inventory. It requires explicit `tenancy` and a
stable `externalId`. This endpoint:

- creates or updates an engine record;
- does not change any platform governance setting;
- does not create engine membership or role assignments;
- remains separate from `engineAccessAuthority`; and
- protects externally owned fields and lifecycle operations.

Use a configuration bundle when Git is the source of truth. Use external
registration when another inventory system is the source of truth. Do not send
platform-governance fields inside an engine request: all engine schemas are
strict and reject unknown fields.

## Recommended Profiles

| Deployment | Governance recommendation | Engine recommendation |
| --- | --- | --- |
| Decentralized, one engine | Project access `manual`; engine access `manual` or transition to SSO; onboarding `manual_allowed` | Dedicated tenancy with `request_context`; `engine_wide` unless resource separation is needed |
| Centralized, shared engine | Engine access `sso_managed`; project access usually `manual`; onboarding `external_only` or `hybrid` | Shared tenancy, explicit mappings, `resource_aware`, fail closed for unmapped resources |
| GitOps-managed estate | Explicit bundle settings with `config_locked` | Configuration-owned engines with secret references and preview/hash-bound apply |
| External CMDB estate | Portal or bundle-owned governance; do not mix it into registry payloads | External registration with stable IDs, explicit field ownership, explicit tenancy, and decommission lifecycle |

## Recovery

- Use `transition_to_sso` before `sso_managed` to clean up manual grants and
  pending invitations.
- Use `config_warn` only for reviewed emergency edits; it records drift.
- `ownershipMode: "manual"` permits portal edits while retaining bundle
  provenance. It does not silently erase the source reference.
- Fully releasing bundle provenance requires an explicit `release` or `retire`
  ownership operation; moving it requires `transfer`. Do not simulate these
  operations with a database update.
- Never remove a configuration lock directly in the database.
- A mode change never requires re-adding an existing engine.
