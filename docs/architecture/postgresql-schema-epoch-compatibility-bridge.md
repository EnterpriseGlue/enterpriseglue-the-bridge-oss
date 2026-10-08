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
- an `owner-transition-1700000000131-dual-context-closure/v1` source-content digest over
  migration 1700000000131 and its bounded verification/startup closure, including its schema helper,
  legacy-policy verifier, runtime-grant helper, effect inventory, settlement
  implementation and cohort opener; and
- the exact pre- and post-enforcement database ledgers it accepts, including
  the required policy profile for each ledger.

The executable migration inventory ends before the enforcement migration. The
implementation inventory covers the 0131 owner-transition closure; it neither
binds nor authorizes replay of migrations 0000–0130. Fresh managed shards use
the separate signed, default-off
[PostgreSQL managed-shard bootstrap](./postgresql-managed-shard-bootstrap.md),
whose exact postcondition is this bridge's 0130 owner predecessor. Both roles
hash the complete ordered `timestamp:name` inventory registered in the image,
then bind TypeORM to the declared executable subset. Protected candidate
staging additionally hashes the source bytes that can affect the only
executable transition or its policy readiness decision; a name-preserving code
or helper mutation therefore invalidates the manifest. Application startup
rejects `apply` before schema creation or repair.

The owner entrypoint is intentionally narrower than the ordinary migration
orchestrator. It reads the ledger and exact `legacy-tenant-context/v1` policy before any database
mutation, accepts only the signed 0130 predecessor or an already accepted
0131/0132 epoch, and executes only migration 0131. It does not enter the
temporary migration-policy lease, replay migrations 0000–0130, synchronize,
baseline, repair RLS, run the generic grant refresh, seed RBAC or project legacy data. After a
successful epoch verification it may revoke and replace direct privileges on only the new 0131
table for a configured, verified restricted role; this exact helper is included in the executable
implementation digest. A fresh
database, the known v0.20 empty-ledger state, a partial ledger, or any other
starting point fails closed and requires a separately designed and signed
bootstrap/recovery artifact. The separate fresh-shard bootstrap does not change
this classifier or add a fresh-database branch to the bridge.

The exact 0130 source requires the released one-policy
`legacy-tenant-context/v1` FORCE-RLS shape. Migration 0131 atomically replaces
it with four attested command policies using
`dual-context-compatibility/v1`: each predicate is the exact legacy predicate
OR the finite current capability predicate. This permits the pinned predecessor
and current runtime to overlap without adding a database role, grant, bypass,
or unbounded global branch. Migration 0132 replaces dual compatibility with
the attested `explicit-context/v1` profile. A ledger/profile mismatch or policy
drift fails readiness; pure legacy policy is never accepted at 0131. Every
accepted state still requires a restricted nonowning runtime role and the
normal critical-schema integrity checks.

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
    "ownerMigrationFrom": {
      "through": 1700000000130,
      "count": 132,
      "sha256": "e525e9f9fe8d66498aeea6beb03d6257274de3a38a7b48819de6edccf02ecb16",
      "postgresPolicyProfile": "legacy-tenant-context/v1"
    },
    "ownerRuntimeGrant": "configured-role-release-effect-cohorts-select-insert-update/v1",
    "freshDatabase": "requires-separate-signed-bootstrap",
    "emptyMigrationLedger": "requires-separate-signed-recovery",
    "executableThrough": 1700000000131,
    "executableImplementationSha256": "<64 lowercase hexadecimal characters>",
    "executableImplementationPurpose": "owner-transition-1700000000131-dual-context-closure/v1",
    "releaseEffectInventoryVersion": "release-effect-inventory.enterpriseglue.io/v1",
    "releaseEffectInventorySha256": "c35183c2dee4ec8477948fdcd00d8b0b5e10de051d6e5ce9001950e2dac36087",
    "acceptedDatabaseEpochs": [
      {
        "id": "pre-enforcement",
        "through": 1700000000131,
        "count": 133,
        "sha256": "12d8f4fe707e5f8a320f187979c5546c6b17198477a182c99c4ae3d8448417e1",
        "postgresPolicyProfile": "dual-context-compatibility/v1"
      },
      {
        "id": "post-enforcement",
        "through": 1700000000132,
        "count": 134,
        "sha256": "fccc489d5df1c1e98795901b973f632dec2b8f3b71067910f96b6264859e870a",
        "postgresPolicyProfile": "explicit-context/v1"
      }
    ]
  }
}
```

The manifest is also an inventoried OCI layer at the declared path. Candidate
staging verifies that the backend image contains byte-identical manifest data,
and the chart packages the same bytes. A downstream deployment controller must
verify the candidate signature, source revision, backend and chart subject digests, receipt
inventory, manifest checksum, transition implementation digest and effect inventory before it
recognizes the release as a bridge. It computes the SHA-256 of the exact verified receipt bytes
and passes `sha256:<64 lowercase hex>` as the managed release ID; OSS stores and propagates that
identity unchanged. It must not synthesize the receipt projection from tags or operator input.

The bridge host chart activates this contract only when its validated profile
is exactly `postgres` plus `pooled`, then derives application
`EG_DATABASE_STARTUP_MODE=verify` from its packaged manifest and renders the
profile into each workload. It renders the owner migration hook with the
separate owner credential and fixed bounded entrypoint; a Helm value cannot
skip it or extend its ceiling. Omitted profiles, other adapters and
single-tenancy PostgreSQL retain the prior `database.migration.enabled`
behavior. Preflight verifies the live database before any application rollout.
For an enabled release-effect cohort, the chart accepts only that receipt-digest release ID and the inventory
version and SHA-256 projected from this exact signed receipt. Hook weights fix
the order to owner `-20`, grant/epoch preflight `-10`, cohort opener `0`, then
API and workers. There is no `skipMigrations`, ledger edit or mutable
release-mode value.

The managed bridge requires pairwise-distinct application, owner-migration and
membership-free preflight database Secrets. Migration and preflight Kubernetes
ServiceAccounts are distinct; the enabled opener has a third distinct account.
The preflight login receives schema `USAGE` and `SELECT` only on the TypeORM
migration ledger. Because PostgreSQL `information_schema.tables` hides
business relations from that identity, the signed preflight resolves table and
RLS-policy presence through a parameterized `pg_catalog` probe limited to
ordinary and partitioned tables. It does not run generic bootstrap or
business-data integrity reads. Application, owner, single-tenancy and
non-PostgreSQL paths keep their ordinary TypeORM discovery behavior.
Every hook imports the stable built shared-package output under
`dist/packages/shared/dist`; candidate-image qualification executes those
imports so a source-only path cannot pass release qualification.

Any retained v0.24.2 predecessor at the 0131 epoch must run with
`EG_DATABASE_STARTUP_MODE=verify`. Its apply path reruns migration 0126's
historical policy installer and would add a fifth legacy policy beside the four
attested dual policies. The chart's immutable pooled-PostgreSQL profile forces
verify startup; qualification restarts the exact digest-pinned predecessor at
0131, proves readiness and a legacy tenant read, and then proves current exact
dual attestation is unchanged. Apply-mode predecessor overlap is unsupported
and rejected by the operational harness.

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

## Cloud passkey compatibility successor

The Cloud passkey compatibility release carries a new
`enterpriseglue-schema-epoch/v2` manifest with identity
`postgres-explicit-context-cloud-email-compat-v2`. It does not modify any
previously published v1 manifest or the 0131/0132 ledger definitions. The v2
manifest adds only the exact future ledger ending at migration 0133, whose
registered identity is `AddCloudEmailPasskeys1700000000133` and whose
ordered-inventory SHA-256 is
`fda1b411123ad655519308b8842178ce96d4e997bb8a7bd5f52648cf16875e9d`.
The 0133 ledger retains the exact `explicit-context/v1` PostgreSQL policy
profile. Any other migration identity, ledger, or policy profile fails closed.

This compatibility release contains no 0133 migration implementation and
creates no passkey tables. Its owner job remains bounded to 0131; its
application and preflight remain verify-only. After it is installed, a later
release may apply 0133 through a separately signed, owner-controlled
transition. Keep this v2 release available as the application rollback target
after that transition; v1 binaries cannot read the 0133 ledger. The downstream
Cloud intake verifier must recognize the v2 receipt projection before the
compatibility release is selected for staging.

## Verification

Focused source checks are:

```sh
node scripts/schema-epoch-manifest.mjs --write
node scripts/schema-epoch-manifest.mjs --check
pnpm --dir backend exec vitest run \
  __tests__/shared/db/schemaEpoch.test.ts \
  __tests__/shared/db/run-migrations.test.ts \
  --config vitest.config.ts --maxWorkers=1 --no-file-parallelism
node --test scripts/release-candidate-receipt.test.mjs
node --test scripts/schema-epoch-manifest.test.mjs
bash scripts/check-enterpriseglue-host-chart.sh
```

Run `--write` whenever one of the inventoried executable source files changes.
It deterministically replaces only the computed executable and release-effect
inventories, then writes byte-identical shared-package and host-chart manifest
copies. Review that generated diff before running `--check`; never hand-edit a
digest in either manifest copy.

`scripts/run-native-tenancy-postgres-rls.sh` includes a real PostgreSQL test of
both policy profiles. Exact candidate qualification must additionally verify
the signed backend-image copy and the candidate receipt before publication.
