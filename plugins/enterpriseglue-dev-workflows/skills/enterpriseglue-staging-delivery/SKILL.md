---
name: enterpriseglue-staging-delivery
description: Use when inspecting, reconciling, deploying, or troubleshooting EnterpriseGlue Cloud staging delivery, route capacity, candidate installation, Previous-release drain and retirement, or the staging default route.
---

# EnterpriseGlue staging delivery

1. Read `../../references/repository-lifecycle.json` and run the plugin-root
   lifecycle guard with `status` for inspection or `deploy` before any requested
   mutation. Work only in the active EnterpriseGlue Cloud repository. Never
   inspect or revive the retired EE repository as part of staging delivery.
2. Keep inspection read-only unless the user explicitly asked to deploy,
   reconcile capacity, drain, or retire. A request for status or explanation
   does not authorize workflow dispatches, tenant movement, route changes, or
   release retirement.
3. Report these identities separately and bind each to its evidence:
   published OSS version/tag/SHA; Cloud `main` SHA and protected CI; selected
   Cloud/OSS composition and signed image receipt; installed staging candidate;
   staging default/Stable route; non-default lifecycle and fallback deadline;
   production promotion. Never infer one state from another.
4. Inspect the latest `auto-deploy-staging.yml` capacity decision, any
   `supersede-staging-preview.yml` reconciliation, deployment artifact, shared
   mutation lock, route ConfigMap identity, and drain/retirement receipts. A
   successful protected no-op is a capacity disposition, not a failed release.
5. Treat the two-route gateway as a capacity boundary. An unused Candidate may
   be superseded only by the protected exact-reference workflow. Preview and
   Stable are never automatic retirement targets.
6. Previous may be reclaimed early only in staging, only when the protected
   `STAGING_FAST_DELIVERY_READY` value is exactly `true`, and only when the live
   control plane advertises the drain-preparation capability. Use the protected
   workflow; never synthesize tenant revisions, edit the database, delete
   Kubernetes resources directly, or bypass the sealed-drain authorization.
7. For an authorized Previous reconciliation, require the sequence: exact live
   classification, server-generated drain request, ordinary tenant
   return-to-current transitions, immutable sealed receipt, fresh route
   compare-and-set request, database retirement authorization, exact resource
   pruning, lock release, then intake redispatch. A failure retains the lock and
   requires the documented reviewed recovery path.
8. Keep `STAGING_FAST_DELIVERY_READY` false while the API/admin capability and
   workflow identity are being qualified. Enabling it authorizes future
   staging capacity pressure to move staging test tenants and retire Previous;
   it never shortens production's fallback window or authorizes production.
9. When asked to push a quick change, explain that targeted local checks happen
   during development, protected CI still verifies the proposed revision, and
   staging deployment remains separate from publication and merge. Do not call
   an OSS tag or passing CI “deployed.”
10. Finish with the exact current state, blocker or protected disposition, the
    next safe action, and whether that action is read-only, staging-mutating, or
    production-mutating.
