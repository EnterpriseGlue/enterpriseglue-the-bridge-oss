---
name: enterpriseglue-ui-evidence
description: Capture, audit, and review EnterpriseGlue UI evidence. Use for /ui-evidence, Playwright screenshots, Carbon Design review, screenshot consistency, responsive or accessibility validation, visual regression evidence, or checking that identity, authorization, and engine-management flows are fully represented.
---

# EnterpriseGlue UI Evidence

1. Resolve the active worktree. Use `enterpriseglue-local-deploy` when the app
   is not already healthy; do not silently capture another worktree.
2. Read `references/evidence-matrix.md` and select every surface affected by the
   diff. Capture whole-page evidence at the standard `1440x900` MacBook-style
   viewport before adding narrow, zoom, or cross-browser variants.
3. Prefer stable Playwright fixtures and deterministic names. Capture the page
   heading, active tab, relevant controls, saved state, and result evidence;
   avoid cropped controls or screenshots that prove only navigation.
4. Run the bundled audit:

   ```bash
   node <skill-dir>/scripts/audit-screenshots.mjs <evidence-dir> \
     --width 1440 --height 900
   ```

5. Inspect every image visually. Check Carbon spacing, alignment, hierarchy,
   labels, button grouping, notifications, identifiers, disabled/config-owned
   states, empty/error/loading states, keyboard behavior, and readable copy.
6. Run affected browser, accessibility, 200% zoom/reflow, and responsive tests.
   Treat duplicate, wrong-size, blank, stale, or semantically incomplete
   screenshots as failed evidence.
7. Keep automated screenshots and transient qualification evidence in CI or
   release artifacts. Keep UX research, reviews, recommendations, journeys,
   and mock-ups in the internal product-documentation destination. Commit only
   small durable assets or technical reports required to explain or operate the
   shipped software.
8. Update the applicable evidence report and screenshots together in their
   approved destination. Report which flow and assertion each image proves.
