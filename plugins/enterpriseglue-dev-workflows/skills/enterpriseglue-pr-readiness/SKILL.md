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
7. Inspect current GitHub checks and their actual error text. Treat pending,
   advisory, skipped, and externally deferred evidence distinctly.
8. Report `Ready`, `Conditional`, or `Blocked`, with each conclusion linked to
   concrete evidence. Do not mark a draft ready, enable auto-merge, push, or
   merge from this skill.
