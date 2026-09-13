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

Frontend-only shell and component changes run a focused lane containing both
frontend typechecks, all frontend unit tests, and frontend lint. They do not
start PostgreSQL or build the backend. A change that also touches backend,
persistence, authorization, Mission Control engine integration, or an unknown
surface continues to use the broader application lane. Package-version and
documentation guards remain independently selected when applicable.

The exact generated Release Please delta is also explicit: the version
manifest, top-level changelog, versioned release document, and host chart
metadata select documentation, boundary, Helm render, and release-readiness
classification, but the expensive readiness rehearsal runs only when release
pipeline contracts themselves change. Release Please heads and merge groups do
not repeat application, database, identity, authorization, browser, package,
chart, or image suites already qualified on the source changes. The release
merge group still stages and qualifies the signed candidate across all five
TypeORM adapters, the pinned Operaton browser journey, the full mock-engine
browser journey on exact PostgreSQL images, packages, charts, and multi-platform
images before publication. The required `Release candidate staged` status
cannot pass until that exact-SHA qualification completes.

CodeQL runs both JavaScript/TypeScript and Actions analysis on pull requests,
protected `main`, and the weekly backstop. A merge group does not upload another
SARIF result from its short-lived queue ref. Instead, the required CodeQL gate
queries every alert from the exact pull request, including its already-completed
Actions and JavaScript/TypeScript analyses. This keeps queue validation inside
the repository's short merge-group window without removing either language from
pull-request qualification.

## Expensive evidence

- Frontend-only shell/component changes run frontend typechecks, unit tests,
  and lint without a database.
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

Engine health queries share one cache key and a bounded retry/polling policy.
Client-side 4xx responses are neither retried nor automatically polled until a
configuration mutation invalidates the query. Network and server failures
receive one immediate retry, then poll with exponential backoff capped at five
minutes. Healthy engines poll every 30 seconds, background tabs do not poll,
and window focus does not multiply requests. This prevents a single dependency
or contract error from becoming a browser error storm while allowing transient
outages to recover automatically.

## Candidate images and promotion

Backend and frontend images build as four independent component/platform jobs:
backend amd64, backend arm64, frontend amd64, and frontend arm64. Each job uses
a component- and architecture-specific registry cache. The amd64 jobs run on
`ubuntu-24.04`; arm64 jobs run natively on GitHub's `ubuntu-24.04-arm` runner.
Both architectures remain mandatory, and a missing native runner fails closed
instead of silently moving release-critical compilation back under emulation.

The image workflow checks out the exact immutable `source_ref`, disables
persisted Git credentials, verifies `HEAD`, and uses that same SHA for OCI
revision labels and receipts. Candidate staging permits this privileged build
only after its read-only validator proves the merge delta is the deterministic
Release Please-only change set.

The publish job assembles the two architecture digests into one manifest per
component, verifies the resolved digest and OCI metadata, then signs and
attests the manifest. Release publication promotes the exact qualified
candidate digest; it does not rebuild source bytes or repeat the database,
browser, or vulnerability qualification after the signed candidate passes.
Public aliases advance only after the semantic release tags are verified to
resolve to those exact candidate digests. Explicit non-candidate image builds
continue to run the full post-build gates.

Publishing a stable OSS release also sends a wake-up event to the Cloud repository's fixed
staging/demo reconciler. The notification resolves the authoritative release and recursively
dereferences its tag before dispatch; the receiver treats the payload only as a wake-up and
independently resolves the latest published release and signed candidate. A manual
`release-notify.yml` dispatch can replay the wake-up for an exact published tag, while the Cloud
side's six-hour reconciliation schedule repairs missed events. This path has no production target.

The signed candidate also carries the exact shared, backend-host, and
frontend-host package tarballs. These packages no longer publish merely
because their source reaches `main`. The release event verifies the Git tag,
candidate signature, receipt checksum, canonical registry payload, and
protected environment before publishing the retained bytes in dependency
order. The protected publisher does not reinstall or rebuild release packages;
those gates already ran before the candidate was signed. The fallback build is
available only to the non-publishing legacy verification path.

## Release canary

`.github/workflows/release-canary.yml` runs weekly and supports manual
dispatch. It invokes the production reusable image workflow against dedicated
GHCR scratch repositories, verifies exact ORAS and Cosign identities, and runs
the package, chart, image, plugin-payload, and receipt readiness drill with
no public publication. A second scratch-only job deliberately advances one
half of a backend/frontend alias pair, detects the partial state, restores the
previous pair, and proves missing candidate and registry lookups fail closed.

`.github/workflows/engine-compatibility.yml` runs weekly and on demand. It runs
the complete Mission Control process/health/BPMN/variables/console journey in
parallel against the pinned supported Operaton 2.1 digest and the moving
upstream `latest` tag. The moving lane is deliberately outside pull-request and
release critical paths, but it is not allowed to hide a compatibility failure.

`.github/workflows/ci-cost-report.yml` evaluates a rolling seven-day window
daily. It opens or refreshes one repository issue for a candidate p95 above 45
minutes, first-attempt success below 90%, real workflow failures, workflow or
application-image retries, or a tagged application-image rebuild. Superseded
cancellations remain separately classified and do not become failures.

Treat a failed canary as a release-control defect. Repair and rerun it before a
material release workflow change is allowed to publish.

## Schedule and artifact budget

Change-aware pull-request and merge-queue gates remain event-driven. The full
CI unchanged-main backstop runs on Monday, the release canary on Wednesday, the
cross-browser authorization backstop on Thursday, and the advisory identity
protocol rehearsal on Friday. Maintainers may manually dispatch any of them
when a release or investigation needs fresher evidence. The daily security and
CI-observability workflows remain daily because they detect time-sensitive
dependency, advisory, and operational changes.

The `ci-images` artifact is only an intra-workflow handoff to downstream smoke
jobs and expires after one day. Plugin-toolchain releases upload the complete
air-gap archive and distribution assets to the immutable GitHub Release; the
Actions artifact retains only the small release, import, manifest, and signing
receipts for 30 days. Do not copy already-published payload blobs into a second
long-lived Actions artifact.

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
