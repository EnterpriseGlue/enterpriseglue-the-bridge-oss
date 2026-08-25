---
name: enterpriseglue-documentation-governance
description: Route EnterpriseGlue documentation by audience and publication boundary before creating, moving, or reviewing it. Use for product requirements, roadmaps, decisions, UX material, implementation plans, technical architecture or deployment docs, customer guides, and documentation audits.
---

# EnterpriseGlue documentation governance

1. Classify every deliverable before selecting a target. Split mixed documents
   so each part follows its own publication boundary.
2. Keep internal product material outside every Git worktree, including private
   repositories. This includes product requirements and scope, roadmaps,
   product decisions, UX research and reviews, user journeys and mock-ups,
   product or program implementation plans, commercial and marketplace
   decisions, model or vendor evaluations, customer-specific findings, and
   future product proposals.
3. Resolve the internal product root from
   `ENTERPRISEGLUE_PRODUCT_DOCS_ROOT`. When it is unset, use the nearest
   discoverable non-Git EnterpriseGlue workspace `local-docs/product`
   directory. If neither destination can be resolved safely, do not write the
   internal document; report the missing local configuration.
4. Keep repository documentation limited to material primarily needed by
   developers, architects, operators, or maintainers: technical architecture
   and accepted ADRs, APIs and schemas, contributor guidance, deployment and
   configuration, security and operations, upgrades, compatibility, runbooks,
   and technical release notes. A technical implementation specification is
   repository-appropriate only when it is code-focused and contains no product
   priority, commercial, UX-research, or customer-specific material.
5. Target customer, end-user, and administrator documentation to the
   `enterpriseglue.ai` documentation CMS. When publishing is unavailable,
   stage the draft below the internal product root in
   `customer-docs-staging/<topic>` and mark it unpublished. Never use a source
   repository as the staging area.
6. Before writing, determine whether the target is inside a Git worktree and
   verify that its classification permits that destination. Repository
   documentation must remain understandable without access to private product
   documents.
7. Before shipping, run the repository documentation-boundary guard when it is
   available and inspect changed Markdown and evidence files. Reroute policy
   violations before committing. Keep bulk screenshots and transient
   qualification evidence in CI or release artifacts rather than repository
   documentation.
8. Removing a document from a branch does not remove it from Git history,
   forks, or caches. Escalate already-published sensitive material for a
   separate security and history-remediation decision.
