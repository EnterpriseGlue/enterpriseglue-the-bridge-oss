---
name: enterpriseglue-pr-readiness
description: Audit an EnterpriseGlue pull request without merging or changing its review state. Use for /pr-readiness, draft PR review, pre-review checks, release-impact verification, documentation and migration completeness, CI evidence, or deciding whether a change is ready for human review.
---

# EnterpriseGlue PR Readiness

1. Resolve the exact repository root, worktree, branch, base branch, and PR. Keep
   this workflow read-only unless the user separately asks for fixes.
2. Run the bundled collector from the repository root:

   ```bash
   node <skill-dir>/scripts/collect-pr-readiness.mjs \
     --base-ref origin/main \
     --output .artifacts/pr-readiness.md
   ```

3. Read `references/readiness-checklist.md`, inspect the complete diff, and
   reconcile its requirements with the collector output.
4. When `release-notes:preflight` exists, run it and review the generated note;
   do not infer release readiness from commit titles alone.
5. Run `pnpm run guard:documentation-boundary -- --base-ref origin/main` when
   the repository provides it. Treat internal product material,
   customer-documentation drafts, committed transient UI evidence, or public
   technical docs that depend on private links as readiness blockers.
6. Run proportionate local gates. Verify public API/OpenAPI, JSON configuration,
   TypeORM migrations, database portability, UI behavior, security boundaries,
   documentation, rollback, and package impact whenever their paths changed.
   Route backend HTTP and public-schema changes through
   [contract-parity](../enterpriseglue-contract-parity/SKILL.md), including
   backend-only route changes. Reconcile registered methods/paths, generated
   operations and request/response schemas with actual handlers and payloads,
   supported by the affected regression tests. Include public/bootstrap,
   auth-only, tenant and compatibility variants. Treat missing operations,
   stale schemas or missing required coverage evidence as `Blocked`; the
   collector and authorization inventory do not prove OpenAPI completeness.
   Reuse applicable passing evidence instead of rerunning unchanged gates.
7. Inspect current GitHub checks and their actual error text. Treat pending,
   advisory, skipped, and externally deferred evidence distinctly.
8. Report `Ready`, `Conditional`, or `Blocked`, with each conclusion linked to
   concrete evidence. Do not mark a draft ready, enable auto-merge, push, or
   merge from this skill.
