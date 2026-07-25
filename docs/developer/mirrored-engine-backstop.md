# Mirrored Engine Backstop Developer Guide

The Camunda 7 backstop is a defence-in-depth projection, not a second
authorization system. Its invariants are enforced in the following order:

1. `EngineBackstopProjectionService` accepts only fully resolved exact group,
   resource, and permission candidates and emits Camunda process/decision
   group `READ` grants.
2. `EngineBackstopGroupMappingService` validates active Camunda 7 engines and
   tenant-compatible groups, encrypts native group IDs, and forbids one native
   group from representing more than one EnterpriseGlue group on an engine.
3. `EngineBackstopSyncService` re-materializes the source before apply,
   compares source and desired hashes to preview evidence, and calls only
   `/authorization/create` or id-specific `/authorization/{id}` deletes.
4. `EngineBackstopSyncRun` encrypts native IDs and exact resource keys. Normal
   APIs expose only opaque references, counts, and reason codes.

## Persistence and portability

Migration `1700000000101-add-engine-backstop-foundation` creates:

- `engine_backstop_group_mappings`;
- `engine_backstop_sync_runs`; and
- `engine_backstop_sync_tasks`.

The migration and entity registry are qualified in PostgreSQL, MySQL, SQL
Server, Oracle, and Spanner metadata tests. The encrypted run-detail fields
use each provider's unbounded safe text representation and are capped below
the cross-provider evidence limit before persistence.

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

## Extending the projection

Do not add a native resource type or permission by changing only the Camunda
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
  __tests__/modules/mission-control/engines/routes.test.ts
pnpm run test:action-registry
pnpm run test:camunda7-native-grant-container
```

The disposable Camunda container validates the pinned Camunda 7 REST contract.
The service tests prove EnterpriseGlue's exact payload, source-drift stop,
owned-only cleanup, and rollback behavior without requiring customer
credentials.
