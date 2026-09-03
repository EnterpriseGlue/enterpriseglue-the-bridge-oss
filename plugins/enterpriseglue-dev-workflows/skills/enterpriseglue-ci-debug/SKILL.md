---
name: enterpriseglue-ci-debug
description: Use when the user says /ci-debug, debug CI, investigate a failed GitHub Actions run, inspect failed PR checks, diagnose EnterpriseGlue OSS host or plugin repository CI failures, or triage image publication failures.
---

# EnterpriseGlue /ci-debug

1. Resolve the PR, head SHA, repository, and failing run. Read
   `.windsurf/workflows/ci-debug.md` when present.
2. Inspect the actual failing job, step, annotation, and log text using GitHub
   metadata or `gh`; do not diagnose from the workflow name alone.
3. If `release-notes-preflight / Release-note preflight` failed, diagnose it
   before any rerun. Check the baseline tag/manifest/changelog, changed
   fragment, PR title, `release:*` label, exemption reason, package versions,
   and the uploaded preview artifact.
4. Classify other outcomes as product regression, test defect/flakiness,
   environment/infrastructure, security/policy, package/release, external
   dependency, superseded cancellation, manual/external cancellation, or an
   intentional skip. A selected lane that is skipped or missing is a failed
   aggregate contract, while an older same-branch run superseded by a newer
   run is not a product failure.
5. Reproduce the smallest relevant command locally, implement only an
   authorized fix, and rerun proportionately. Do not rerun expensive suites
   while a deterministic preflight or contract failure remains.
6. Report root cause, evidence, fix, local verification, remaining jobs, and
   whether a rerun was requested or performed. For duration investigations,
   separate queue, execution, wall-clock critical path, and runner minutes;
   include candidate and publication workflows rather than sampling only PR
   CI.
