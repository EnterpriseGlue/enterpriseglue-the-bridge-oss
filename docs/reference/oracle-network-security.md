---
doc_class: technical
audience: developer, architect, operator, maintainer
publication: github
lifecycle: as-built
---

# Oracle application database network encryption

EnterpriseGlue can require Oracle Native Network Encryption (NNE) with AES256
for its application database. This deployment profile applies to TypeORM,
legacy Oracle pools, migrations, and the supported host process roles. User
SSO remains independently configured through its identity provider.

## Configuration contract

| Variable | Default | Contract |
| --- | --- | --- |
| `ORACLE_NETWORK_ENCRYPTION` | `default` | Omitted or `default` preserves existing connection behavior. `native-aes256-required` enables Thick mode, AES256 only, and mandatory encryption negotiation. Other values fail validation. |
| `ORACLE_NET_CONFIG_DIR` | Unset | Required absolute directory for the native profile. It contains the validated, readable `sqlnet.ora` and any required `tnsnames.ora`. Supplying this setting without the native profile is an error. |

The native profile requires `DATABASE_TYPE=oracle` and a qualified Oracle-capable
image. The deployment must supply this dedicated client configuration:

```ini
SQLNET.ENCRYPTION_CLIENT = REQUIRED
SQLNET.ENCRYPTION_TYPES_CLIENT = (AES256)
```

The host renders the validated profile into a private, read-only process
snapshot. Live mount replacements cannot relax encryption on new pool
connections; configuration changes require a restart.
Concurrent first callers share one initialization in each datasource/pool
instance. A failed initialization can be retried later; it cannot fall back to a
permissive profile. Shutdown waits for pending initialization before closing.

Files are limited to 64 KiB; validation and bounded reads use the same open
file so mount replacements cannot bypass the file check. The supported `sqlnet.ora` grammar consists of
unquoted direct assignments and optional parenthesized lists; comments and
multiline lists are supported. Duplicate assignments and `IFILE` indirection
are rejected. The snapshot restricts naming to `TNSNAMES` and `EZCONNECT`;
LDAP and other external database naming methods are rejected. This restriction
does not affect LDAP identity providers. Additional direct checksum settings can be included when the
DBA's policy requires them. Encryption types must specify only AES256. The documented scalar `AES256`
form is accepted and normalized to `(AES256)` in the private profile.

TCP Easy Connect strings, TCP HA descriptors, and dedicated TNS alias files
are supported. The native profile rejects TCPS, connection encryption
parameters, wallet parameters, credentials embedded in a descriptor, and
external configuration providers. A dedicated TNS file must contain only
compatible TCP entries without profile overrides. The default profile retains
its existing connection-string behavior and does not require Oracle Client
libraries. It makes no additional encryption guarantee.

`ENCRYPTION_KEY` protects application-managed stored secrets. Oracle
Transparent Data Encryption protects data at rest. Both have separate
configuration from this transport profile.

## Oracle image and Compose

The production Dockerfile has an explicit `oracle` target that shares compiled
application artifacts with the default `standard` target. It includes the
Oracle Instant Client Basic 23.26.3 archives pinned by architecture and SHA256,
required native libraries, and Oracle's original license/readme files. The
standard image retains its existing dependencies. The native profile uses a
default maximum of four TypeORM connections plus ten legacy-pool connections. Oracle
images set `UV_THREADPOOL_SIZE=32` before Node starts. Custom VM images must
set at least that value at process startup; increase it if additional pools are
introduced. Thick mode uses Node worker threads for database operations, unlike
Thin mode. Linux amd64 and arm64 are
the supported image targets; qualification is required on each architecture.

For a source deployment, add `docker-compose.oracle-nne.yml` after the relevant
Oracle/deployment overlays. It selects the Oracle image target, enables the
profile, and mounts `EG_ORACLE_NET_CONFIG_HOST_DIR` read-only at
`/etc/enterpriseglue/oracle`. The default mount source is
`infra/docker/oracle/client`. Use `docker-compose.oracle-nne-dev.yml` for the
compatible development image. Existing local environment files are unchanged.

Published-image deployments must explicitly select the Oracle backend
repository and a reviewed release tag or digest. Apply the images overlay last
so its build reset remains effective. The native flag does not automatically
select or download an image.

The optional repository is
`ghcr.io/enterpriseglue/enterpriseglue-the-bridge-oss-backend-oracle`. Publication
uses the explicitly dispatched `oracle-image-release.yml` workflow for an
existing stable released source. Dispatch uses the current protected `main`
workflow. It resolves the stable release tag through GitHub's API, verifies its
exact source SHA and protected-main history before checkout, and passes that
verified source to qualification. It qualifies both architectures, retains the
qualified image bytes, scans them under the committed application security
policy, and signs the assembled manifest. Each architecture receives a CycloneDX SBOM
attestation; the manifest receives build provenance. The ordinary SaaS release image set
and standard image selection remain independent of this optional artifact.
An image becomes available only after that workflow succeeds.

The SBOM includes the unpackaged Instant Client distribution in addition to
Trivy's package inventory. The completer checks the retained image's runtime
notices and bundled licence/readme files, then records the pinned archive's
version, architecture, download URL and SHA256. This completes component
inventory; a Trivy pass does not certify Oracle's vendor patch status.

## Kubernetes and OpenShift

For the host chart, explicitly select the Oracle image digest and configure:

```yaml
database:
  profile:
    databaseType: oracle
    tenancyMode: single
  oracleNativeEncryption:
    enabled: true
    configMapName: enterpriseglue-oracle-net
```

The named ConfigMap supplies `sqlnet.ora` and optional `tnsnames.ora`. The chart
projects the profile read-only and injects the mode/directory into API, worker,
migration, and preflight containers. The profile rejects managed PostgreSQL
bootstrap/cohort hooks and does not enable Oracle pooled tenancy. Use distinct
migration and application credentials according to the deployment's existing
credential contract.

OpenShift Kustomize supplies the optional `oracle-nne` component. The deploy
script selects it when the native mode is requested, validates the client file,
and renders a disposable wrapper with the selected configuration. Set
`EG_ORACLE_NET_CONFIG_HOST_DIR` to an absolute directory for a custom profile.
The ConfigMap content hash changes the deployment projection for rollout.
Native deployment preparation requires Node.js 24. Select the Oracle backend
image explicitly through the existing `BACKEND_IMAGE` input.

## Persistence and upgrade

Historical migration boolean declarations use `NUMBER(1,0)` on Oracle, with
`0` for false and `1` for true. This works on Oracle releases before SQL
`BOOLEAN` support and matches the adapter's existing boolean value mapping.
Non-Oracle migration declarations retain their existing types and defaults.

Older images can fail pending migration
`AddSsoAutoRedirectSingleProvider1700000000006` with
`ORA-00904: "FALSE": invalid identifier`. Install an image containing the
historical boolean migration repair, then rerun apply-mode migrations with the
schema-owner identity. Keep the existing database and migration ledger;
already completed migrations remain completed. The repair keeps migration
identifiers unchanged and does not introduce a new migration or convert
already-applied columns. Later migration 0107 removes the obsolete redirect
flag as part of the existing provider-selection model.

Oracle DDL may commit independently of a failed migration transaction. Existing
column checks make repaired historical migrations safe to retry after partial
application. Do not bypass pending migrations by deleting or manually stamping
ledger entries. Application rollback retains completed migration entries and
their numeric columns; an older image can still fail if it must execute an
unrepaired historical migration.

The pinned TypeORM patch sizes Oracle string `RETURNING` buffers from column
metadata to avoid the native driver's 200-byte default. It preserves number,
LOB, and other database bind behavior.

Oracle alone registers `ExpandOracleAssignmentKeys1700000000134`. It widens
canonical assignment keys in `role_assignments` and
`config_role_assignment_overrides` to `VARCHAR2(4000 BYTE)` in place, preserving
values and indexes. Its dedicated Oracle migration directory leaves other
adapters' migration inventories and the PostgreSQL schema-epoch contract
unchanged. Existing Oracle databases must run the migration with appropriate
schema privileges before verify-only application startup. Automatic shrinking
is refused; application rollback retains the widened columns.

The chart's migration job uses the existing schema-owner credential contract.
For a standalone migration process, run this from `/app` inside the Oracle
image with the Oracle connection variables, native profile mount, and migration
credentials supplied by the deployment:

```sh
node --input-type=module --eval '
const { runMigrations } = await import("./dist/packages/shared/dist/db/run-migrations.js");
const { closeDataSource } = await import("./dist/packages/shared/dist/db/data-source.js");
try { await runMigrations({ mode: "apply" }); }
finally { await closeDataSource(); }
'
```

Repeat with `mode: "verify"` and the application credentials before starting
verify-only application processes. Both invocations use the same required
encryption profile. Migration commands need database configuration independently
of the authentication secrets required by the server.

## Verification and troubleshooting

A server configured with `REQUESTED` does not by itself enforce encryption.
The client profile uses `REQUIRED`, so rejected encryption or a nonmatching
cipher prevents connection establishment. The listener's existing TCP port is
retained. TLS requires its own separately qualified profile and endpoint.

Use `test:oracle:nne:unit` for focused contract tests,
`test:oracle:nne:negotiation` with `ORACLE_NNE_TEST_IMAGE` for physical negotiation
and both pools, and `test:oracle:nne:sso` for the disposable compiled-image
Oracle/Keycloak browser rehearsal. The negotiation lane covers requested,
required, accepted, rejected, cipher mismatch, missing libraries, default
behavior, reconnects, and a populated assignment-key upgrade that retains data
and valid indexes. The SSO lane uses real Oracle persistence for OIDC,
Entra-compatible OIDC, signed SAML, LDAP, and authorization mapping journeys.
Its diagnostic and image evidence stays in `.artifacts` and CI artifacts.
For a local rerun, `IDENTITY_PROTOCOL_REHEARSAL_BACKEND_IMAGE` and
`IDENTITY_PROTOCOL_REHEARSAL_FRONTEND_IMAGE` can select previously built local
`sha256:` image IDs. The harness scans those exact images again before starting
the stack; it does not accept mutable tags for reuse. Negotiation evidence is
updated after each case and records failure when a run cannot complete.

`V$SESSION_CONNECT_INFO.NETWORK_SERVICE_BANNER` must include the negotiated
`AES256 Encryption service adapter` for the application sessions. A generic
`Encryption service` banner is insufficient. Correlate physical pool sessions
by account, SID, serial number, and instance where relevant; a snapshot with no
application sessions proves nothing. A dedicated verifier or fixture DBA can
collect evidence without giving broad catalog privileges to the runtime user.

| Symptom | Required check |
| --- | --- |
| Invalid profile/directory | Confirm absolute path, readable mount, direct assignments, `REQUIRED`, and `(AES256)`. |
| Oracle Client initialization failure | Confirm Oracle image flavor, architecture, native library search path, and initialization before any pool. |
| Encryption negotiation failure | Have the DBA confirm compatible AES256 server policy. Retain enforcement. |
| Oversized Oracle assignment key | Apply the Oracle-specific upgrade; retain existing data and uniqueness. |
| Mode or profile changed | Restart all host processes and pools with the reviewed configuration. |

For deployments whose security policy requires NNE, recovery must retain a
previously qualified encrypted composition or stop service. Disabling the
profile is not a valid recovery procedure for that policy.

The repository fixture is pinned Oracle Free 23.26.3. Qualification with the
exact deployment's Oracle release update, network policy, and real IdP remains
required. A protocol emulator establishes protocol behavior, not real-provider
or Oracle 19c deployment acceptance.

## Oracle references

- [Node driver NNE and session evidence](https://node-oracledb.readthedocs.io/en/v6.10.0/user_guide/connection_handling.html#native-network-encryption)
- [Thick-mode worker sizing](https://node-oracledb.readthedocs.io/en/v6.10.0/user_guide/connection_handling.html#connections-threads-and-parallelism)
- [Driver initialization and configuration files](https://node-oracledb.readthedocs.io/en/v6.10.0/user_guide/initialization.html)
- [Oracle encryption negotiation](https://docs.oracle.com/en/database/oracle/oracle-database/19/dbseg/configuration-data-encryption-and-integrity.html)
