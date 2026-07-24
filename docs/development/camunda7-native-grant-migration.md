# Develop and Test Camunda 7 Native-Grant Migration

This guide describes the implemented safe subset of the Camunda 7 native-grant
migration feature.

## Boundaries

- Live discovery performs paginated `GET /authorization` only; no Camunda
  write endpoint or system-table query is permitted.
- `camunda7-v1-read-only` proposes only exact group `READ` grants on active,
  unambiguous `process_definition` or `decision_definition` runtime resources.
- The generated role maps both supported read actions to
  `engine:instance:view`, then scopes it through exact Runtime Resource Sets.
- `enterpriseglue_authoritative` remains active. Do not add
  `engine_native_authority` as an alternate evaluator path.
- Native group ids, user ids, and resource ids are encrypted in the detailed
  snapshot and replaced with opaque references in ordinary history/audit data.

## Migration bundle safety

The engine route accepts only a new migration base:

```json
{
  "bundle": {
    "apiVersion": "enterpriseglue.ai/v1alpha1",
    "kind": "EnterpriseGlueConfigBundle",
    "metadata": { "key": "migration.camunda-native-example", "owner": "camunda-native-grant-migration" },
    "tenantKey": "default",
    "mode": "additive",
    "settings": { "engineRuntimeAuthorizationMode": "enterpriseglue_authoritative" },
    "imports": ["./groups.json"]
  },
  "files": { "./groups.json": { "groups": [] } }
}
```

The route creates an internal existing-engine reference rather than copying the
engine into `engines.json`. `ConfigBundlePreviewService`, diff, and apply accept
that reference only for Runtime Resource Sets and only when the controlled
migration route binds it to the original active engine id and tenant. It cannot
be used for engine-wide assignments, Engine Sets, project targets, tenancy
mappings, credentials, or engine ownership changes.

The dedicated bundle key allows a reverse authoritative bundle to archive only
objects with that exact `config_bundle:<key>` source reference. Never broaden
the route to accept an arbitrary existing bundle unless rollback ownership and
baseline preservation are redesigned and tested.

## Persistence and migration requirements

`CamundaNativeGrantImportRun` stores opaque classifications and a 30-day
maximum encrypted detail snapshot. It links the forward and rollback
configuration-apply run ids. The persistence entity is registered for
PostgreSQL, MySQL, SQL Server, Oracle, and Spanner through the canonical
adapter registry; migrations `0098`, `0099`, and `0100` create the import
receipt, rollback receipt columns, and a safe widening path for old receipt
rows. The encrypted snapshot and sanitized classification record use each
adapter's unbounded document type, while the service enforces a 2 MiB encrypted
evidence and classification limit before it writes anything. A limit rejection
is a validation result: split the migration into smaller scopes and rerun the
read-only preview. It is never a truncated or partially persisted import.

The backend starts the encrypted-detail retention purge by default and then
runs it hourly. `CAMUNDA_NATIVE_GRANT_SNAPSHOT_RETENTION_PURGE_INTERVAL_MS`
may increase or decrease the positive cadence; an empty, zero, or invalid value
falls back to the safe hourly cadence rather than disabling retention. The purge
removes only expired ciphertext and retains sanitized counts, opaque references,
and apply/rollback receipts.

Any change to its columns must update the entity, source migration, persistence
migration bridge, adapter registry evidence, and tests. Never put source
identifiers in `normalizedCountsJson`, `classificationsJson`, generic audit
details, browser telemetry, or ordinary API responses.

The five-adapter database lane is part of the required migration evidence. It
executes the exact receipt migrations against disposable PostgreSQL, MySQL,
SQL Server, Oracle, and Spanner targets. It specifically proves portable text,
boolean, integer, indexes, add/remove/retry behavior, and transactional
rollback of a synthetic receipt. Run it from a clean commit using
`pnpm run test:engine-tenancy:database-matrix`; a one-adapter
`--allow-dirty` run is diagnostic only.

## Local test commands

Run the focused migration suite:

```bash
pnpm --filter shared run build
pnpm --dir backend exec vitest run \
  __tests__/shared/services/platform-admin/camundaNativeGrantInventoryService.test.ts \
  __tests__/shared/services/platform-admin/camundaNativeGrantFixtureIntegration.test.ts \
  __tests__/shared/services/platform-admin/camundaNativeGrantDraftService.test.ts \
  __tests__/shared/services/platform-admin/camundaNativeGrantImportRunService.test.ts \
  __tests__/shared/services/platform-admin/configBundlePreviewService.test.ts \
  __tests__/shared/services/platform-admin/configBundleDiffService.test.ts \
  __tests__/shared/services/platform-admin/configBundleApplyService.test.ts \
  __tests__/modules/mission-control/engines/routes.test.ts \
  --config vitest.config.ts --maxWorkers=1 --no-file-parallelism
node --test test/e2e/mock-camunda/native-grants.test.mjs
pnpm run test:camunda7-native-grant-container
bash ./scripts/run-local-safe-native-grant-migration.sh
pnpm --dir frontend exec vitest run \
  __tests__/src/features/mission-control/engines/components/CamundaNativeGrantMigrationPanel.test.tsx
pnpm --filter frontend-host run build
```

Then run `pnpm run test:action-registry` and the applicable five-adapter
database qualification before a release. The synthetic fixture is in
`test/e2e/mock-camunda`; it includes exact supported grants plus broad, user,
global, revoke, unsupported-permission/resource, missing-principal,
missing-resource-id, and missing-runtime-resource cases. Its HTTP-backed
integration test asserts the inventory uses `GET /authorization` only. Do not
replace it with customer grants.

The local Docker integration test creates a synthetic existing engine and
runtime resources, applies the generated configuration, drains the normal
Runtime Resource Set materialization task, adds an SSO-source membership to
the configuration-owned group, proves target allow/sibling deny Effective
Access, then performs a hash-bound authoritative rollback. It cleans all
synthetic rows after completion. It intentionally does not use the manual
membership API, because source-managed groups reject manual edits.

`test:camunda7-native-grant-container` is an opt-in, disposable Docker
contract against the pinned `camunda/camunda-bpm-platform` image digest. It seeds only synthetic groups
and authorization records through Camunda's documented REST endpoints, reads
the real paginated `/authorization` endpoint through the production inventory
service, and proves exact process-definition (`6`) and decision-definition
(`10`) `READ` grants classify as proposed. It asserts that the inventory path
uses only `GET`; its setup writes are isolated to the container and the
container is removed even on failure. Use the mock fixture for fast complete
classification coverage and this lane for real-Camunda REST compatibility.
Camunda-only operational response fields such as `removalTime` and
`rootProcessInstanceId` are discarded at the trusted live API boundary before
canonical hashing and classification; the customer-export schema remains
strict and does not accept those extra fields.

To exercise a different supported Camunda 7 image intentionally, set
`EG_CAMUNDA7_IMAGE` for the command and retain its image digest and result with
the migration evidence. Do not replace the default pin with `latest`.

## Effective Access verification

The migration run proves configuration creation, not a real user's identity
membership. A browser/integration test must create or synchronize a
representative user into each imported EnterpriseGlue group and test both the
target resource allow and a sibling-resource deny using Effective Access and
the protected Mission Control route. For shared engines also test resolved,
unmapped, and conflicting runtime-tenant rows.

## Browser and customer-acceptance handoff

The following is the executable final gate that cannot be substituted by unit,
container, or API-only evidence. It requires a browser runner permitted to
reach the local Docker frontend and backend, plus an authenticated
EnterpriseGlue administrator session. Do not use customer identities or
customer grants for this qualification.

### Required inputs

- A clean release commit, the local Docker EnterpriseGlue stack, and the
  pinned Camunda image used by `pnpm run test:camunda7-native-grant-container`.
- One synthetic registered Camunda 7 engine and active discovered runtime
  resources: at least one mapped process definition, one mapped decision
  definition, and one sibling resource with no grant.
- Two synthetic EnterpriseGlue identities: a member of each imported group and
  a non-member. Create membership only through the configured identity-source
  synchronization path, not the manual group-membership API.
- For a shared engine, one each of resolved, unmapped, and conflicting runtime
  tenant rows. For a dedicated engine, record the default-tenant result.

### Procedure and retained evidence

1. Run `pnpm run test:camunda7-native-grant-container` and retain the pinned
   image digest plus its passing result.
2. In Mission Control, create the preview from the synthetic source, inspect
   every manual/blocked disposition, map only supported groups, generate the
   draft, and apply its exact returned hash. Record sanitized preview counts,
   input hash, draft hash, and configuration apply receipt id.
3. Synchronize the synthetic member through the configured provider path. In
   Effective Access and the protected process/decision routes, prove target
   allow and sibling/non-member deny for every mapped resource type. Record the
   explained decision and protected-route response without raw group ids.
4. Run the guarded browser and accessibility lanes:

   ```bash
   pnpm run test:authz:local-smoke:cross-browser
   pnpm run test:engine-tenancy:provisioning-journeys:local
   pnpm run test:authz:accessibility:cross-browser
   pnpm run test:authz:state-space-evidence
   ```

   Retain their current-clean artifacts: browser matrix, provisioning journey,
   accessibility matrix, and authorization state-space matrix.
5. Preview rollback, confirm that every changed object is owned by the exact
   migration source reference, acknowledge only the returned archive set, and
   apply the exact rollback hash. Record the rollback preview hash and receipt
   id. Re-run the same allow/deny cases and confirm the imported allow has been
   removed while the engine registration, tenant mapping, and unrelated records
   remain unchanged.

Success requires all supported groups/resources to have an allow and a sibling
or non-member deny, every unsupported source row to remain manual or blocked,
no native Camunda write during inventory, a current-clean artifact for every
lane above, and the rollback result described in step 5. Stop and roll back if
a preview is truncated, a receipt/hash changes, a shared tenant is unresolved,
an unexpected object is proposed for archive, a protected-route deny becomes
an allow, or the browser evidence cannot be captured. The browser, state-space,
and customer-acceptance checklist items stay open until those artifacts exist;
do not remove compatibility or change the runtime model based on local-only
evidence.
