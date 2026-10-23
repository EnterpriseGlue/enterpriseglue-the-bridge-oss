---
name: enterpriseglue-contract-parity
description: Verify that EnterpriseGlue portal controls, OpenAPI, public schemas, JSON configuration, TypeORM persistence, examples, and developer documentation stay aligned. Use for /contract-parity, headless configuration changes, engine registration, SSO settings, public API additions, schema updates, or suspected interface drift.
---

# EnterpriseGlue Contract Parity

1. Resolve the worktree and read `references/parity-matrix.md`.
2. Analyze the diff before editing:

   ```bash
   node <skill-dir>/scripts/check-contract-parity.mjs \
     --base-ref origin/main --strict
   ```

3. For HTTP changes, inventory the actual route registrations and frontend
   callers, including public/bootstrap, auth-only, tenant-scoped, and compatibility
   variants. Compare each method and resolved path with `generateOpenApi()` output;
   a similarly named administrative endpoint is not equivalent. Document request,
   response, authentication/authorization, tenant parameters, errors and cache
   behavior. Add a regression test that discovers the affected route family from
   source (using the backend route scanner where supported) and checks its
   generated operations and schemas. Explicitly inventory mounted, dynamic or
   array-based registrations the scanner cannot resolve. Authorization inventory
   success alone is insufficient: its strict action-route check does not require
   OpenAPI entries for public or auth-only exemptions. The diff helper is triage,
   not proof of route coverage.
4. Trace every new or changed setting end to end: canonical schema, validation,
   persistence, service/API, OpenAPI, JSON configuration, portal control and
   ownership state, examples, tests, and repository developer/operator
   documentation. Track customer, end-user, and administrator documentation as
   a separate `enterpriseglue.ai` CMS deliverable; never place its draft or
   internal product context in the source repository.
5. Keep TypeORM the persistence authority. Require migrations and adapter
   registration for durable schema changes; isolate genuinely database-specific
   SQL and qualify all supported adapters.
6. Run affected contract gates, including configuration-bundle, documentation,
   route/OpenAPI inventory, engine-tenancy documentation, database portability,
   and published plugin API compatibility.
7. Report each setting or resource as `aligned`, `not applicable`, or `gap`.
   Do not treat generated OpenAPI output alone as proof that implementation,
   examples, configuration ownership, repository technical documentation, and
   any required customer-documentation publication agree.
