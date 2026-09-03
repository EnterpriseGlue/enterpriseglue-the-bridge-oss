---
doc_class: technical
audience: maintainer, operator, developer
publication: github
lifecycle: as-built
---

# CI and release routing

EnterpriseGlue CI selects verification from a deterministic change classifier.
The OSS repository is the only application host and shared plugin-platform
authority. Product-specific plugins qualify and release from their owning
repositories; standalone EE development, synchronization, and release jobs are
not part of this topology.

## Change classification

`scripts/ci-change-classifier.mjs` maps the exact changed-path list to explicit
change classes and lane outputs. The reusable detector in
`.github/workflows/ci-detect-reusable.yml` is the only workflow entry point for
that policy.

The primary classes are `metadata_only`, `frontend`, `backend`, `persistence`,
`engine_integration`, `authorization`, `plugin_contract`, `plugin_packaging`,
`application_container`, `toolchain_container`, `helm`, and
`workflow_or_release`. An unrecognized path adds `unknown_high_risk` and selects
the broad safe path. Manual full runs also select every lane.

The classifier and its fixtures are mandatory CI contracts. When adding a new
top-level component or a workflow-relevant script:

1. add the narrowest correct path rule;
2. add positive and negative classifier fixtures;
3. verify every selected job is required by the `ci-complete` aggregate;
4. confirm a metadata-only fixture still avoids application, database,
   authorization, browser, plugin-image, and image-build lanes.

A selected lane may not be skipped. `scripts/evaluate-ci-needs.mjs` fails the
aggregate for a selected job that is missing, skipped, cancelled, timed out, or
failed.

Documentation and Markdown changes select a dedicated lightweight publication-
boundary job. They do not select the larger OSS/configuration/plugin boundary
bundle unless another changed path requires it.

## Expensive evidence

- Ordinary backend changes run focused PostgreSQL integration.
- TypeORM entities, migrations, database adapters, or persistence behavior run
  PostgreSQL, MySQL, SQL Server, Oracle, and Spanner qualification.
- Engine and Mission Control changes run the engine regression and authenticated
  browser lanes.
- Authorization changes run the focused access-governance and real-adapter
  backstop lanes.
- Plugin API and host changes run package discipline, reference-plugin, and
  external-consumer compatibility.
- Image changes run image smoke, OCI metadata, and security qualification.
- Release-control changes run workflow contracts and are exercised by the
  scheduled non-publishing canary.

Candidate database jobs are independent shards. The aggregate verifies that
all five named databases passed and produced the same canonical schema
fingerprint. Candidate Operaton evidence uses the repository-pinned supported
2.1 image and verifies version discovery, repeated health reads, process list,
completed process detail, BPMN rendering, final variables, and browser
diagnostics.

## Browser diagnostics

Mission Control smoke tests install the strict diagnostic collector in
`test/e2e/utils/browserDiagnostics.ts`. Unexpected console errors or warnings,
page errors, failed requests, HTTP 4xx/5xx responses, and visible application
error boundaries fail the test. An exception must name an owner and reason,
have a future expiry date, and link to an HTTPS issue. Wildcard exceptions are
invalid.

Engine health queries share a bounded retry policy: client-side 4xx responses
are not retried, while a network or server failure receives one retry. This
prevents a single dependency or contract error from becoming a browser error
storm.

## Candidate images and promotion

Backend and frontend images build as four independent component/platform jobs:
backend amd64, backend arm64, frontend amd64, and frontend arm64. Each job uses
a component- and architecture-specific registry cache. Until protected native
arm64 capacity is configured, arm64 uses the explicit QEMU fallback.

The image workflow checks out the exact immutable `source_ref`, disables
persisted Git credentials, verifies `HEAD`, and uses that same SHA for OCI
revision labels and receipts. Candidate staging permits this privileged build
only after its read-only validator proves the merge delta is the deterministic
Release Please-only change set.

The publish job assembles the two architecture digests into one manifest per
component, verifies the resolved digest and OCI metadata, then signs and
attests the manifest. Release publication promotes the exact qualified
candidate digest; it does not rebuild source bytes after qualification.

## Release canary

`.github/workflows/release-canary.yml` runs nightly and supports manual
dispatch. It invokes the production reusable image workflow against dedicated
GHCR scratch repositories, verifies exact ORAS and Cosign identities, and runs
the package, chart, image, plugin-payload, and receipt readiness drill with
publication disabled. It cannot advance a semantic release tag, `latest`, a
Docker Hub alias, or a public package.

Treat a failed canary as a release-control defect. Repair and rerun it before a
material release workflow change is allowed to publish.

## Observability and targets

`CI and Release Observability` reports all completed repository workflows for
the last seven days. It separates successes, failures, skipped work,
superseded cancellations, and manual/external cancellations. The retained JSON
also records retries, first-attempt success rate, per-workflow queue/execution/
wall p50 and p95, and the highest runner-minute jobs.

Operational targets are:

| Flow | p95 target |
| --- | ---: |
| Metadata or release-note-only pull request | under 5 minutes |
| Focused frontend/backend pull request | under 15 minutes |
| Relevant browser or integration pull request | under 20 minutes |
| Merge-queue exact-SHA gate | under 8 minutes |
| Multi-platform candidate image stage | under 20 minutes |
| Final green commit to verified public release | under 45 minutes |

These are measured rollout objectives, not claims established by contract
tests. Retain the broader fail-closed path while classifier mismatches or
candidate-digest differences remain unresolved.

## Local verification

Run the workflow and routing contracts with:

```bash
pnpm run test:ci-contracts
pnpm run test:ci-change-detection
```

For a persistence or engine change, also run the Mission Control regression
suite and the applicable physical database or real-Operaton backstop. Record
unavailable infrastructure as missing evidence; do not report an emulator or
static adapter test as physical-database qualification.
