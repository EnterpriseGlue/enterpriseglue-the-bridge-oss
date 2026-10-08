---
description: Diagnose exact failed CI evidence before repair or a bounded retry
---

# /ci-debug — Diagnose a failed run

Use the maintained `enterpriseglue-ci-debug` skill in
`plugins/enterpriseglue-dev-workflows`. Its lifecycle and evidence rules apply
to this legacy entrypoint too. Work only in active OSS, Cloud or the owning
plugin repository; do not resolve a retired repository for ordinary CI work.

1. Resolve repository, PR/head SHA, run attempt and actual failing job/step.
   Use `gh pr checks` and `gh run view` with the explicit active repository.
2. Inspect scoped CI evidence, subject to the task's privacy restrictions.
   Classify product, test, infrastructure, security, release-contract and
   cancellation failures separately. Missing selected lanes are not passing.
3. Reproduce the smallest affected command locally and repair only authorized
   scope. A security or deterministic contract failure needs a fix, not a rerun.
4. Before another diagnostic, state the decision it can change and when it ends.
   Escalate missing evidence or authority when safe evidence cannot discriminate
   causes. Do not accumulate speculative probes or PRs.
5. Retry only a demonstrated transient failure within authorization. Record why
   the outcome may change; a timeout with an unknown external effect does not
   establish retry safety. Do not bypass checks or ship known failures.
6. Report the evidence, cause or remaining uncertainty, fix, exact revision's
   local checks and next action. Keep merge, publication and deployment distinct.
