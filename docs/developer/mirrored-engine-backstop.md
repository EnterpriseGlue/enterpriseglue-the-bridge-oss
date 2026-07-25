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

## Customer-sidecar transport

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
pnpm run test:operaton-sidecar-backstop-container
```

The disposable Camunda and Operaton containers validate their pinned compatible authorization REST contracts.
The service tests prove EnterpriseGlue's exact payload, source-drift stop,
owned-only cleanup, rollback, and missing/altered owned-grant detection without
requiring customer credentials. The sidecar container test runs preview, apply,
tracked-ID drift, and ownership-only rollback through a local bounded proxy in
front of a real Operaton engine, and asserts that no downstream credential is
sent to the proxy. The test command temporarily permits loopback HTTP only for
its disposable local fixture; production endpoint policy and HTTPS requirements
remain unchanged.
