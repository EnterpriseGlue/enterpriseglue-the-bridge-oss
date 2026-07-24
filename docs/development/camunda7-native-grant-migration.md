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
adapter registry; migrations `0098` and `0099` create the import receipt and
rollback receipt columns.

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

## Effective Access verification

The migration run proves configuration creation, not a real user's identity
membership. A browser/integration test must create or synchronize a
representative user into each imported EnterpriseGlue group and test both the
target resource allow and a sibling-resource deny using Effective Access and
the protected Mission Control route. For shared engines also test resolved,
unmapped, and conflicting runtime-tenant rows.
