---
doc_class: technical
audience: operator, architect, developer
publication: github
lifecycle: as-built
---

# SaaS upgrade, restore, and application rollback

Summary: Rehearse a populated v0.18.0 pooled-SaaS upgrade through the exact published
0130 predecessor and bounded 0131 bridge, previous-application rollback,
backup restore, and state verification.

Audience: Database operators, release engineers, platform architects, developers, and security reviewers.

## Purpose

Use this runbook to qualify a pooled-SaaS security upgrade from EnterpriseGlue
OSS v0.18.0 before applying the same procedure to a managed environment. It
tests four distinct recovery properties:

1. the exact published 0130 predecessor and bounded 0131 owner transition
   preserve populated tenant, SSO, and tenant-application state;
2. current application startup stays verify-only under a distinct restricted
   runtime identity while the bridge installs its signed dual-context
   compatibility RLS policy;
3. an upgraded backup, including runtime grants, can be restored into a clean
   database and pass current schema verification as the nonowning runtime; and
4. the previous v0.18.0 application starts after restoring the pre-upgrade backup.

The rehearsal is destructive only to disposable Docker containers and databases
created by the script. It does not connect to an existing EnterpriseGlue database.

## Prerequisites

- Docker with access to the v0.18.0 backend and the digest-pinned v0.24.2
  schema-predecessor backend;
- Node.js 24 and pnpm 11.0.8-compatible dependencies installed;
- a checkout containing the exact `v0.18.0` Git tag; and
- enough local capacity to build the v0.18.0 backend and current backend.

CI checkout must use full release history (`fetch-depth: 0`) so the source tag
can be archived.

## Run the qualification

From the repository root:

```bash
pnpm run test:saas:qualification-contracts
pnpm run test:saas:upgrade-restore-rollback
```

To include pooled browser/plugin and multi-replica delivery qualification:

```bash
pnpm run test:saas:combined
```

The recovery script performs the following sequence:

1. pulls the v0.18.0 backend image and resolves it to an immutable repository digest;
2. archives and builds the exact v0.18.0 source tag to obtain its authoritative
   migration set;
3. creates the v0.18.0 schema with a non-superuser migration owner and creates a
   separate nonowning runtime role for the current application;
4. starts the digest-pinned v0.18.0 application and requires `/ready` to succeed;
5. seeds Alpha/OIDC, Bravo/SAML, and Charlie/LDAP tenant state, with Alpha and
   Bravo applications active and Charlie inactive;
6. captures a populated pre-upgrade backup;
7. verifies the published v0.24.2 image labels and its registered 132-entry
   inventory before any database mutation, applies and verifies that exact ledger
   through migration 1700000000130, then uses that predecessor to advance the
   populated database;
8. builds current source and invokes only `runSchemaEpochOwnerMigrations` with
   the owner, applying migration 1700000000131 while excluding 1700000000132;
9. runs current application migration readiness in verify mode as the runtime
   role under the exact pre-enforcement dual-context RLS profile;
10. restarts the exact v0.24.2 predecessor with
    `EG_DATABASE_STARTUP_MODE=verify`, requires readiness and a legacy tenant
    read, then reattests the unchanged four-policy dual profile; apply-mode
    predecessor overlap is rejected because it would recreate migration 0126's
    legacy policy;
11. captures an upgraded backup;
12. replaces the disposable database, restores as the migration owner with its
    runtime grants intact, and reruns current verify-only readiness as runtime;
13. asserts that all three qualification tenants, providers, and tenant
    application states survived; and
14. restores the pre-upgrade backup and requires the previous digest-pinned
    application to become ready on that historical schema.

The v0.18.0 source-tag migration set remains authoritative for baseline schema
creation, and its published image remains authoritative for previous-application
compatibility. The digest-pinned v0.24.2 image is separately authoritative for
the 0130 predecessor: its OCI revision/version labels and complete migration
inventory are checked before it can mutate the database. Current bridge code
never replays predecessor migrations or uses the generic application apply path.
On the populated v0.18.0 path, prerequisite assertions cover the historical
admin, default tenant, and login policy that release guarantees; legacy Git
providers remain valid preserved state. The fresh pooled harness starts from an
empty database and therefore additionally requires the published predecessor
bootstrap to create exactly four Git providers.

## Evidence

Sanitized evidence is written under
`.artifacts/saas-upgrade-restore-rollback/` and retained by CI for 14 days. The
directory contains:

- the resolved baseline digest and final result in `summary.txt`;
- baseline, published-predecessor, bounded current-upgrade, and restored-database
  migration logs;
- v0.18.0 baseline and restored-rollback application logs;
- the populated pre-upgrade backup;
- the current upgraded backup; and
- the preserved-state counts in `restored-state.csv`.

The fixtures use disposable values and opaque secret references. Do not adapt
the script to copy real identity-provider credentials into CI artifacts.

## Passing criteria

The lane passes only when:

- the baseline image resolves to a digest and both application starts report ready;
- the exact published predecessor registers and produces exactly the 132-entry 0130 ledger;
- the current owner entrypoint applies exactly the 0131 transition and never 0132;
- verify-only readiness passes with the nonowning runtime before and after restore;
- the digest-pinned v0.24.2 predecessor becomes ready at 0131 only in verify
  mode, reads its Alpha tenant provider, and leaves the exact dual policy intact;
- the signed pre-enforcement dual-context RLS profile remains exact and admits
  both legacy tenant context and current finite platform capabilities;
- the restore command fails on its first SQL error and creates objects as the
  migration owner while preserving runtime ACLs; and
- three qualification tenants, three segregated providers, two active tenant
  applications, one inactive tenant application, and the migration ledger are
  present after restore.

## Production adaptation

Before a managed rollout, replace the disposable fixtures with environment-
owned mechanisms while preserving the order:

1. quiesce or drain every old API and worker consuming the shared schema;
2. take and validate a provider-native database backup;
3. run migrations using a dedicated migration identity;
4. run application pods with verify-only startup and no DDL authority;
5. exercise representative tenants for every supported SSO profile and plugin state;
6. retain the previous immutable application and plugin digests for rollback,
   forcing any 0131 predecessor overlap to verify-only startup;
7. prove a restore into a separate database or project; and
8. record the backup, migration, application, plugin, and verification digests
   in the deployment receipt.

The cloud deployment repository owns real GKE, Cloud SQL, Secret Manager,
certificate, DNS, workload identity, and regional failure qualification. It
must execute equivalent checks using the exact release artifacts; this local
lane does not claim cloud certification.

The current managed Helm bridge intentionally accepts only an existing exact
0130 ledger; it does not execute the published predecessor bootstrap used by
this disposable fresh-database harness. Fresh or empty managed pooled shards
remain fail-closed and must not be enabled until a separate provider-owned,
digest-bound bootstrap packet is implemented and qualified.

Migration 0131 closes the functional overlap boundary without applying 0132:
it replaces the exact legacy source policy with the attested
`dual-context-compatibility/v1` predicates. The legacy predicate supports the
published predecessor while the finite explicit capability branches support
current global membership and audit operations. Qualification must prove both
routes and reject pure legacy policy at the 0131 ledger; owner credentials or a
tenancy-mode downgrade are never application workarounds.

## Rollback boundary

The bridge intentionally stops before the explicit-context enforcement policy.
It does not use migration 1700000000132 to manufacture a historical-runtime
denial result. Do not treat this pre-enforcement compatibility state as final
policy-cutover readiness, run old images on an unqualified expanded schema, or
restore owner credentials to an application. The rehearsal never edits the
TypeORM ledger or automatically runs down migrations.

Coordinate all schema consumers before policy enforcement. A blue/green default
switch alone is insufficient while retained tenant APIs or workers still use
the old runtime. Preserve tenant and data identities; previous runtime release
assignments may need a controlled upgrade. This local test does not implement
that deployment orchestration.

Use the pre-upgrade backup for database rollback. Restoring it discards all
writes made after the backup, so this is an operator-approved disaster-recovery
action, not an automatic deployment step. Preserve tenant SSO references,
tenant application state, plugin-owned storage, and audit evidence according to
the environment retention policy.
