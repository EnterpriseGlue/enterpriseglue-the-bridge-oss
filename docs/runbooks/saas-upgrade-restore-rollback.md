---
doc_class: technical
audience: operator, architect, developer
publication: github
lifecycle: as-built
---

# SaaS upgrade, restore, and application rollback

Summary: Rehearse a populated v0.18.0 pooled-SaaS upgrade, previous-application startup, backup restore, and state verification.

Audience: Database operators, release engineers, platform architects, developers, and security reviewers.

## Purpose

Use this runbook to qualify a pooled-SaaS security upgrade from EnterpriseGlue
OSS v0.18.0 before applying the same procedure to a managed environment. It
tests four distinct recovery properties:

1. current migrations preserve populated tenant, SSO, and tenant-application state;
2. the historical TypeORM transport without explicit tenant context cannot read
   protected identities on the expanded schema using runtime credentials;
3. an upgraded backup, including runtime grants, can be restored into a clean
   database and pass current schema verification as the nonowning runtime; and
4. the previous v0.18.0 application starts after restoring the pre-upgrade backup.

The rehearsal is destructive only to disposable Docker containers and databases
created by the script. It does not connect to an existing EnterpriseGlue database.

## Prerequisites

- Docker with access to `ghcr.io/enterpriseglue/enterpriseglue-the-bridge-oss-backend:v0.18.0`;
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
7. builds current source, applies migrations with the owner, refreshes bounded
   runtime grants, and runs verify-only readiness as the runtime role;
8. verifies missing-context denial with the actual historical TypeORM transport;
9. captures an upgraded backup;
10. replaces the disposable database, restores as the migration owner with its
    runtime grants intact, and reruns current verify-only readiness as runtime;
11. asserts that all three qualification tenants, providers, and tenant
    application states survived; and
12. restores the pre-upgrade backup and requires the previous digest-pinned
    application to become ready on that historical schema.

The source-tag migration set is deliberately authoritative for baseline schema
creation. The published image is independently authoritative for previous-
application compatibility. Keeping these checks separate prevents a container's
embedded migration packaging from weakening the schema baseline while still
testing the exact artifact operators would roll back to.

## Evidence

Sanitized evidence is written under
`.artifacts/saas-upgrade-restore-rollback/` and retained by CI for 14 days. The
directory contains:

- the resolved baseline digest and final result in `summary.txt`;
- baseline, current-upgrade, and restored-database migration logs;
- v0.18.0 baseline and restored-rollback application logs;
- the historical transport's expanded-schema missing-context denial;
- the populated pre-upgrade backup;
- the current upgraded backup; and
- the preserved-state counts in `restored-state.csv`.

The fixtures use disposable values and opaque secret references. Do not adapt
the script to copy real identity-provider credentials into CI artifacts.

## Passing criteria

The lane passes only when:

- the baseline image resolves to a digest and both application starts report ready;
- current migrations apply without down migration or destructive reset;
- verify-only readiness passes with the nonowning runtime before and after restore;
- historical missing-context reads return no protected identity rows;
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
6. retain the previous immutable application and plugin digests for rollback;
7. prove a restore into a separate database or project; and
8. record the backup, migration, application, plugin, and verification digests
   in the deployment receipt.

The cloud deployment repository owns real GKE, Cloud SQL, Secret Manager,
certificate, DNS, workload identity, and regional failure qualification. It
must execute equivalent checks using the exact release artifacts; this local
lane does not claim cloud certification.

## Rollback boundary

This policy upgrade is not compatible with old applications that lack the
registered PostgreSQL context boundary. Do not run an old image on the expanded
schema, restore its owner credentials, disable RLS, or restore the old
missing-context policy fallback. A missing-context SELECT returning no rows is
not application readiness. The rehearsal never automatically runs down migrations.

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
