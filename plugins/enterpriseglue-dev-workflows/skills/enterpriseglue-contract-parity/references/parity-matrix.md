# Interface parity matrix

For every changed field, setting, or resource, inspect these surfaces:

1. Canonical shared schema and validation/defaults.
2. TypeORM entity, migration, repository/adapter, and database qualification.
3. Service behavior, authorization, audit, redaction, and rollback.
4. Actual HTTP registrations and generated OpenAPI operations, request/response
   schemas, errors, auth classification and cache behavior. Include bootstrap,
   public/auth-only, tenant-scoped and compatibility variants; administrative
   inventory endpoints do not substitute for frontend discovery. Require a
   source-to-generated-document regression test for the affected route family.
5. Headless JSON configuration, preview/diff/apply/export, and secret handling.
6. Portal create/edit/view behavior, config ownership, help text, and errors.
7. Example configuration and API payloads.
8. Developer, operator, upgrade, and user documentation.
9. Unit, integration, browser, compatibility, and negative tests.

Useful repository gates include:

- `pnpm run test:config-bundles`
- `pnpm run test:documentation-contracts`
- `pnpm run test:engine-tenancy:documentation`
- `pnpm run test:engine-tenancy:database-matrix`
- `pnpm run guard:authz-route-inventory`
- `pnpm run guard:plugin-api:current`
- `pnpm run guard:plugin-api:next`
