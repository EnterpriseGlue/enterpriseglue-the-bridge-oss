# Oracle Migration Portability Analysis

**Subject:** `ORA-00902: invalid datatype` during database initialization
**Observed on:** `enterpriseglue-*-backend-oracle` v0.31.1 (Oracle thick-client configuration)
**Date:** 2026-10-15
**Verdict:** Code defect in the legacy migration epoch. **Not** a deployment or `.env` misconfiguration.
**Status:** Remediated in source — see §11. Verified against live Oracle XE 21c and PostgreSQL 18 (§12).

---

## 1. Summary

Migration `AddRbacFoundation1700000000016` fails on Oracle because it builds `CREATE TABLE`
DDL from hardcoded PostgreSQL-flavoured column types (`text`, `bigint`) instead of the
dialect-aware helpers that already exist in the codebase.

The failure is not universal — it only manifests when the historical migration epoch is
actually *replayed*, which depends on the state of the target schema at startup. Section 3
explains that mechanism, which is the reason Oracle appears to work in some environments
and not others.

Sections 1–10 are the original diagnosis. Section 6 carries a correction: the plugin
band (114–123) was miscounted as unguarded and is in fact already portable. Sections
11–13 record the fix that was applied, what remains unverified, and the follow-ups left
open.

---

## 2. The failing statement

```sql
CREATE TABLE "sso_assignment_mappings" (
  "id" text NOT NULL,
  "provider_id" text,
  ...
  "priority" integer DEFAULT 0 NOT NULL,
  "is_active" number(1,0) DEFAULT 1 NOT NULL,
  "created_at" bigint NOT NULL,
  "updated_at" bigint NOT NULL,
  CONSTRAINT "PK_25ca41a86bbd38830df17c3ee3e" PRIMARY KEY ("id")
)
```

Reported error metadata:

```
errorNum: 902
offset: 45
code: 'ORA-00902'
```

Offset 45 lands exactly on the `text` token following `"id"` — the first Oracle-invalid
datatype in the statement.

### 2.1 The Oracle dialect was correctly detected

This is the single most important observation for ruling out a configuration problem.

The column `"is_active" number(1,0)` is **valid Oracle syntax**. It was produced by
`legacyBooleanColumn()` in
`packages/shared/src/db/migrations/support/portable-columns.ts`, which branches on:

```ts
const oracle = migrationDatabase(queryRunner) === 'oracle';
```

Combined with the stack frames showing `OracleQueryRunner` and
`typeorm/driver/oracle/OracleQueryRunner.js`, this proves the Oracle driver was selected
and the runtime knows it is talking to Oracle. The surrounding columns are simply
hardcoded and never consulted the dialect.

No SQLite is involved anywhere. `text` / `bigint` are PostgreSQL spellings baked into the
migration source.

---

## 3. Why this fires for some Oracle deployments and not others

The decisive logic is in `packages/shared/src/db/run-migrations.ts` (~lines 759–791):

```ts
if (missingTables.length > 0) {
  console.log('  ℹ️  Database bootstrap required ... Running TypeORM synchronize().');
  await dataSource.synchronize();
  if (!hadCanonicalTableBeforeBootstrap) {
    // A fully empty database was created directly from the current entity model.
    await recordFreshMigrationBaseline(dataSource, queryRunner, dbType);
    initializedFreshSchema = true;
  }
}
```

With `hadCanonicalTableBeforeBootstrap` computed as:

```ts
let hadCanonicalTableBeforeBootstrap =
  missingTables.length < coreBootstrapEntities.length;
if (!hadCanonicalTableBeforeBootstrap && dataSource.entityMetadatas?.length) {
  // ...then scan every other entity metadata for an existing table
}
```

### Path A — completely empty schema (works)

All 10 core bootstrap entities missing **and** no other canonical table present.

1. `synchronize()` creates the whole schema from **entity metadata**, which the TypeORM
   Oracle driver types correctly (`varchar2`, `number`, etc.).
2. `recordFreshMigrationBaseline()` stamps the entire historical ledger as applied.
3. The broken legacy migrations **never execute**.

This is why Oracle support appears functional.

### Path B — partially populated schema (fails)

At least one core table missing, but some canonical table already exists.

1. `hadCanonicalTableBeforeBootstrap` is `true`.
2. The baseline is **skipped**.
3. TypeORM replays the historical epoch against the existing schema.
4. Execution reaches migration 016 and hits the hardcoded types.

**The reported failure is Path B.**

---

## 4. Why it died specifically on `sso_assignment_mappings`

Migration 016 resolves table names through this helper:

```ts
function tablePath(queryRunner: QueryRunner, metadataName: string, fallback: string): string {
  try {
    return queryRunner.connection.getMetadata(metadataName).tablePath;
  } catch {
    return fallback;
  }
}
```

A repository-wide search for `SsoAssignmentMapping` returns matches in **migration files
only** — 016, 017, 021, 039 and 043. There is no entity class.

The consequences compound:

1. `getMetadata('SsoAssignmentMapping')` always throws, so the literal fallback
   `'sso_assignment_mappings'` is used.
2. Because there is no entity, `synchronize()` never creates this table — not even on
   Path A.
3. Therefore `createTableIfMissing()` **always** attempts the `CREATE TABLE`.
4. That DDL is assembled from hardcoded `text` / `bigint` → `ORA-00902`.

### Why migrations 001–015 passed first

Those migrations target **entity-backed** tables. On Path B those tables already existed,
so `createTableIfMissing()` / `addColumnIfMissing()` short-circuited before emitting any
DDL — despite containing the same unsafe hardcoded types.

`sso_assignment_mappings` is simply the first *orphaned* (non-entity-backed) table in
migration order. It is a latent landmine for every database, and Oracle is where it
detonates.

---

## 5. Which datatypes are actually invalid on Oracle

| Type in migrations | Oracle validity | Notes |
| --- | --- | --- |
| `text` | **Invalid** | No such datatype. Primary offender. |
| `bigint` | **Invalid** | No such datatype. |
| `boolean` | **Conditional** | Valid only on Oracle 23ai+. `portable-columns.ts` explicitly references "pre-23 Oracle booleans". |
| `integer` | **Valid** | ANSI type, maps to `NUMBER(38)`. Not a problem. |

Note that `"priority" integer DEFAULT 0 NOT NULL` in the failing statement was never a
defect — only `text` and `bigint` need remediation, plus `boolean` depending on the target
Oracle version.

---

## 6. Inventory of Oracle-unsafe migrations

Scanned directory: `packages/shared/src/db/migrations/`
Detection: literal occurrences of `type: 'text'`, `type: 'bigint'`, `type: 'boolean'`.

### Band 000–034

Offending files: **000, 001, 002, 003, 005, 009, 010, 011, 012, 013, 014, 015, 016, 017,
018, 019, 020, 021, 022, 023, 024, 025, 026, 027, 028, 029, 030, 031, 032, 033, 034**

| Migration | `text` | `bigint` |
| --- | --- | --- |
| 016 `add-rbac-foundation` | 41 | 11 |
| 025 `add-engine-sets` | 21 | 6 |
| 030 `add-external-engine-systems` | 16 | 2 |
| 023 `add-authz-groups` | 15 | 5 |
| 011 `add-invitations` | 15 | 7 |
| 012 `repair-invitations-legacy-schema` | 14 | 7 |
| 013 `cleanup-legacy-invitations-schema` | 14 | 7 |

### Band 037–058

Offending files: **037, 038, 039, 042, 044, 045, 046, 047, 048, 049, 050, 051, 052, 053,
054, 055, 056, 057, 058**

| Migration | `text` | `bigint` |
| --- | --- | --- |
| 037 `add-sso-sync-diagnostics` | 22 | 3 |
| 055 `add-runtime-resource-inventory` | 21 | 6 |
| 042 `add-sso-engine-access-snapshots-and-access-authority` | 17 | 5 |
| 038 `add-sso-normalized-identities` | 16 | 4 |
| 054 `add-runtime-resource-sets` | 13 | 2 |
| 057 `add-identity-reconciliation-and-deployment-receipts` | 13 | 4 |

### Band 061–091

Offending files: **061, 062, 063, 064, 066, 067, 068, 069, 070, 071, 074, 077, 078, 079,
080, 084, 085, 086, 088, 091**

### Band 112–123 — plugin platform (literal counts only; see correction below)

Offending files: **112, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123**

| Migration | `text` | `bigint` | `boolean` |
| --- | --- | --- | --- |
| 123 `add-plugin-manager` | 44 | 17 | 1 |
| 114 `add-plugin-platform` | 41 | 16 | 6 |
| 118 `add-plugin-notifications-and-schedules` | 28 | 7 | 0 |
| 117 `add-plugin-events` | 19 | 7 | 1 |
| 120 `add-plugin-gateway-admission` | 12 | 7 | 0 |
| 116 `add-plugin-storage` | 8 | 4 | 0 |
| 122 `add-plugin-contribution-availability` | 8 | 8 | 0 |
| 119 `add-plugin-emergency-control` | 5 | 4 | 2 |
| 115 `add-plugin-broker-replay` | 5 | 2 | 0 |
| 121 `add-plugin-event-circuit` | 3 | 1 | 0 |
| 112 `add-federated-session-lineage` | 3 | 0 | 0 |

#### Correction — this band is not actually unguarded

The "zero Oracle guards" characterisation above is an artefact of the detection method.
A literal scan for `type: 'text'` cannot see a normalisation layer applied at runtime,
and this band has one.

Migrations **114–123** build their tables through `pluginMigrationTable()` from
`packages/shared/src/db/migrations/plugin-migration-schema.ts`, which rewrites column
options before the `Table` is constructed:

```ts
function normalizeOracleColumn(column, context) {
  if (column.type === 'boolean') return { ...column, type: 'number', precision: 1, scale: 0, ... };
  if (column.type === 'bigint')  return { ...column, type: 'number', precision: 19, scale: 0 };
  if (column.type !== 'text') return column;
  const requiresBoundedKey = column.isPrimary || column.isUnique || context.indexed || column.default !== undefined;
  if (requiresBoundedKey) return { ...column, type: 'varchar2', length: String(pluginKeyColumnLength(column.name)) };
  ...
}
```

So the PostgreSQL spellings in those files are *inputs to a translator*, not emitted DDL.
The band is Oracle-safe — and additionally Spanner-, MySQL- and SQL Server-safe, which
none of the legacy epoch was.

Migration **112** does not import the normaliser and was genuinely affected.

Revised totals: of the 89 files containing offending literals, **10 were already correct**
(114–123) and **79 required remediation**.

This also makes the band the opposite of the "worst cluster" — it is the reference
implementation. §11 generalises it.

### Already Oracle-aware

- **096–103** — each defines its own *local* dialect helpers, e.g.
  `if (database === 'oracle') return { type: 'varchar2', length: '4000' };`
- **059, 060, 075, 076, 087** — contain Oracle or portable-helper guards.
- **079** — partially guarded; still contains unguarded offending types.
- `oracle/1700000000134-expand-oracle-assignment-keys.ts` — Oracle-only by design.

---

## 7. Architectural observation

`packages/shared/src/db/migrations/support/portable-columns.ts` already provides exactly
the abstractions needed:

```ts
export function portableText(queryRunner, size)    // oracle → varchar2 / clob
export function portableBigint(queryRunner)        // oracle → number(19,0)
export function portableInteger(queryRunner)       // oracle → number(10,0)
export function portableBoolean(queryRunner)       // oracle → number(1,0)
```

Two inconsistencies undermine them:

1. **Under-adoption.** Across roughly 90 legacy migrations the module is used almost
   exclusively for booleans, via `legacyBooleanColumn()`. `portableText()` and
   `portableBigint()` are barely wired in — which is precisely why migration 016 produced
   a correct `number(1,0)` next to a dozen broken `text` columns.
2. **Duplication.** Migrations 096–103 reimplemented local copies of the same Oracle
   branches instead of importing the shared helpers, so the fix has drifted rather than
   propagated.

---

## 8. Configuration assessment

**No `.env` change resolves this.**

- `DATABASE_TYPE=oracle` is already taking full effect (see §2.1).
- There is no SQLite-to-Oracle switch to flip; the offending types are compile-time
  literals in migration source.
- No environment variable alters the DDL emitted by `createTableIfMissing()`.

The only non-code lever is **schema state, not configuration**: starting against a
genuinely empty Oracle schema routes initialization down Path A (§3), where the broken
epoch is skipped entirely.

---

## 9. Options

| Option | Applicability | Assessment |
| --- | --- | --- |
| Recreate the Oracle schema empty | Non-production / disposable data | Fastest route to a working stack. Takes Path A. Also worth establishing what left the schema partially populated. |
| Pre-create orphaned tables manually with correct Oracle types (`varchar2`, `number(19,0)`) | Any | `createTableIfMissing()` will then skip them — but must be repeated for every affected table across ~90 migrations. Fragile. |
| Convert migrations to the portable helpers | Any | The actual fix. Must cover the full inventory in §6, not migration 016 alone. **Taken — see §11.** |
| Pin to an image predating these migrations | If such a tag exists | Avoidance only. |

Fixing migration 016 in isolation does **not** resolve the problem — it advances the
failure to the next orphaned table in the inventory.

---

## 10. Reproduction conditions

1. Oracle target (thick client), `DATABASE_TYPE=oracle`.
2. A schema that is **not** empty: at least one canonical table present while one or more
   of the 10 core bootstrap entities are absent.
3. Start the backend so `runDatabaseInitialization()` executes in `apply` mode.
4. Initialization takes Path B, replays the historical epoch and aborts at
   `AddRbacFoundation1700000000016` with `ORA-00902`.

---

## 11. Remediation applied

Option 3 from §9 was taken: the legacy epoch now resolves its column types against the
connected dialect. The approach follows the plugin band (§6 correction) rather than
rewriting every column literal, because a normalisation layer is both smaller and harder
to regress — a future migration that pastes `type: 'text'` is corrected automatically
instead of reintroducing the defect.

### 11.1 Shared normalisers

`support/portable-columns.ts` gained two constructors built on the existing helpers:

```ts
export function portableTable(queryRunner: QueryRunner, options: TableOptions): Table
export function portableColumn(queryRunner: QueryRunner, options: TableColumnOptions, context?): TableColumn
```

Both route column options through a single `normalizePortableColumn()`:

| Input | Oracle | MySQL | SQL Server | Spanner | PostgreSQL |
| --- | --- | --- | --- | --- | --- |
| `text` (key) | `varchar2(191)` | `varchar(191)` | `nvarchar(191)` | `string(191)` | `text` |
| `text` (non-key) | `varchar2(4000)` | `varchar(4000)` | `nvarchar(4000)` | `string(4096)` | `text` |
| `bigint` | `number(19,0)` | `bigint` | `bigint` | `int64` | `bigint` |
| `boolean` | `number(1,0)` | `boolean` | `bit` | `bool` | `boolean` |
| `integer` | *unchanged* | *unchanged* | *unchanged* | `int64` | *unchanged* |

Boolean defaults are projected alongside the type, so `default: true` becomes `1` on
Oracle and SQL Server.

`integer` is deliberately left alone outside Spanner, per §5. Routing it through
`portableInteger()` would have narrowed Oracle columns from `NUMBER(38)` to `NUMBER(10,0)`
— a silent range reduction with no defect to justify it.

### 11.2 Why text columns are bounded

The key/non-key split is not cosmetic. Oracle caps an index key at roughly 6398 bytes on
an 8K block, so `uq_role_assignments_identity` in migration 016 — six text columns in one
unique constraint — fails with `ORA-01450` if each is widened to `varchar2(4000)`, even
though the `CREATE TABLE` itself would succeed.

`portableTable()` therefore collects column names from both `indices` *and* `uniques`
before normalising, and bounds any text column that is a primary key, is unique, is
indexed, or carries a default. 191 characters matches the convention already established
by migrations 096–103. Where a wider key is genuinely required, the existing
`oracle/1700000000134-expand-oracle-assignment-keys.ts` pattern applies — widen
deliberately, in an Oracle-only migration, rather than by default.

### 11.3 Call sites converted

Across the 79 affected migrations:

- `new Table({ ... })` → `portableTable(queryRunner, { ... })`
- `new TableColumn({ ... })` → `portableColumn(queryRunner, { ... })`

Applied mechanically, resolving the `QueryRunner` identifier from the nearest enclosing
parameter at each site (394 sites use `queryRunner`, one helper uses `q`). Imports were
added and now-unused `typeorm` value imports pruned; type-position uses of `Table` and
`TableColumn` were retained.

Migrations 096–103 were left on their local helpers. They are already correct, and the
duplication noted in §7 is a tidiness concern, not a defect — folding them in would add
churn to the same change set that fixes the outage.

### 11.4 Effect on the reported failure

On Path B, migration 016 now emits:

```sql
CREATE TABLE "sso_assignment_mappings" (
  "id" varchar2(191) NOT NULL,
  "provider_id" varchar2(4000),
  ...
  "priority" integer DEFAULT 0 NOT NULL,
  "is_active" number(1,0) DEFAULT 1 NOT NULL,
  "created_at" number(19,0) NOT NULL,
  "updated_at" number(19,0) NOT NULL,
  CONSTRAINT "PK_..." PRIMARY KEY ("id")
)
```

Because the whole §6 inventory was covered, the failure does not advance to the next
orphaned table, which was the stated failure mode of a migration-016-only fix.

### 11.5 Blast radius on other dialects

Existing PostgreSQL schemas are unaffected: `portableText()` and `portableBigint()` return
the original spellings there, so the emitted DDL is byte-identical.

MySQL, SQL Server and Spanner do change — unbounded `text` becomes bounded `varchar` /
`nvarchar` / `string`. In practice the exposure is small, because the guards described in
§4 mean these migrations only emit DDL for tables and columns that are *missing*. On an
established schema that is limited to the orphaned tables; on an empty schema Path A
skips the epoch entirely. The dialects where this changes behaviour are also the dialects
where the previous behaviour could not have worked for key columns.

---

## 12. Verification status

| Check | Result |
| --- | --- |
| All 136 migration files parse | Pass (`node --experimental-strip-types --check`) |
| No unused or missing imports after conversion | Pass |
| No offending literal left outside a normaliser | Pass — remaining matches are local helper bodies in 096–103 and normalised inputs in 114–123 |
| `tsc` build of `@enterpriseglue/shared` | Pass |
| Backend unit tests | Pass — 3860/3860, including all 331 in `__tests__/shared/db` |
| Live Oracle (XE 21c): fresh schema, then rerun | Pass — baseline path, 136/136 recorded, rerun is a no-op |
| Live Oracle: full epoch replay over a populated schema | Pass — 136/136 executed |
| Live PostgreSQL (18): fresh, rerun and full replay | Pass — 135/135 (134 is Oracle-only) |
| Path B (synchronize, then replay) on either dialect | Stops at 131 — see §12.2 |

The replay scenario clears the migration ledger of a seeded database, drops
`release_effect_cohorts`, and relaxes the NOT NULL columns that 045, 050, 077–079 and 084
tighten, so those migrations really alter populated tables.

### 12.1 Changing nullability on populated tables (ORA-01758 and silent data loss)

Once the datatype fixes were in place, the replay stopped at
`RequireCanonicalRoleAssignmentShape1700000000084`:

```
ALTER TABLE "role_assignments" ADD "principal_type" varchar2(4000) NOT NULL
ORA-01758: table must be empty to add mandatory (NOT NULL) column
```

The migration tightened the columns by passing a freshly built `portableColumn(... type: 'text')`
to `changeColumn()`. On Oracle that produces `varchar2(4000)`, while the live column is
`varchar2(191)`. TypeORM's `OracleQueryRunner.changeColumn()` drops and re-adds a column
whenever type or length differ, and re-adding a NOT NULL column fails on a populated table.

The same pattern was used to *relax* NOT NULL in 046 (`role_assignments.user_id`) and 058
(`project_id` on `engine_deployments` and `engine_deployment_artifacts`). There it is worse,
because re-adding a nullable column succeeds and silently empties it. Against a live Oracle
table holding `project_id = 'project-a'`, the old 058 code emitted
`DROP COLUMN "project_id"` followed by `ADD "project_id" varchar2(255)` and left `null` behind.

`support/portable-columns.ts` now has `setExistingColumnNullability()`, which clones the live
column and changes only nullability. `requireExistingColumn()` delegates to it. Migrations
045, 050, 077–079 and 084 tighten through it, and 046 and 058 relax through it. Oracle gets
`MODIFY "col" varchar2(191) [NOT] NULL` and PostgreSQL gets
`ALTER COLUMN ... SET/DROP NOT NULL`, with the data intact.

### 12.2 Migrations 096–103 restored to their local helpers

The bulk conversion had also wrapped 096–103 in `portableTable()` / `portableColumn()`,
contrary to §11.3. Their column types were already dialect-correct, so on Oracle and
PostgreSQL the wrapping did nothing. On MySQL it was a regression: 098 deliberately uses
`text` for document columns, and the wrapper would have narrowed them to `varchar(4000)`.
It also broke the tests that cover these migrations with stubs that have no `connection`. These
eight files are back to their pre-conversion content.

### 12.3 Path B stops at migration 131 on every dialect

When `synchronize()` runs before the replay (§3, Path B), it creates
`release_effect_cohorts` from the entity model. Migration 131 deliberately refuses a
pre-existing relation (`Schema-epoch owner transition refuses a pre-existing
release_effect_cohorts relation`). Migrations 000–130 replay cleanly on Oracle and PostgreSQL
before that point. This is the schema-epoch guard working as designed, not a portability
defect, so it is left unchanged here (see §13).

---

## 13. Follow-ups not addressed here

1. **Orphaned tables.** `sso_assignment_mappings` still has no entity class (§4), so
   `synchronize()` never creates it and `createTableIfMissing()` always attempts the DDL.
   The datatype defect is fixed; the structural oddity is not. Either add the entity or
   document the table as migration-owned by design.
2. **How the schema became partial.** §3 Path B requires a canonical table present while
   core bootstrap entities are absent. Establishing what produced that state is worth
   doing independently of this fix.
3. **Helper duplication.** Migrations 096–103 still carry local copies of the dialect
   branches (§7). Safe to consolidate onto the shared module in a separate change.
4. **Path B and migration 131.** A Path B bootstrap always stops at 131 (§12.3), on any
   dialect. Whether 131 should accept a relation whose shape matches
   `expectedReleaseEffectCohortTable()` is a schema-epoch policy decision.
5. **Migration 100 on Oracle.** `WidenCamundaNativeGrantEvidence1700000000100` changes
   `varchar2(4000)` evidence columns to `clob` through `changeColumn()`. On Oracle that is a drop
   and re-add, so existing import evidence is lost. Oracle cannot `MODIFY` a `varchar2` to a
   `clob`, so a safe fix needs an add-copy-drop-rename sequence. Not done here.
6. **Oracle key widths.** 191 characters is a conservative default. Columns that legitimately
   need more should follow the Oracle-only widening pattern rather than raising the default.

---

## Appendix — evidence trail

| Claim | Source |
| --- | --- |
| Oracle dialect correctly detected | `"is_active" number(1,0)` in the failing DDL; `legacyBooleanColumn()` in `support/portable-columns.ts`; `OracleQueryRunner` stack frames |
| Error located on first `text` token | `offset: 45` in the driver error payload |
| Baseline-vs-replay branch | `run-migrations.ts` ~lines 759–791 |
| `SsoAssignmentMapping` has no entity | Repository search returns migration files only (016, 017, 021, 039, 043) |
| Migration inventory and type counts | Literal scans for `type: 'text'`, `type: 'bigint'`, `type: 'boolean'` across `packages/shared/src/db/migrations/` |
| 114–123 already normalised | `pluginMigrationTable` imported by all ten; `normalizeOracleColumn()` in `plugin-migration-schema.ts` |
| Oracle index key limit | `uq_role_assignments_identity` spans six text columns in migration 016 |
| 191-character key convention | `if (database === 'oracle') return { type: 'varchar2', length: length === 'key' ? '191' : '4000' };` in migrations 096, 098, 101 |

### Caveat on the §6 inventory

The counts in §6 are literal-occurrence counts. They measure how many PostgreSQL-flavoured
spellings appear in source, not how many reach the database. A file can score high and be
entirely safe (114, 123) or score low and be broken (112). Treat the table as a map of
where to look, not as a severity ranking — the 112–123 misreading came from doing the
latter.
