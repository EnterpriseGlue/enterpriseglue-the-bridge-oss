---
doc_class: technical
audience: [developer, operator, maintainer]
publication: github
lifecycle: reference
---

# Security dependency updates

Inspect the exact image scan and its package paths before changing dependency
versions. An image may contain build dependencies or an immutable predecessor
tree that is absent from the current application's production dependency graph.
Use structured findings or primary advisories: a blank cell in a merged scanner
table is not proof that an advisory has no fix.

For pnpm, the workspace overrides and lockfile determine installed versions.
Keep relevant manifests consistent, regenerate the lockfile, and propagate
published workspace consumer versions with the package-version authority.
Named major upgrades require explicit approval. Compile and test real library
entrypoints as well as mocks; qualify affected runtime and database behavior.

The workspace requires qs 6.16.1 or later in its supported 6.x release line for
[CVE-2026-110816](https://github.com/ljharb/qs/security/advisories/GHSA-6pq8-jhm2-2vcw). Qualify comma-format serialization with non-callable own
`toString` values and null-prototype objects, plus ordinary query serialization.
Application and frozen-bootstrap production stores consume this same patched
lockfile. Rebuild and scan both exact images; standalone consumers must also
refresh their own installed qs resolution.

The workspace pins glob 14.0.2 and minimatch 11.0.1 for
[CVE-2026-118773](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) and
[CVE-2026-118764](https://github.com/advisories/GHSA-g3hv-75wg-m249).
TypeORM's actual entity/migration discovery and Archiver's recursive ZIP export
must remain compatible with these major upgrades, including excluded files and
Unicode paths. Keep the frozen bootstrap's compiled entities, migration
inventory and schema-plan identities unchanged while refreshing its production
dependency store. ESLint also consumes minimatch, so qualify its configuration
and file selection. Standalone package consumers must reproduce these root
overrides and verify their installed tree; published package manifests do not
propagate pnpm workspace overrides.

The bootstrap constructs the four Git-provider defaults from its signed manifest
with one timestamp for creation and update. The frozen predecessor's seeder
reads the clock twice per row, which can cross a millisecond boundary. Its
compiled bytes stay unchanged; the bootstrap-owned writer requires an empty
relation and inserts all four exact defaults atomically. Timestamp equality and
all seed-content checks remain strict. Qualify an advancing-clock case and a
real PostgreSQL timestamp-tamper rejection; existing installations need no seed
repair or bootstrap rerun.

Keep full dependencies in the application build stage and production-only
dependencies in the runtime assembly stage. Runtime modules must remain
explicitly declared; do not remove a database driver to make an image scan pass
while still claiming support for that adapter.

An application dependency update does not repair the frozen bootstrap image.
Preserve its exact predecessor source, migration inventory and schema-plan
identities when isolating its runtime dependency closure. Any replacement must
pass the real PostgreSQL bootstrap and drift checks and exact image scan.

The managed-shard bootstrap retains the pinned predecessor's compiled code and
replaces its dependency stores with the application's reviewed production
lockfile. Old stores are removed before copying, rather than overlaid. Its
unchanged migration inventory and signed TypeORM schema-plan checks remain
mandatory; dependency compatibility must be proved by the bootstrap harness.

The pnpm workspace applies a source patch to Tedious 20.0.0's five diagnostic
callers and removes that driver's `sprintf-js` dependency. The owned bounded
formatter implements only its fixed decimal/string/unsigned hexadecimal
literals, rejecting precision and unbounded padding. Tedious keeps its original
package identity and SQL Server protocol behavior; no advisory is suppressed.
The patch is root-workspace composition, not an upstream fix. Consumers of
standalone npm packages do not automatically inherit pnpm root patches. A
driver upgrade must revisit this patch and qualify real SQL Server behavior.

The host pins MSAL Node 7.1.0 and redirects Azure Identity 4.13.2's MSAL
dependency to that same version. Azure Identity's declared range still selects
the affected MSAL 5 release line, so the scoped root override is required for
the reviewed SQL Server dependency closure. Its real ClientSecretCredential
path is tested for token acquisition, caching, separate tenant caches and
credential refusal through a synthetic HTTP boundary. This is library
compatibility evidence, not live Azure authentication or application tenant
isolation acceptance; physical SQL Server and exact-image gates remain required.
Standalone package consumers must reproduce the scoped root override and
qualify their installed dependency tree; published package manifests do not
propagate pnpm workspace overrides. Revisit the override when Azure Identity
changes its MSAL dependency.

The Bitbucket provider uses the platform's native fetch API for its fixed
Bitbucket Cloud REST endpoints. The removed Bitbucket SDK depended on deepmerge
4.3.1, which has no qualified fix for CVE-2026-93753. Repository, branch, tag,
commit and file operations retain their provider interface; bearer credentials
are sent only to the fixed API origin, and redirects are refused. Qualify the
HTTP contracts and multipart upload behavior when changing this adapter.

If a remaining runtime dependency has no qualified upstream fix, stop dependent
release qualification. Removing or replacing that dependency requires caller
compatibility and regression evidence. Do not falsify versions, suppress the
finding or count a filtered scan as acceptance. The candidate's exact scanner,
all-severity application/bootstrap gate and signed composition remain required.


Runtime OS floors must be explicit in the Dockerfile command: a cached
`apk upgrade` layer does not observe newly published package fixes. Application
and frozen-bootstrap assemblies require the glibc 2.44 runtime family at
2.44-r8 or later. The application removes the base image's Node/npm/Corepack
family and installs the qualified Node 24 package; a runtime assertion protects
the repository's declared major even when a digest-pinned vendor image contains
a newer Node major. The bootstrap retains its exact predecessor compiled code
and schema contract; package floors do not change its signed migration inventory
or schema plan. Scan the final exact application and bootstrap subjects with
fresh vulnerability data before acceptance.

Wolfi runtime assemblies also require the Brotli common, decoder and encoder
packages at 1.2.0-r7 or later. These floors belong in the Dockerfile command so
cached package-upgrade layers cannot retain an earlier vulnerable revision.
The Alpine acquisition toolchains require `brotli-libs` at 1.2.1-r0 or later,
matching that distribution's security fix rather than Wolfi's revision scheme.
Their runtime base is pinned to Alpine 3.24, whose Node package includes the
Node 24.22.1 security fixes; the older Alpine 3.23 repository does not provide
that patched package. An explicit `nodejs>=24.22.1-r0` floor invalidates stale
install layers, and a build assertion retains the supported Node 24 major.
The Wolfi application pins Node 24.22.1-r2, and the frozen bootstrap pins
Node 26.12.1-r2 within its existing runtime major. Both require c-ares 1.34.9-r0
or later. These runtime updates preserve the frozen compiled bootstrap code
and schema contract; upstream security advisories must also be checked when
distribution vulnerability metadata has not yet caught up.
