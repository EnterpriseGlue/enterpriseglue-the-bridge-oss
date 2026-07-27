# Mirrored Engine Backstop Developer Guide

The Camunda 7 and Operaton backstop is a defence-in-depth projection, not a second
authorization system. Its invariants are enforced in the following order:

1. `EngineBackstopProjectionService` accepts only fully resolved exact group,
   resource, and permission candidates and emits Camunda-compatible process/decision
   group `READ` grants.
2. `EngineBackstopGroupMappingService` validates active Camunda 7 or Operaton engines and
   tenant-compatible groups, encrypts native group IDs, and forbids one native
   group from representing more than one EnterpriseGlue group on an engine.
3. `EngineBackstopSyncService` re-materializes the source before apply,
   compares source and desired hashes to preview evidence, and calls only
   `/authorization/create`, id-specific `/authorization/{id}` reads, or
   id-specific deletes.
4. `EngineBackstopSyncRun` encrypts native IDs and exact resource keys. Normal
   APIs expose only opaque references, counts, and reason codes.

For a shared engine, the projection additionally compares every active,
resolved native authorization key across tenants. Camunda-compatible native
grants carry the definition key but not an EnterpriseGlue tenant identifier;
if the same process or decision key is active in another tenant, the candidate
is blocked with `native_authorization_key_cross_tenant`. A customer must use
tenant-unique keys or leave that resource under EnterpriseGlue-authoritative
runtime authorization rather than mirroring it.

## Persistence and portability

Migration `1700000000101-add-engine-backstop-foundation` creates:

- `engine_backstop_group_mappings`;
- `engine_backstop_sync_runs`; and
- `engine_backstop_sync_tasks`.

Migration `1700000000102-add-engine-backstop-drift-observations` adds an
indexed `observed_of_run_id` link. A drift observation is a new receipt rather
than a mutation of the original apply receipt, so the original ownership proof
remains available for an ownership-only rollback.

Migration `1700000000103-add-engine-backstop-config-secret-reference` adds
`native_group_secret_ref` to a backstop mapping. It stores the opaque config
reference used for reconciliation and export; it never stores a second copy of
the native engine group id.

The migration and entity registry are qualified in PostgreSQL, MySQL, SQL
Server, Oracle, and Spanner metadata tests. The encrypted run-detail fields
use each provider's unbounded safe text representation and are capped below
the cross-provider evidence limit before persistence.

## Configuration-bundle mappings

`./engine-backstop-mappings.json` is a config-owned alternative to the
interactive mapping API. A mapping may target a direct or customer-sidecar Camunda 7 or Operaton engine and
EnterpriseGlue group declared in the same bundle. It uses a stable mapping key
and an opaque `nativeGroupIdRef`; a raw `nativeGroupId` is rejected.
The engine type allow-list is intentionally explicit (`camunda7`, `operaton`),
so a future adapter cannot gain native authorization write access merely by
sharing a REST-shaped endpoint.

```json
{
  "engineBackstopMappings": [{
    "key": "engine-backstop-mapping.camunda-operators",
    "engineRef": { "engineKey": "engine.camunda" },
    "groupRef": { "groupKey": "group.operators" },
    "nativeGroupIdRef": "env://CAMUNDA_OPERATORS_GROUP",
    "isActive": true,
    "ownershipMode": "config_locked"
  }]
}
```

Secret preflight checks only whether the reference is available. Apply resolves
it inside the transaction, encrypts the native value, and records the opaque
reference for future diff/export. Preview, diff, audit records, exports, and
normal list APIs never contain the native value. An authoritative bundle that
removes a mapping disables it locally; it does not infer ownership of, or
delete, native engine grants. Use the reviewed backstop sync and its
ownership-only rollback for native grant lifecycle changes.

## Native ownership protocol

The sync receipt stores `{ id, nativeGroupId, camundaResourceType,
resourceKey }` only in encrypted detail. Reconciliation does the following:

1. retain a prior owned grant when its exact desired identity still exists;
2. create each new exact desired grant and persist its native ID immediately;
3. delete only tracked old IDs that are no longer desired; and
4. retain the encrypted ownership record for the configured 30-day maximum.

On a partial failure, the recorded IDs remain with the failed run so retry or
rollback does not need to infer native ownership. A missing or expired receipt
is a hard stop for deletion.

`EngineBackstopSyncTask` has a database unique key on `run_id` and a renewable
lease. Concurrent enqueue requests re-read the winning row after a unique-key
collision, while concurrent workers claim a queued row atomically. An expired
lease is safely returned to the queue; a failed task records a bounded retry
delay and never causes a second native execution while its lease is valid.

## Customer-sidecar transport

The normative sidecar route, header, credential-boundary, error, and
versioning requirements are in the
[Customer Sidecar Backstop Adapter API](../reference/customer-sidecar-backstop-adapter-api.md).

For an engine registered with `connectionMode: customer_sidecar`, the sync
receipt selects `CustomerSidecarBackstopNativeClient`. It has the same bounded
surface as the direct adapter: create one exact group `READ` grant, then read
or delete only an ID retained in encrypted ownership evidence. It uses the
shared BPMN connection resolver, so calls go to the registered sidecar URL with
the normal request/engine/operation metadata and operation class
`engine.native_authorization.backstop`.

EnterpriseGlue does not store, receive, forward, rotate, or log the sidecar's
downstream peer-to-peer token or engine credential. The customer-owned sidecar
authenticates the hop to its engine and should allow only these bounded
authorization endpoints for this operation class. A sidecar rejection fails
the sync task closed; no direct-engine fallback occurs.

`test/e2e/operaton-container/customer-sidecar-reference.mjs` is the executable
reference adapter used by the Docker contract. It accepts only `POST
/authorization/create` plus ID-addressed `GET`/`DELETE` authorization calls,
forwards only the JSON content type and sidecar-owned upstream authentication,
and turns an unavailable downstream engine into a sanitized `502`. Its minimal
container image can be built with:

```bash
pnpm run test:customer-sidecar-reference-container
```

The image expects `EG_CUSTOMER_SIDECAR_ENGINE_URL` and, when the customer uses
an HTTP authorization scheme, `EG_CUSTOMER_SIDECAR_UPSTREAM_AUTHORIZATION` to
be injected into the sidecar deployment. Those values are never EnterpriseGlue
engine configuration fields.

## Read-only drift protocol

`driftCheck` accepts only a successful apply receipt with retained encrypted
ownership evidence. It creates a linked observation receipt and schedules a
`drift_check` task. The task reads only `/authorization/{id}` for the recorded
IDs, then compares type `1`, the mapped group, resource type/key, and the
single `READ` permission. It never lists the authorization collection and
never creates, updates, or deletes a grant. A missing or altered owned grant
makes only the observation receipt `out_of_sync`; it does not rewrite the
apply receipt or make an inference about unrelated customer grants.

## Extending the projection

Do not add a native resource type or permission by changing only the compatible-engine
REST payload. Add it to the shared Zod contract, classifier reason-code matrix,
sanitized receipt, source builder, test matrix, OpenAPI/action registry, and
operator documentation. New support must prove that it cannot turn a deny,
tenant mismatch, broad scope, or unowned native row into an allow.

## Verification

Run the focused suite after a change:

```bash
pnpm --filter shared run build
pnpm --filter backend-host run build
pnpm --dir backend exec vitest run \
  __tests__/shared/services/platform-admin/engineBackstopProjectionService.test.ts \
  __tests__/shared/services/platform-admin/engineBackstopGroupMappingService.test.ts \
  __tests__/shared/services/platform-admin/engineBackstopSyncRunService.test.ts \
  __tests__/shared/services/platform-admin/engineBackstopSyncTaskService.test.ts \
  __tests__/shared/services/platform-admin/engineBackstopSyncService.test.ts \
  __tests__/shared/db/engineBackstopPersistence.test.ts \
  __tests__/shared/services/platform-admin/configBundlePreviewService.test.ts \
  __tests__/shared/services/platform-admin/configBundleDiffService.test.ts \
  __tests__/shared/services/platform-admin/configBundleApplyService.test.ts \
  __tests__/shared/services/platform-admin/configBundleExportService.test.ts \
  __tests__/modules/mission-control/engines/routes.test.ts
pnpm run test:action-registry
pnpm run test:camunda7-native-grant-container
pnpm run test:operaton-native-auth-container
pnpm run test:customer-sidecar-reference-container
pnpm run test:operaton-sidecar-backstop-container
pnpm run test:operaton-backstop-browser
```

The disposable Camunda and Operaton containers validate their pinned compatible authorization REST contracts.
The service tests prove EnterpriseGlue's exact payload, source-drift stop,
owned-only cleanup, rollback, and missing/altered owned-grant detection without
requiring customer credentials. The sidecar container test runs preview, apply,
tracked-ID drift, and ownership-only rollback through a local bounded proxy in
front of a real Operaton engine, and asserts that no downstream credential is
sent to the proxy. It also proves that a sidecar-native-write rejection fails
closed without selecting the direct adapter. The test command temporarily
permits loopback HTTP only for its disposable local fixture; production endpoint
policy and HTTPS requirements remain unchanged.

### Local Operaton browser acceptance

`pnpm run test:operaton-backstop-browser` is an opt-in localhost acceptance
lane for the **direct Operaton** operator workflow. It starts one disposable,
pinned Operaton container, while reusing the already-running local
EnterpriseGlue frontend, backend, and database. It requires those services at
`http://localhost:5173` and `http://localhost:8787` by default.

The test signs in as the disposable local administrator, registers the
container as an `operaton` engine through the public API, reconciles a process
and a decision runtime resource, and uses the Mission Control panel to save a
write-only native-group mapping, preview, apply, and detect native drift. It
then reads the disposable engine directly to prove that exactly the expected
process-definition (`6`) and decision-definition (`10`) group `READ` grants
exist. The native group ID is asserted absent from the panel after save. The
browser runs at a 1440x900 MacBook-sized viewport, checks the paired mapping
field alignment, and writes an ignored local panel screenshot under
`.artifacts/operaton-backstop-browser/` (as well as attaching it to the
Playwright result).

The runner addresses the engine through Docker's host gateway for the
EnterpriseGlue backend and loopback for browser-level proof. It uses only the
container's public demo account and stores that disposable password through
the normal write-only engine credential path; it does not relax the direct
endpoint authentication policy. The runner deletes its engine and group rows
and removes the Operaton container on completion. It is local evidence, not a
customer-engine qualification.
