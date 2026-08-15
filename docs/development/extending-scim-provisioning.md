# Extending SCIM provisioning

Keep protocol, persistence, API, configuration, and UI changes aligned.

## Contract authorities

- SCIM schemas: `packages/shared/src/schemas/scim.ts`
- Provisioning administration schemas:
  `packages/shared/src/schemas/platform-admin/provisioning.ts`
- Source-aware user schemas:
  `packages/shared/src/schemas/platform-admin/user-directory.ts`
- OpenAPI registration: `packages/shared/src/schemas/openapi.ts`
- Persistence entities and migration:
  `packages/shared/src/infrastructure/persistence/entities/` and
  `1700000000111-add-identity-provisioning-foundation.ts`; federated-session
  logout lineage is added by `1700000000112-add-federated-session-lineage.ts`

Do not introduce route-local request or response schemas when a public
contract changes. Do not expose a token hash, resolved secret, raw protocol
body, unrestricted claim, or stack trace.

## Extension rules

1. Add a canonical Zod schema and inferred type.
2. Add database columns with portable types and non-null canonical identities
   for cross-database uniqueness.
3. Register the entity and migration in PostgreSQL, MySQL, SQL Server, Oracle,
   and Spanner adapters and both migration authorities.
4. Implement tenant-scoped service behavior in one transaction.
5. Register route authorization or an explicit SCIM credential exemption.
6. Add generated OpenAPI media types, security, headers, and stable errors.
7. Add configuration preview/diff/apply/export and secret-preflight behavior if
   the setting is headless-manageable.
8. Add typed frontend API use, source ownership, responsive behavior, and
   screenshot evidence for any portal surface.
9. Update operator, API, configuration, upgrade, and troubleshooting docs.

PATCH implementations must build a draft, validate every operation, and commit
once. A failed operation must leave the original resource and ETag unchanged.
All directory group access must continue through explicit identity mappings.

## Required tests

- schema and generated OpenAPI assertions;
- route authentication, authorization, media-type, validation, redaction, and
  stable-error tests;
- relational service tests for OAuth exchange/revocation, Bulk references,
  sorting, write-only password handling, create, link, conflict, filter,
  pagination, ETag, atomic PATCH, deactivation, session invalidation,
  reactivation, membership-source preservation, and recovery exclusion;
- migration/entity registration tests for every adapter;
- configuration round-trip and secret-preflight tests;
- HTTP-to-database SCIM protocol journeys;
- frontend unit, browser, keyboard, narrow, and screenshot-audit evidence.

Emulator or in-process protocol evidence must be labelled as such. It does not
prove a real customer tenant integration.
