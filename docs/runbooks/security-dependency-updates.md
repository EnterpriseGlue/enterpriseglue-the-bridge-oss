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

If a remaining runtime dependency has no qualified upstream fix, stop dependent
release qualification. Removing or replacing that dependency requires caller
compatibility and regression evidence. Do not falsify versions, suppress the
finding or count a filtered scan as acceptance. The candidate's exact scanner,
all-severity application/bootstrap gate and signed composition remain required.
