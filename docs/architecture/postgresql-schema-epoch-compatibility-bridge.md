---
doc_class: technical
audience: architect, developer, operator
publication: github
lifecycle: as-built
---

# PostgreSQL schema-epoch compatibility bridge

The PostgreSQL pooled-tenancy compatibility bridge is a separately versioned
OSS host release. Its separately credentialed owner job installs only the
bridge's release-effect foundation; it never applies the policy-enforcement
migration. Its application runtime installs the explicit TypeORM
database-context boundary and remains ready on the exact pre-enforcement schema
and on the exact schema produced by the later owner-controlled enforcement
release.

The bridge is not selected by an environment flag. Its immutable manifest is
part of the shared package, the backend image and the host chart. The normal
release-candidate signature binds all three copies through the backend image,
chart and signed candidate bundle.

## Runtime contract

`packages/shared/src/schema-epoch-manifest.json` declares:

- the PostgreSQL pooled-tenancy target;
- the `postgres-explicit-context/v1` runtime capability;
- a `verify-only` application-startup role;
- a read-only preflight role that verifies the exact runtime cohort grant;
- an owner-migration role bounded to the exact executable inventory;
- an optional configured-role grant bounded to `SELECT`, `INSERT`, and
  `UPDATE` on the 0131 `release_effect_cohorts` table;
- the exact 132-entry predecessor ledger through migration 1700000000130;
- explicit unsupported fresh-database and empty-ledger states;
- the exact ordered migration inventory the bridge may execute; and
- the exact release-effect inventory version and SHA-256 accepted by the
  ordered cohort opener;
- a source-content digest over migration 1700000000131, its schema helper,
  legacy-policy verifier, runtime-grant helper, effect inventory, settlement
  implementation and cohort opener; and
- the exact pre- and post-enforcement database ledgers it accepts, including
  the required policy profile for each ledger.

The executable inventory ends before the enforcement migration. Both roles
hash the complete ordered `timestamp:name` inventory registered in the image,
then bind TypeORM to the declared executable subset. Protected candidate
staging additionally hashes the source bytes that can affect the only
executable transition or its policy readiness decision; a name-preserving code
or helper mutation therefore invalidates the manifest. Application startup
rejects `apply` before schema creation or repair.

The owner entrypoint is intentionally narrower than the ordinary migration
orchestrator. It reads the ledger and exact legacy policy before any database
mutation, accepts only the signed 0130 predecessor or an already accepted
0131/0132 epoch, and executes only migration 0131. It does not enter the
temporary migration-policy lease, replay migrations 0000–0130, synchronize,
baseline, repair RLS, run the generic grant refresh, seed RBAC or project legacy data. After a
successful epoch verification it may revoke and replace direct privileges on only the new 0131
table for a configured, verified restricted role; this exact helper is included in the executable
implementation digest. A fresh
database, the known v0.20 empty-ledger state, a partial ledger, or any other
starting point fails closed and requires a separately designed and signed
bootstrap/recovery artifact.

Pre-enforcement readiness requires the exact legacy FORCE-RLS policy shape.
The bridge does not accept an arbitrary permissive policy: policy name,
command, roles, `USING` and `WITH CHECK` tokens must match the released policy.
Post-enforcement readiness uses the attested four-command explicit-context
policy verifier. Both states still require a restricted nonowning runtime role
and the normal critical-schema integrity checks.

The manifest applies only to PostgreSQL pooled tenancy. Other supported
database adapters and single-tenancy PostgreSQL retain their ordinary migration
behavior; this bridge is not cross-database portability evidence.

## Signed release interface

The signed `enterpriseglue-release-candidate/v1` receipt contains this additive
field:

```json
{
  "schemaEpoch": {
    "manifestPath": "metadata/schema-epoch-manifest.json",
    "manifestSha256": "<64 lowercase hexadecimal characters>",
    "id": "postgres-explicit-context-bridge-v1",
    "applicationStartupMode": "verify-only",
    "preflightMode": "verify-runtime-grant",
    "ownerMigrationMode": "apply-through-executable",
    "ownerMigrationFrom": 1700000000130,
    "ownerRuntimeGrant": "configured-role-release-effect-cohorts-select-insert-update/v1",
    "freshDatabase": "requires-separate-signed-bootstrap",
    "emptyMigrationLedger": "requires-separate-signed-recovery",
    "executableThrough": 1700000000131,
    "executableImplementationSha256": "<64 lowercase hexadecimal characters>",
    "releaseEffectInventoryVersion": "release-effect-inventory.enterpriseglue.io/v1",
    "releaseEffectInventorySha256": "c35183c2dee4ec8477948fdcd00d8b0b5e10de051d6e5ce9001950e2dac36087",
    "acceptedThrough": [1700000000131, 1700000000132]
  }
}
```

The manifest is also an inventoried OCI layer at the declared path. Candidate
staging verifies that the backend image contains byte-identical manifest data,
and the chart packages the same bytes. A downstream deployment controller must
verify the candidate signature, source revision, subject digests, receipt
inventory and manifest checksum before it recognizes the release as a bridge.
It must not synthesize this field from tags or operator input.

The bridge host chart activates this contract only when its validated profile
is exactly `postgres` plus `pooled`, then derives application
`EG_DATABASE_STARTUP_MODE=verify` from its packaged manifest and renders the
profile into each workload. It renders the owner migration hook with the
separate owner credential and fixed bounded entrypoint; a Helm value cannot
skip it or extend its ceiling. Omitted profiles, other adapters and
single-tenancy PostgreSQL retain the prior `database.migration.enabled`
behavior. Preflight verifies the live database before any application rollout.
For an enabled release-effect cohort, the chart accepts only the inventory
version and SHA-256 projected from this exact signed receipt. Hook weights fix
the order to owner `-20`, grant/epoch preflight `-10`, cohort opener `0`, then
API and workers. There is no `skipMigrations`, ledger edit or mutable
release-mode value.

## Cutover boundary

Publish and promote the bridge like any other exact signed OSS release. Keep the
previous release for the complete 28-day recorded fallback interval; this bridge
does not shorten that clock. The enforcement
migration runs only from the later owner-controlled release while every old
schema consumer is drained. Reopen traffic only after the bridge itself passes
readiness on the post-enforcement epoch. The final release uses the freed route
slot, and the unchanged bridge becomes its fallback.

Do not add later migrations to either accepted epoch. A new schema change needs
a new signed compatibility decision; changing the database ledger or the
manifest under an existing release identity is unsupported.

## Verification

Focused source checks are:

```sh
pnpm --dir backend exec vitest run \
  __tests__/shared/db/schemaEpoch.test.ts \
  __tests__/shared/db/run-migrations.test.ts \
  --config vitest.config.ts --maxWorkers=1 --no-file-parallelism
node --test scripts/release-candidate-receipt.test.mjs
node --test scripts/schema-epoch-manifest.test.mjs
bash scripts/check-enterpriseglue-host-chart.sh
```

`scripts/run-native-tenancy-postgres-rls.sh` includes a real PostgreSQL test of
both policy profiles. Exact candidate qualification must additionally verify
the signed backend-image copy and the candidate receipt before publication.
