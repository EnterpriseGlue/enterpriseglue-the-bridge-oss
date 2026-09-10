---
doc_class: technical
audience: architect, developer, operator
publication: github
lifecycle: as-built
---

# PostgreSQL managed-shard bootstrap

Fresh managed PostgreSQL shards use a dedicated, signed, one-shot bootstrap
image. The image produces the exact v0.24.2 schema and seed state through
migration `1700000000130`; the separately signed schema-epoch owner job can
then apply the normal 0130-to-0131 bridge. This closes the fresh-shard gap
without weakening the upgrade bridge or replaying an unsupported historical
migration sequence.

The bootstrap is an OSS host artifact. It contains no plugin-specific behavior
and has no dependency on the retired standalone EE repository.

## Immutable contract

`infra/database/managed-shard-bootstrap-manifest.json` binds the bootstrap to:

- the exact v0.24.2 predecessor backend image digest and source revision;
- the exact ordered 132-entry TypeORM migration inventory through 0130;
- the SHA-256 of the deterministic TypeORM schema-builder query plan;
- migration 0126 as the sole supplemental migration needed to install the
  released legacy FORCE-RLS policy profile;
- the source digest of the bootstrap contract and runner;
- PostgreSQL pooled tenancy as the target, with the predecessor's single-mode
  seed path as the bounded execution context;
- the exact relation, owner, policy, grant, default-privilege and seed
  postconditions; and
- a 4 KiB, secret-free receipt schema.

The release candidate contains the manifest as an inventoried metadata file and
records the bootstrap image as an immutable, signed OCI subject. Candidate
qualification builds both `linux/amd64` and `linux/arm64`, verifies OCI source,
revision and version labels, exercises the exact digest against real
PostgreSQL, scans it, signs it and attests provenance. Release publication
promotes that same digest; it does not rebuild the bootstrap image.

The bootstrap image is intentionally fixed to
`ghcr.io/enterpriseglue/enterpriseglue-managed-shard-bootstrap`. Deployments
must consume the digest from a verified candidate receipt. A mutable tag is not
an authorization to bootstrap a shard.

## Starting-state classifier

The runner obtains the manifest-defined, database-local PostgreSQL advisory
lock keyed to the target schema before reading or changing shard state. The
operator-supplied receipt identifier cannot select a different lock. The runner
accepts only:

1. an absent schema, or an existing schema with no supported relation, policy
   or migration-ledger object; or
2. the exact populated 0130 ledger and every exact 0130 postcondition.

It rejects an empty ledger beside objects, a partial or different ledger,
unexpected tables, sequences, indexes, columns, constraints, views, foreign
tables, materialized views or policies, reserved later-epoch objects
such as `release_effect_cohorts`, an
incorrect owner, policy drift, grant drift, seed drift and any extra seed row.
An exact existing 0130 shard is verified without reseeding and returns a
`verified-existing` receipt.

A bootstrap attempt that exits without a qualified receipt is not repairable by
this runner. Quarantine and recreate that new shard from the provider-owned
pristine boundary; never edit or baseline its ledger by hand.

Historical migrations cannot be treated as a fresh-database bootstrap path:
the published sequence includes compatibility migrations for installations
that predate the current entity inventory. In particular, the legacy migration
series is not a deterministic empty-database constructor. The bootstrap instead
hashes and executes the predecessor image's TypeORM schema-builder query plan,
executes only the explicitly bound RLS supplement, and asks the exact
predecessor TypeORM `MigrationExecutor` to fake-record the represented migration
inventory in the same transaction.
It never calls `synchronize`, writes migration-ledger rows directly or invokes
the generic migration orchestrator.

## Exact postcondition

Before a qualified receipt is written, the runner verifies:

- exactly the predecessor entity tables, TypeORM ledger and table-owned
  sequences, all owned by the restricted migration identity;
- before any schema or seed mutation, a login-capable but non-inheriting owner
  that owns the database and a distinct, login-capable, non-inheriting runtime
  role; neither role may have memberships or privileged PostgreSQL attributes;
- one exact `eg_tenant_isolation` FORCE-RLS policy on every released
  tenant-scoped table and no other policy;
- exact owner/runtime ACLs on every table and sequence, no other grantee or
  grant option, no column ACL at all, and exact future-object defaults of
  SELECT only for the restricted runtime login;
- one default tenant and login policy;
- one active local bootstrap administrator whose email is supplied explicitly
  and validated before connecting to PostgreSQL, and whose bcrypt hash verifies
  against the supplied `ADMIN_PASSWORD` without recording either value;
- exact platform settings, email-template, RBAC permission, system-role,
  role-permission and one-time authorization-projection catalogues;
- the eight exact system authorization groups and their exact platform-role
  assignments;
- the administrator's authenticated-user and platform-administrator
  memberships and corresponding authorization audit rows, including source
  ownership;
- exactly GitHub, GitLab, Azure DevOps and Bitbucket provider defaults, scoped
  to the default tenant and without OAuth credentials; and
- exactly the Dev, Test, Staging and Production environment tags; and
- zero rows in every other predecessor entity table, so a verified-existing
  receipt cannot attest a shard that already contains ordinary business data.

The receipt includes only immutable contract identity, non-secret shard and
role identifiers, action and aggregate observed counts. It is created with
mode `0600`, fails if the target already exists, is recursively checked for
secret-shaped fields, and is bounded to 4096 bytes.

## Host chart execution

The host chart keeps `database.managedShardBootstrap.enabled: false` by
default. Enabling it is valid only for the explicit `postgres`/`pooled` profile
and requires:

```yaml
database:
  profile: { databaseType: postgres, tenancyMode: pooled }
  managedShardBootstrap:
    enabled: true
    shardId: staging-shard-a1
    seedSecretName: enterpriseglue-bootstrap-seeds
    image:
      repository: ghcr.io/enterpriseglue/enterpriseglue-managed-shard-bootstrap
      digest: sha256:<digest-from-verified-candidate-receipt>
      pullPolicy: IfNotPresent
  migration:
    runtimeRole: eg_runtime
serviceAccounts:
  bootstrap: { create: true, name: "", annotations: {}, automountServiceAccountToken: false }
```

The pre-install-only bootstrap hook has weight `-30`, before the bridge owner
hook at `-20`. It receives database-owner connection material from
`database.migrationSecretName` and bootstrap seed values such as
`ADMIN_EMAIL`, `ADMIN_PASSWORD`, `JWT_SECRET` and `ENCRYPTION_KEY` from the dedicated
`seedSecretName`. The seed Secret must not alias the application, migration or
preflight database Secret. The job uses a separate ServiceAccount, a read-only
root filesystem and an ephemeral receipt volume. It retains the completed Job
until `ttlSecondsAfterFinished` so the provisioning controller can copy the
bounded receipt or capture the identical final JSON log line; successful hook
completion is not a substitute for retaining that receipt. The chart never
creates a database role or Secret.

Because the job is a `pre-install` hook, later `helm upgrade` operations do not
rerun it. A provisioning controller must first verify the candidate signature,
subject digest, artifact inventory and manifest projection, create the empty
database and restricted owner/runtime roles, create the dedicated seed Secret,
and only then opt in for the shard's first install. After bootstrap, the normal
owner migration and preflight retain their existing strict behavior.

## Verification

Focused local checks are:

```sh
node --test scripts/managed-shard-bootstrap.test.mjs
node scripts/managed-shard-bootstrap-manifest.mjs --check
bash scripts/run-managed-shard-bootstrap-postgres.sh
bash scripts/check-enterpriseglue-host-chart.sh
node --test scripts/release-candidate-receipt.test.mjs \
  scripts/release-candidate-workflow.test.mjs \
  scripts/verify-oci-image-metadata.test.mjs
```

The real PostgreSQL harness is pinned to PostgreSQL 16, matching managed
staging. It proves pristine bootstrap, exact-existing
idempotence, bounded non-secret receipts and representative fail-closed ledger,
object, role, owner, RLS, relation/default/column ACL and seed drift cases,
including superuser, missing-administrator-email and malformed-administrator-email
pristine attempts that leave their schemas absent, plus exact one-to-one
membership authorization-audit coverage. It is
also part of the native PostgreSQL tenancy CI lane. These checks are
PostgreSQL-specific; they do not claim Oracle, MySQL, SQL Server or Spanner
bootstrap support.
