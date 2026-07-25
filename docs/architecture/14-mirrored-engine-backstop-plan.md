# Mirrored Engine Backstop Implementation Plan

Status: Approved implementation scope. `enterpriseglue_authoritative` remains
the default until a specific engine has completed a healthy backstop sync.

## Decision

`mirrored_engine_backstop` is a defence-in-depth mode for Camunda 7 or Operaton
access, reached directly or through a customer-owned sidecar. EnterpriseGlue remains the only permission editor and the final
EnterpriseGlue product-authorisation evaluator. The feature projects a narrow,
representable subset of EnterpriseGlue group access into compatible native
authorizations so a person who reaches Camunda directly is also constrained by
the engine.

It is not `engine_native_authority`:

- EnterpriseGlue never imports native users, groups, grants, revokes, or
  precedence rules as its source of truth.
- A native allow can never override an EnterpriseGlue deny; denied EnterpriseGlue
  requests never reach an engine transport.
- The normal EnterpriseGlue-to-engine service identity is not impersonated as a
  human user. Consequently an engine response to that technical identity is
  reported as an upstream operation failure, not a per-user authorization
  decision.
- Direct engine users must already be authenticated by the engine or its identity
  provider and have the mapped native group membership. EnterpriseGlue does
  not provision native users or memberships in this phase.

This feature is useful only when direct engine exposure is an intentional
customer requirement and the engine can observe meaningful group identity.
For an engine reachable only through EnterpriseGlue's service identity it adds
operational cost without an additional human-access boundary.

## Supported v1 Projection

The v1 projection is deliberately the reverse of the safe native-grant
migration catalogue:

| EnterpriseGlue source | Camunda 7 / Operaton target | Result |
| --- | --- | --- |
| Explicit mapped EnterpriseGlue group | Explicit mapped native engine group | Candidate principal |
| Exact active process-definition Runtime Resource Set | resource type `6`, exact key | `READ` authorization |
| Exact active decision-definition Runtime Resource Set | resource type `10`, exact key | `READ` authorization |
| Role permission `engine:instance:view` | `READ` | Supported action mapping |
| Engine-wide, wildcard, user, service-account, policy-only, expired, unresolved, stale, conflicting, or unsupported scope | None | Visible as blocked/manual; never widened |

Every supported grant must have exactly one active EnterpriseGlue group, one
unambiguous mapped native engine group, one active resolved runtime resource, and one
exact resource key. Shared engines additionally require the resource's resolved
tenant to equal the group's tenant. An empty desired set is valid and removes
only previously tracked import-owned native grants.

The backstop never creates wildcard (`*`), global, user, revoke, task,
process-instance, deployment, batch, filter, application, administration, or
tenant-administration authorizations.

## Native Identity Boundary

Each participating engine stores a source-owned mapping:

```text
EnterpriseGlue tenant + group key
  -> Engine id + encrypted native engine group id
```

The native engine group id is sensitive operational metadata. Ordinary history,
audit records, telemetry, and list endpoints expose only an opaque reference.
Only the dedicated backstop-detail permission can reveal the active mapping.

The mapping proves that EnterpriseGlue is allowed to write grants for that
native engine group. It does not assert or create a native user membership. The
operator must verify that the native IdP/identity service assigns direct users
to the mapped group before relying on the backstop.

## Synchronization Protocol

1. **Preview** reads EnterpriseGlue's canonical assignments, roles, runtime
   resource sets, materializations, and runtime inventory. It does not call a
   native engine write endpoint. It generates a deterministic desired-grant hash and
   classifies every candidate as proposed, manual, or blocked.
2. **Apply** requires the preview hash, explicit acknowledgement, native-detail
   permission, and configuration-apply permission. It rechecks the current
   EnterpriseGlue source hash immediately before calling the native engine.
3. For each proposed grant, the compatible native-authorization adapter creates the exact group
   `READ` authorization through `/authorization/create`. It records the native
   authorization id and grant identity only in encrypted run detail.
4. On a later apply or rollback, the adapter deletes only native authorization
   ids recorded as owned by this backstop. It never searches-and-deletes a
   matching customer-created authorization.
5. A durable task/retry receipt records the canonical input hash, result hash,
   opaque counts, adapter capability, timestamps, failure class, and the
   encrypted owned-id snapshot. A failed or stale task remains visible and does
   not silently change EnterpriseGlue's authoritative decision.
6. A read-only drift check compares only tracked owned ids with the live
   `/authorization` representation. Missing or altered tracked grants become
   `out_of_sync`; unrelated native grants are reported only as aggregate
   non-owned observations and are never changed.

All compatible native-authorization calls use the existing hardened connection/secret resolver. A
participating engine must be `camunda7` or `operaton`, active, and reachable through a write-capable
trusted endpoint. A direct engine uses its configured integration account. A
`customer_sidecar` engine uses the generic bounded sidecar adapter, sends only
the normal sanitized request/engine/operation metadata to the registered proxy,
and lets the customer-owned proxy authenticate its own engine hop. No downstream
peer token or engine credential is stored or forwarded by EnterpriseGlue. The
sidecar must allow only create, tracked-ID read, and tracked-ID delete calls for
the backstop operation class; a rejection fails closed with no direct fallback.

## Data and API Design

New persistence records, registered through every supported adapter and portable
migration, are:

- `EngineBackstopGroupMapping`: tenant, engine, EnterpriseGlue group,
  encrypted native group id, ownership/source fields, active state, and source
  hash;
- `EngineBackstopSyncRun`: engine/tenant, status, desired/result hashes,
  opaque classifications/counts, mode/catalog version, and encrypted native
  detail with a maximum 30-day retention. Read-only observations link to their
  source apply receipt without replacing its ownership evidence; and
- `EngineBackstopSyncTask`: bounded leasing/retry state for a requested apply,
  source hash, and run id.

The API surface is engine-scoped and permission-separated:

```text
GET  /engines-api/engines/{id}/backstop/status
GET  /engines-api/engines/{id}/backstop/mappings
POST /engines-api/engines/{id}/backstop/mappings
POST /engines-api/engines/{id}/backstop/sync/preview
POST /engines-api/engines/{id}/backstop/sync/{runId}/apply
POST /engines-api/engines/{id}/backstop/sync/{runId}/rollback
POST /engines-api/engines/{id}/backstop/sync/{runId}/drift-check
GET  /engines-api/engines/{id}/backstop/sync/{runId}/detail
```

List/status responses contain only opaque mappings and sanitized counts. The
detail route, mapping create/update, preview, apply, rollback, and history each
receive distinct platform/engine action metadata. Every response is represented
in shared Zod contracts and OpenAPI.

The global `engineRuntimeAuthorizationMode` gains
`mirrored_engine_backstop`. Enabling it is rejected until at least one retained
successful Camunda 7 or Operaton backstop synchronization exists; every apply separately
requires acknowledgement of the direct-identity boundary. Existing engines
stay in `enterpriseglue_authoritative` behavior until an individual sync
succeeds.

## Configuration and UI

Configuration bundles gain a source-owned
`engine-backstop-mappings.json` import. It supplies an engine reference, a
tenant-qualified EnterpriseGlue group key, and a secret reference containing
the native group id. Plain native ids are forbidden in bundle export, browser
telemetry, and generic apply history.

Mission Control adds a **Native authorization backstop** panel only for active
Camunda 7 and Operaton engines. It shows prerequisites, mapping health, latest sanitized
sync receipt, proposed/blocked/manual counts, drift status, and rollback.
It never presents a second native permission matrix. Platform Settings presents
the global mode only after the current configuration validates its mapping
prerequisites.

## Safety and Rollback

Stop and do not enable/sync when a group mapping is ambiguous, a resource has
unresolved tenancy, a source assignment has expired, a scope would broaden to
engine-wide/wildcard access, the desired hash changes, the native endpoint
lacks authorization-write capability, or the adapter cannot retain encrypted
owned-id evidence.

Rollback deletes only native authorization ids retained by the selected,
successful run. It leaves EnterpriseGlue groups, roles, assignments, runtime
resources, engine registration, credentials, external IdP membership, and all
unrelated native engine authorizations unchanged. After encrypted detail expires, a
new preview is required; no broad native delete is permitted.

## Delivery Slices and Acceptance

1. **Contracts and classifier** — completed for the supported exact group
   `READ` subset: mode enum, schemas, reverse projection, OpenAPI, actions,
   permissions, and fail-closed matrix.
2. **Durable synchronization** — completed for preview/apply/rollback:
   portable entities/migrations, encrypted ownership receipt, leases/retry,
   source/hash conflict handling, and five-adapter tests.
3. **Compatible adapter and operations** — create/delete, audit redaction,
   operator/developer runbooks, mocked contract, and disposable real Camunda 7
   and Operaton REST contracts are complete. A disposable Operaton test also runs the complete
   customer-sidecar preview/apply/drift/rollback lifecycle through a bounded local proxy and
   proves no downstream credential crosses that hop. The read-only tracked-ID drift check creates a
   linked sanitized receipt and is complete; it never inventories or changes
   unrelated native grants.
4. **Product workflow** — the guarded API and configuration-bundle mapping
   input are complete. The bundle supports secret preflight, hash-bound
   diff/apply, source-safe archive, and opaque export. Effective Access links,
   browser accessibility, and direct-user identity-provider certification remain
   planned work; see
   `15-authorization-program-status.md`.

Acceptance requires 100% coverage of the supported reverse-projection matrix;
an explicit disposition for every unsupported source shape; native create,
retry, drift, rollback, and no-non-owned-delete proofs; direct Camunda 7 and Operaton allow
and sibling deny with synthetic identities; EnterpriseGlue deny-before-
transport proof; source/audit redaction; and PostgreSQL, MySQL, SQL Server,
Oracle, and Spanner migration qualification.

## Non-goals

- `engine_native_authority`, native user import, native user/group provisioning,
  identity impersonation, and a second grant editor;
- broad or wildcard native grants;
- sidecar action tokens, sidecar identity heartbeats, or direct external token
  forwarding; and
- changing EnterpriseGlue's final route evaluator or compatibility behavior.
