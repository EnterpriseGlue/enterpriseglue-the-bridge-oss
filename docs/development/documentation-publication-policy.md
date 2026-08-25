---
doc_class: technical
audience: developer, architect, operator, maintainer
publication: github
lifecycle: reference
---

# Documentation publication policy

EnterpriseGlue separates repository technical documentation, internal product
development material, and customer-facing documentation so each audience has a
clear source of truth.

## Repository documentation

GitHub repositories contain material primarily required to build, integrate,
deploy, secure, upgrade, or operate the shipped software:

- current technical architecture and accepted architecture decisions;
- API, MCP, schema, configuration, and extension contracts;
- contributor and developer guidance;
- deployment, security, operations, troubleshooting, and upgrade guides;
- compatibility, deprecation, and technical release notes.

A proposed technical specification may remain in the repository when it is
code-focused and contains no product priority, commercial, UX-research, or
customer-specific material. Repository documentation must stand on its own and
must not require access to private product documents.

New Markdown below `docs/` declares its boundary explicitly:

```yaml
---
doc_class: technical
audience: developer, operator
publication: github
lifecycle: as-built
---
```

Allowed audiences are `developer`, `architect`, `operator`, and `maintainer`.
Allowed lifecycle values are `proposed-technical`, `accepted`, `as-built`,
`reference`, and `release`.

## Internal product material

Product requirements and scope, roadmaps, product decisions, UX research and
reviews, user journeys and mock-ups, product or program implementation plans,
commercial decisions, model or vendor evaluations, customer-specific
findings, and future product proposals remain in the private Product Hub. They
must not be added to a source repository, including a private repository.

For local Codex work, configure `ENTERPRISEGLUE_PRODUCT_DOCS_ROOT` or use the
workspace's non-Git `local-docs/product` staging area. That local staging area
is not a replacement for an access-controlled, backed-up Product Hub.

## Customer documentation

Customer, end-user, and administrator documentation is published through the
`enterpriseglue.ai` documentation CMS. When the CMS is unavailable, keep the
draft in the Product Hub's `customer-docs-staging` area and record that it is
not yet published. Do not stage customer documentation in a source repository.

Deployment and operator documentation needed to run the software remains in
the repository; task-oriented product usage and onboarding belong in the CMS.

## UI evidence

Automated screenshots, accessibility output, and transient release
qualification evidence belong in CI or release artifacts. Durable diagrams or
small images needed to explain the shipped technical design belong under
`docs/assets`. UX research, design reviews, mock-ups, and recommendations stay
in the Product Hub.

## Enforcement

Run the deterministic guard before opening a pull request:

```bash
pnpm run guard:documentation-boundary -- --base-ref origin/main
```

The guard checks changed files only. It requires metadata for new repository
Markdown, rejects clear internal-product and customer-draft paths, and prevents
new transient evidence collections. Existing unclassified technical documents
are grandfathered until they are replaced or deliberately migrated.

The guard cannot confirm that an internal document was stored correctly or
that CMS publication occurred. Those cross-system checks remain part of the
authoring and review workflow.
