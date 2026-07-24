# Qualify Engine Tenancy on Every Supported Database

Summary: Run and interpret the disposable five-database qualification for
engine-tenancy migrations and mapping behavior.

Audience: Developers, database maintainers, reviewers, and release operators.

## Purpose and Coverage Denominator

This lane proves that the engine-tenancy persistence contract behaves the same
on PostgreSQL, MySQL, SQL Server, Oracle, and Google Spanner. It creates
localhost-only disposable containers, runs the real shared migrations and
mapping service, retains sanitized evidence, and removes every container.

The complete denominator is:

- five database adapters;
- seven required stages per adapter, or **35/35 stage cells**;
- two supported upgrade baselines per adapter, or **10/10 baseline
  observations**; and
- one equivalent logical-schema fingerprint across all five adapters.

The required stages are:

1. `clean_install`;
2. `upgrade_baselines`;
3. `interrupted_retry`;
4. `schema_equivalence`;
5. `service_behavior`;
6. `rollback`; and
7. `cleanup`.

The supported baselines are the schema immediately before the engine-tenancy
foundation migration and the foundation schema immediately before the portable
tenant-reference migration.

The same contract also qualifies the Camunda 7 native-grant import receipt:
migrations `0098` and `0099` create, remove, recreate, and retry its opaque
receipt and rollback-receipt columns on every adapter. The rollback transaction
deliberately writes a synthetic receipt and then fails, proving that no partial
migration evidence survives. It uses no customer grants, identifiers, or
credentials.

## Prerequisites

- Docker is running and can pull Linux containers.
- Node.js, Corepack, and pnpm are available.
- Dependencies are installed from the checked-in lockfile.
- The five fixed localhost ports in
  `test/database/engine-tenancy-database-matrix-contract.json` are available.
- A release-qualifying run starts from an unchanged, clean Git commit.

No deployed database, customer data, cloud credential, or identity-provider
credential is required. The Spanner target uses the local emulator.

## Run the Complete Release Qualification

From the repository root:

```bash
corepack pnpm install --frozen-lockfile
pnpm run test:engine-tenancy:database-matrix
```

The runner starts one isolated target at a time:

| Adapter | Disposable image | Local port |
| --- | --- | ---: |
| PostgreSQL | `postgres:18-alpine` | 56432 |
| MySQL | `mysql:8.4` | 53306 |
| SQL Server | `mcr.microsoft.com/mssql/server:2022-latest` | 51433 |
| Oracle | `gvenzl/oracle-xe:21-slim-faststart` | 51521 |
| Spanner | `gcr.io/cloud-spanner-emulator/emulator:1.5.30` | 59010 |

All images run as `linux/amd64`, matching the hosted qualification runner and
remaining deterministic on Apple Silicon through Docker emulation. Image pulls
retry automatically when a registry connection fails transiently.

The authoritative target list, platforms, ports, stages, baselines, required
columns, and required indexes live in
`test/database/engine-tenancy-database-matrix-contract.json`. Changing that
contract changes the denominator immediately.

## Diagnose One Adapter During Development

Use a focused dirty-worktree run while fixing a target:

```bash
node scripts/run-engine-tenancy-database-matrix.mjs \
  --database=oracle \
  --allow-dirty
```

Replace `oracle` with `postgres`, `mysql`, `mssql`, or `spanner`. A focused or
dirty run is diagnostic only. It cannot qualify a release, even when all of
its executed checks pass. Run the complete command from a clean commit
afterward.

Use `--keep-containers` only for short-lived investigation. It deliberately
prevents the cleanup stage from qualifying and must never be used for release
evidence.

## Evidence and Success Criteria

The runner writes:

- per-adapter observations under
  `test/results/engine-tenancy-release/database-observations/`; and
- the aggregate
  `test/results/engine-tenancy-release/database-matrix.json`.

A release-qualifying result has all of the following:

- `status` is `passed`;
- `sourceState` is `clean`;
- `releaseCommitQualified` is `true`;
- `verifiedTargets.databases` contains all five canonical adapters;
- all 35 stage cells pass;
- both baselines pass on all five adapters;
- `schemaEquivalence.fingerprintCount` is `1`;
- retries produce no duplicate mappings;
- rollback retains explanatory metadata while reverting the owned change;
- cleanup reports zero owned rows; and
- the commit does not change while the run is executing.

The evidence contains versions, counts, fingerprints, and sanitized
diagnostics only. It must never contain credentials, tokens, private
endpoints, raw identity claims, or customer identifiers.

## What the Lane Executes

The worker uses the canonical `runMigrations` path and the real
`EngineTenantMappingService` transaction. It proves the engine-tenancy schema
and service lifecycle against each adapter, including a deliberate failed
transaction and an idempotent retry. It also verifies the native-grant receipt
schema is equivalent after a clean install, both applicable upgrade paths, and
the `0098`/`0099` add/remove/retry sequence.

The lane intentionally does not run unrelated application seed catalogs.
Those have their own ownership and qualification scope. Therefore,
**100% database qualification here means 35/35 engine-tenancy lifecycle stage
cells, 10/10 supported-baseline observations, and one equivalent schema—not
100% of unrelated monorepo database behavior.**

## Stop, Roll Back, and Recover

Stop the release candidate when:

- any target or stage fails;
- clean install and either upgrade path produce different logical schemas;
- an interrupted retry duplicates state;
- the service result differs by adapter;
- rollback loses its reason or other explanatory metadata;
- cleanup leaves rows owned by the qualification fixture;
- evidence is dirty, stale, unsanitized, or from another commit; or
- the source commit changes during execution.

The runner removes containers on success and failure. If the process itself is
interrupted, remove any remaining qualification containers before retrying:

```bash
docker rm -f -v \
  eg-engine-tenancy-dbq-postgres \
  eg-engine-tenancy-dbq-mysql \
  eg-engine-tenancy-dbq-mssql \
  eg-engine-tenancy-dbq-oracle \
  eg-engine-tenancy-dbq-spanner
```

Database migration rollback must be reviewed together with the application
rollback. Do not repair engine topology, tenant ownership, mapping versions, or
resolution state by editing production columns directly.

## Release Handoff

After the full clean run:

1. run `pnpm run test:engine-tenancy:evidence-index`;
2. confirm the database gate points to the same commit as the authorization,
   browser, provisioning, source-coverage, mutation, documentation, and
   compatibility artifacts;
3. retain the aggregate artifact in CI; and
4. fail the release if
   `pnpm run test:engine-tenancy:release-evidence` reports the database
   artifact missing, dirty, stale, partial, or failed.

The dedicated `.github/workflows/engine-tenancy-database.yml` workflow runs on
relevant pull-request and `main` changes, on a weekly schedule, and by manual
dispatch. It retains both aggregate and per-adapter observations for 14 days.

See
[Test Engine Tenancy and Fine-Grained Access Control](./testing-engine-tenancy-and-access-control.md)
for the complete release evidence model.
