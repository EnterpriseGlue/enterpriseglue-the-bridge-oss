---
doc_class: technical
audience: [developer, maintainer, operator]
publication: github
lifecycle: as-built
---

# Oracle migration portability

Historical migration replay must resolve PostgreSQL column spellings against the
connected database and preserve rows when changing an existing column. This
reference describes the migration helpers, their capacity limits, and the
recovery contract for Oracle evidence widening.

## Bootstrap and historical replay

`run-migrations.ts` distinguishes a fresh schema from an existing schema that
needs historical migrations. A fresh schema can use the current baseline without
executing every historical DDL statement. A successful fresh install therefore
does not prove that historical replay works.

For example, migration 016 creates `sso_assignment_mappings`, which has no current
entity and may be absent from a partially populated database. Its former raw
`text` and `bigint` declarations cause Oracle `ORA-00902`. Oracle before 23 also
requires numeric storage for booleans. These are migration DDL defects; changing
`DATABASE_TYPE` or another environment variable cannot repair them.

The legacy epoch now constructs its tables and added columns through
`portableTable()` and `portableColumn()` in
`packages/shared/src/db/migrations/support/portable-columns.ts`. Migrations
096–103 retain their existing local dialect helpers. Migrations 114–123 already
use the plugin migration schema normalizer.

## Column types and capacity

The shared constructors project legacy column definitions as follows:

| Input | PostgreSQL | Oracle | MySQL | SQL Server | Spanner |
| --- | --- | --- | --- | --- | --- |
| `text`, indexed or primary/unique | `text` | `varchar2(191)` | `varchar(191)` | `nvarchar(191)` | `string(191)` |
| Other `text` | `text` | `varchar2(4000)` | `varchar(4000)` | `nvarchar(4000)` | `string(4096)` |
| `bigint` | `bigint` | `number(19,0)` | `bigint` | `bigint` | `int64` |
| `boolean` | `boolean` | `number(1,0)` | `boolean` | `bit` | `bool` |
| `integer` / `int` | unchanged | unchanged | unchanged | unchanged | `int64` |

`portableTable()` collects index and unique-constraint participants before
normalizing columns. `portableColumn()` accepts an explicit `indexed` context
when a separately added column participates in an index. Primary and unique
columns are bounded automatically.

A default value does **not** make a column an index key. In particular, defaults
such as `'{}'` and `'[]'` on SSO claims, groups, roles, and audit documents must
retain document capacity rather than the 191-character key bound.

The document mapping above is bounded on four databases. It does not represent
unlimited JSON or snapshot storage. Migrations that require larger documents must
choose their established large-document types explicitly, as migrations 098 and
100 do for native-grant evidence. New migrations must also account for adapter
limits on index width, defaults, and total row size.

Oracle `integer` is already valid. Mapping every historical integer to
`number(10,0)` would unnecessarily narrow its range. Boolean defaults are mapped
with their column type so numeric-boolean dialects receive numeric defaults.

## Preserve existing definitions during nullability changes

Constructors for **new** columns must not normalize a live column merely to
change its nullability. `setExistingColumnNullability()` reads and clones the live
`TableColumn`, changes only `isNullable`, and keeps its type, length, and other
attributes. `requireExistingColumn()` uses the same path to make a column
required.

This matters on Oracle and MySQL: TypeORM can implement a type or length change
by dropping and re-adding a column. On populated tables, that can either discard
values or fail while adding a required column. Migration 013 uses the helper for
legacy invitation aliases, 046 for role-assignment aliases, and 058 for deployment
project references. Canonical-key and principal-shape migrations use it when
tightening constraints.

For Oracle LOBs, the helper emits a nullability-only statement:

```sql
ALTER TABLE "table_name" MODIFY ("column_name" NOT NULL)
```

Restating the LOB type in that `MODIFY` can cause `ORA-22296`.

## Restart-safe Oracle evidence widening

Migration 100 changes legacy `VARCHAR2` native-grant evidence to CLOB without
using TypeORM's destructive type-change fallback:

1. Add a nullable `<column>_clob` staging column if needed.
2. Copy the original value into staging.
3. Drop the original column.
4. Rename staging to the final name.
5. Restore the canonical nullability: classifications are required; encrypted
   detailed snapshots are nullable.

Oracle DDL commits implicitly. Each step therefore checks the live schema rather
than depending on a transaction rollback. A retry after the original was dropped
finishes the rename. A retry after the rename still restores nullability even
though the final column is already CLOB. Repeating a completed widening preserves
both values and constraints.

The migration fails rather than inventing missing classification evidence if an
invalid nullable legacy table contains null classifications. Evidence widening
is intentionally one-way; automatic shrinking can destroy retained snapshots.

## Compatibility and operational boundaries

Existing migration identifiers are retained. Already-recorded migrations do not
run again, and this change cannot recover values lost by a previously completed
destructive migration. Preserve backups according to the normal database upgrade
procedure.

Historical replay must not bypass the schema-epoch ownership guard. A bootstrap
that runs `synchronize()` and pre-creates `release_effect_cohorts` is still refused
by migration 131. A synthetic replay that clears the ledger or removes that
relation is a diagnostic scenario, not proof that this refused bootstrap path is
supported.

Redeploying the previous application package does not shrink CLOBs or undo
nullability changes. Schema rollback remains unsupported for this migration set.

## Verification

The regression tests cover emitted MySQL nullability DDL, SSO document capacity
on all five dialects, and interruption after Oracle commits the CLOB rename:

```sh
pnpm --dir backend exec vitest run __tests__/shared/db --config vitest.config.ts --maxWorkers=1 --no-file-parallelism
pnpm run test:database-portability:unit
pnpm run test:engine-tenancy:database-matrix
pnpm run test:compiled-migration-upgrades
```

Physical database qualification, compiled PostgreSQL upgrades, and unit tests are
separate evidence. Retain run-specific logs and receipts in CI or release
artifacts, with the tested source revision, instead of committing them here.
