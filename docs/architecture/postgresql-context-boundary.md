---
doc_class: technical
audience: architect, developer, operator
publication: github
lifecycle: as-built
---

# PostgreSQL execution-context boundary

PostgreSQL pooled tenancy uses explicit server-owned execution context for every
TypeORM query. Missing context is denied; a missing setting is never interpreted
as single-tenant mode. This contract applies to the managed FORCE-RLS table
inventory in `packages/shared/src/db/tenant-ownership-inventory.ts`.

## Connection and query lifetime

`PostgresAdapter` registers `TenantRlsSubscriber`, and the shared data source
installs `installPostgresContextBoundary` before initialization. Initialization
fails if the registered assertion subscriber or the outer boundary is missing.
Applications must use this data source rather than construct an unguarded runner.

The outer boundary serializes each runner's queries, installs the canonical
tenant and active platform capability, and clears all context before releasing
the query gate. It covers errors from SQL and other TypeORM query subscribers.
A failed transaction is rolled back or recovered to its savepoint before context
cleanup; an unrecoverable connection is evicted from the PostgreSQL pool using
the actual driver release-with-error path, not returned for another request.
Runner release waits for queued operations and rejects subsequent use.
After a transaction fails, only full rollback or rollback to a savepoint is
allowed. In particular, an attempted commit rethrows the original SQL failure:
PostgreSQL's implicit rollback of an aborted `COMMIT` must not be reported as
a successful TypeORM transaction when application code swallowed its last error.

Transaction setup does not insert a `SELECT` between `BEGIN` and `SET TRANSACTION
ISOLATION LEVEL`. Nested savepoints, `SERIALIZABLE`, and `REPEATABLE READ` retain
their PostgreSQL semantics. Single-mode queries explicitly install `single`;
they do not depend on a permissive missing-context policy.

This wrapper depends on TypeORM 0.3.31's PostgreSQL runner lifecycle. Its
`beforeQuery` broadcast is outside its SQL try/finally, subscribers are awaited
concurrently, transaction flags change after query completion, and `stream()`
bypasses query subscribers. A TypeORM upgrade must run the connection-error,
transaction, stream, registration, and pool-reuse tests before acceptance.

Pooled streaming is explicitly unsupported and throws before executing SQL.
Single-mode stream lifetime is guarded through completion, close, and error,
but the host does not add `pg-query-stream`: without that optional dependency,
TypeORM's existing missing-package error is preserved. This change does not
claim that the host ships an operational streaming API.

## Tenant context and finite platform authority

Ordinary tenant work uses the canonical, active tenant resolved by the server.
Neither unsigned headers nor request payloads select a database capability.
The platform capability API is internal, finite, and revocable: after its owning
callback settles, deferred work that inherited asynchronous local storage no
longer has that authority.

Global rows do not receive a general `tenant_id IS NULL` exception. Separate
command-specific policies allow only the bound operation:

- Direct-provider discovery and lookup are read-only. Login identity writes are
  bound to the provider and cryptographically verified subject, then the resolved
  account. Login diagnostic runs and events are bound to the server's run ID.
- Session trust checks are bound to the verified session account and provider.
  Authenticated authorization reads expose only that user's memberships in the
  finite built-in system groups, including valid manual or identity assignments.
- Provider-only additive bootstrap binds configured provider keys and bundle
  provenance. Apply and replay receipts remain in the same finite lease. Hash,
  platform scope, and secret-reference preflight validation happen before entry.
- System group and membership seeds bind exact built-in rows. Manual
  administrator grants and revocations are distinct operations, scoped to the
  already-authorized target user. Password-verified recovery claims bind an
  existing membership snapshot and permit only the unchanged claim row.
- Deactivation removes only that user's authenticated baseline, after the same
  transaction persists and locks the canonical inactive user. It cannot remove
  other system or administrator memberships or revoke an active user's baseline.
- Audit insertion binds one server-generated row ID; it does not authorize
  reading the global audit catalog.

These scopes do not replace service authorization, protocol verification, or
input validation. They constrain the persistence needed after those checks.
They are not a general platform-administration or global scheduler interface.

Pooled background work discovers active canonical tenants before querying
tenant-owned RLS queues or resources. A tenant lease spans claim, work, retry,
and receipt updates. Explicit global/null scheduler work is unavailable rather
than reported as a successful empty scan. Provider-only bootstrap rejects an
unexpected global identity/runtime continuation instead of silently treating a
hidden queue as drained. Existing single-mode queue behavior is unchanged.

Git provider defaults belong to the existing active canonical `tenant-default`,
consistent with the tenant backfill migration; startup does not invent a new
tenant or create unrestricted global defaults.

Shared-engine readiness is a successful reconciliation snapshot, not perpetual
authority. Publication locks and rechecks the engine, tenant lifecycle and
mapping cohort; partial reconciliation, changed mappings and lost attempt
ownership cannot publish ready. Later lifecycle changes do not yet invalidate
this cached snapshot automatically. Request-time tenant authorization remains
independent and unchanged.

## Migration identity and runtime identity

Pooled migration apply uses the existing dedicated schema-owner transport.
Before the lease is issued, PostgreSQL must confirm the connected role owns the
schema and its relations. If a runtime role is configured for grant refresh,
it must be restricted, nonowning, and have no memberships. No request switches
credentials, sets a migration role, disables RLS, or falls back to owner access.

Pending historical migrations can require DML against already forced tables.
The transport temporarily adds `eg_migration_execution` only to existing managed
FORCE-RLS relations. Its predicate checks both the finite lease and PostgreSQL's
actual schema owner. A restricted runtime role cannot obtain this branch by
spoofing a custom setting. Cleanup uses relation OIDs so renamed relations are
handled and dropped relations are skipped; all captured relations are attempted
even after an individual cleanup failure. The lease is revoked before cleanup.

The one-time pooled legacy local-role projection runs inside this verified
migration apply boundary and records its durable completion marker. Runtime
startup verifies the marker; denied or empty runtime scans cannot create it.
Single-mode startup retains its existing projection path.

Pooled API and worker verify-only startup independently rejects superusers,
`BYPASSRLS`, privileged role attributes, ownership, role memberships, and database
or schema creation privileges. Configuring the owner as the application identity
is not accepted, even if the migration job's optional runtime-role setting is
absent.

Readiness requires exactly the four expected command policies per managed
table, with ENABLE and FORCE RLS. A stale legacy policy, additional permissive
policy, or same-name broadened `USING`/`WITH CHECK` predicate is rejected.
After creating each canonical policy, the migration owner writes a policy
comment attestation binding schema, table, command, canonical builder source and
PostgreSQL's deparsed canonical expressions. Runtime verification compares those
bindings with current catalog contents. Missing, malformed or source-stale
attestations fail closed; the owner migration/critical repair must reapply the
canonical policies. Catalog normalization is captured on the server that creates
the policy, not hardcoded to one PostgreSQL version. A single guarded catalogue
statement temporarily uses `pg_catalog` as its search path and restores the
caller's path before returning, including an empty result. Deparsed expressions
contain no relation OIDs and retain their identity across same-version dump and
restore. Cross-major restoration requires independent qualification.
This is owner-controlled drift evidence, not a signature or a defense against
a schema owner who rewrites both a predicate and its attestation.
Only an active, independently owner-bound
migration verification can temporarily account for `eg_migration_execution`;
ordinary runtime verification cannot accept it.

## Coordinated upgrade and rollback

The independently signed, dual-role schema-epoch bridge used for a retained
runtime cutover is specified in
[PostgreSQL schema-epoch compatibility bridge](postgresql-schema-epoch-compatibility-bridge.md).
It does not weaken the explicit-context policy or authorize a migration-ledger
edit.

Migration `1700000000132` enforces the explicit-context policy. All API, worker,
and retained-release consumers of the shared schema must be upgraded or drained
together before enforcement. An old application does not install the new
context, and must not be left serving traffic or running startup migration
repair against this schema. Do not add a missing-context bypass to permit an
uncoordinated mixed-version deployment.

Tenant, organization, and business data IDs must be preserved. Release placement
changes, when needed to retire old schema consumers, use the controlled release
lifecycle; this requirement does not authorize direct assignment edits or
fabricated readiness observations. There is no PostgreSQL down migration that
restores the permissive policy.

Rollback requires the rehearsed pre-upgrade backup and compatible old runtime,
not merely pointing an old image at the protected expanded schema. Restoring a
pre-upgrade backup loses writes made after that backup. See the
[upgrade/restore/rollback runbook](../runbooks/saas-upgrade-restore-rollback.md)
for the executable qualification and restore boundaries.

## Verification

The existing PostgreSQL native-tenancy lane includes
`postgres-context-boundary.test.ts`, `postgres-global-identity.test.ts`, and
`postgres-shared-inventory-readiness.test.ts`.
Run it with the repository's supported Node and pnpm versions:

```sh
bash scripts/run-native-tenancy-postgres-rls.sh
```

It uses an owned disposable PostgreSQL 16 container. The tests exercise the
installed adapter and actual forced policies with a restricted role, including
tenant isolation, query/hook failures, pool reuse, owner migration leases,
real signed OIDC protocol verification, callback/session persistence, bootstrap
receipt replay, scoped administrator behavior, and shared-engine publication
under actual engine/tenant row-lock contention. OIDC issuer responses are
provided by a local test fixture; these tests do not prove a deployed external
provider's client registration or a real user's consent journey.

The separate historical qualification exercises populated upgrade and actual
backup restoration. PostgreSQL checks do not constitute portability acceptance
for another supported database, nor browser or live-provider acceptance.
