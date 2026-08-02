---
name: enterpriseglue-ci-debug
description: Use when the user says /ci-debug, debug CI, investigate a failed GitHub Actions run, inspect failed PR checks, diagnose EnterpriseGlue OSS or EE CI failures, or triage Docker Images publish failures.
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
4. Classify other failures as product regression, test defect/flakiness,
   environment/infrastructure, security/policy, package/release, or external
   dependency. Distinguish cancelled and skipped jobs from failures.
5. Reproduce the smallest relevant command locally, implement only an
   authorized fix, and rerun proportionately. Do not rerun expensive suites
   while a deterministic preflight or contract failure remains.
6. Report root cause, evidence, fix, local verification, remaining jobs, and
   whether a rerun was requested or performed.
