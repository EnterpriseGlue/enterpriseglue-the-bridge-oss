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
- an owner-migration role bounded to the exact executable inventory;
- the exact ordered migration inventory the bridge may execute; and
- the exact pre- and post-enforcement database ledgers it accepts, including
  the required policy profile for each ledger.

The executable inventory ends before the enforcement migration. Both roles
hash the complete ordered `timestamp:name` inventory registered in the image,
then bind TypeORM to the declared executable subset. The owner entrypoint can
apply only that subset. Application startup rejects `apply` before schema
creation or repair. Both read the database migration ledger and refuse any
missing, additional, reordered or renamed migration.

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
    "ownerMigrationMode": "apply-through-executable",
    "executableThrough": 1700000000131,
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

The bridge host chart derives application `EG_DATABASE_STARTUP_MODE=verify`
from its packaged manifest. It renders the owner migration hook with the
separate owner credential and fixed bounded entrypoint; a Helm value cannot
skip it or extend its ceiling. Preflight verifies the live database before any
application rollout. There is no `skipMigrations`, ledger edit or mutable
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
bash scripts/check-enterpriseglue-host-chart.sh
```

`scripts/run-native-tenancy-postgres-rls.sh` includes a real PostgreSQL test of
both policy profiles. Exact candidate qualification must additionally verify
the signed backend-image copy and the candidate receipt before publication.
