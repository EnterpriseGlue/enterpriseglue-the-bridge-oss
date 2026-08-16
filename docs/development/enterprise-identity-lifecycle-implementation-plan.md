# Enterprise identity lifecycle implementation plan

Status: implementation complete; local source-image and published-image qualification passed  
Owner: EnterpriseGlue OSS  
Last updated: 2026-08-15

## Objective

Bring EnterpriseGlue's public authentication, identity administration, and
user lifecycle to the expected standard for enterprise developer tools while
keeping the OSS experience complete and provider-neutral.

The finished implementation must align all of the following surfaces:

- Carbon-based public authentication and administrative workflows;
- OIDC, SAML, LDAP, and SCIM identity behavior;
- canonical shared schemas and generated OpenAPI;
- TypeORM persistence and every supported database adapter;
- REST and headless JSON configuration interfaces;
- source-aware portal controls and effective-access explanations;
- configuration, API, operator, developer, upgrade, and user documentation;
- unit, integration, protocol, browser, accessibility, compatibility, and
  negative test coverage; and
- deterministic screenshot evidence for every altered UI state.

Completion means every requirement and verification gate in this document has
authoritative passing evidence. Partial implementation, generated OpenAPI on
its own, or an emulator described as a real identity provider is not sufficient.

## Market-standard product model

EnterpriseGlue separates authentication from provisioning:

- OIDC and SAML authenticate users.
- LDAP can authenticate and perform bounded directory reconciliation.
- SCIM 2.0 provisions, updates, deactivates, and reactivates users and groups.
- The identity provider owns synchronized profile fields and directory group
  membership.
- EnterpriseGlue owns product roles, resource-scoped permissions, audit data,
  sessions, recovery controls, and authored resources.
- Deprovisioning blocks access immediately while preserving resources, audit
  history, and non-directory assignment records.
- Directory groups never grant privileged product access implicitly. An
  explicit identity mapping to an internal group or role remains required.

The initial OSS release supports one active authoritative provisioning
directory per tenant and multiple sign-in providers. Provisioning remains
disabled by default and does not introduce an Enterprise navigation group.

## Supported operating modes

| Mode | User creation | Profile and lifecycle owner | Administrative experience |
|---|---|---|---|
| Local authentication | EnterpriseGlue invitation | EnterpriseGlue | Invite, edit, deactivate, unlock, and credential recovery |
| SSO with JIT, no SCIM | First sign-in or explicit access grant | Mixed; refreshed at sign-in | Grant access; no claim of background directory authority |
| SSO with authoritative SCIM | IdP assignment | IdP for synchronized fields and lifecycle | Manual invitation is hidden; users are managed in the connected directory |
| LDAP directory | LDAP login and reconciliation | LDAP for directory identity | Existing bounded scheduled reconciliation remains available |
| Recovery administrator | Explicit local recovery configuration | EnterpriseGlue operations | Excluded from SCIM and normal IdP ownership; fully audited |

## Architecture decisions required before SCIM runtime work

- [x] Record an ADR that models `IdentityProvisioningDirectory` separately
  from `IdentityProvider` and allows an optional provider-key association.
- [x] Limit the first release to one active authoritative provisioning
  directory per tenant.
- [x] Define stable SCIM resource identity and collision rules. Email must not
  be the sole durable identifier.
- [x] Define synchronized versus application-owned profile fields.
- [x] Define directory-owned, mapping-owned, configuration-owned, API-owned,
  and manual assignment behavior.
- [x] Treat `active=false` and SCIM `DELETE` as soft deprovisioning. Physical
  deletion remains an explicit local-only retention operation.
- [x] Define reactivation as reuse of the same user and link records.
- [x] Define credential generation, hashing, secret references, rotation
  overlap, expiry, revocation, and redaction.
- [x] Define recovery-administrator eligibility, authentication requirements,
  exclusions, rotation, and audit behavior.
- [x] Define backward compatibility for local, JIT, LDAP, legacy user API, and
  existing configuration-bundle records.

## Phased delivery plan

### Phase 1: Carbon UI completion and evidence

Scope: the existing `fix/carbon-login-pattern-compliance` worktree.

- [x] Reuse the application header for public authentication and remove the
  duplicate panel logo.
- [x] Add responsive global navigation, skip navigation, semantic landmarks,
  and route focus entry.
- [x] Introduce grouped Platform settings navigation with OSS-safe visibility.
- [x] Move complex provider and mapping creation out of large modal dialogs.
- [x] Convert provider creation to Identity, Connection, Membership, and Review.
- [x] Constrain productive forms to a primary reading column.
- [x] Add persistent workflow actions and responsive workflow sizing.
- [x] Verify and, where necessary, fix atomic brand/navigation hydration.
- [x] Verify provider and mapping step focus, announcements, validation, and
  scroll restoration.
- [x] Add unsaved-change protection to local and global navigation exits.
- [x] Add persistent password requirements and field-level mismatch errors to
  password reset and invitation onboarding.
- [x] Resolve remaining button hierarchy, progress-label, status-semantic,
  terminology, sentence-case, and duplicate-action findings.
- [x] Capture stable desktop, narrow, 200% zoom, keyboard focus, error,
  configuration-owned, unsaved-exit, and saved-result evidence.
- [x] Audit and visually inspect every screenshot.

### Phase 2: Canonical lifecycle contracts and persistence

- [x] Add canonical shared provisioning-directory request, response, query,
  diagnostics, and credential metadata schemas.
- [x] Add canonical SCIM User, Group, ListResponse, PatchOp, Error,
  ServiceProviderConfig, Schema, ResourceType, and metadata schemas.
- [x] Add canonical user directory list, detail, identity context, effective
  access, sessions, audit summary, deactivate, reactivate, and revoke-session
  schemas.
- [x] Replace duplicated inline user route/OpenAPI schemas and all affected
  `z.unknown()` responses.
- [x] Add TypeORM entities for provisioning directories, credential hashes,
  SCIM user links, SCIM group links, and provisioning diagnostics.
- [x] Add uniqueness, tenant isolation, version, lifecycle, and archival
  constraints.
- [x] Register reversible migrations in every repository migration authority.
- [x] Qualify repositories and migrations on every supported database adapter.

### Phase 3: SCIM 2.0 service-provider API

Base path: `/scim/v2/{directoryKey}`. The authenticated credential binds the
request to the directory and tenant; callers cannot select a tenant header.

- [x] Implement `/ServiceProviderConfig`, `/Schemas`, and `/ResourceTypes`.
- [x] Implement create, retrieve, filter, paginate, replace, patch, and
  soft-deprovision for `/Users` and `/Users/{id}`.
- [x] Implement create, retrieve, filter, paginate, replace, patch membership,
  and archive for `/Groups` and `/Groups/{id}`.
- [x] Support the equality filters required by Microsoft Entra and common SCIM
  clients for `userName`, `externalId`, and `displayName`.
- [x] Support `application/scim+json`, SCIM error responses, ETags, and
  `If-Match` mutation safety.
- [x] Apply PATCH operations atomically and restore the original resource when
  any operation fails.
- [x] Support bounded `/Bulk` requests with ordered User/Group operations,
  prior-operation `bulkId` references, and `failOnErrors`.
- [x] Support deterministic User/Group sorting on the documented stable fields.
- [x] Accept SCIM User password input as write-only interoperability data,
  discard it before persistence, and continue to advertise password change as
  unsupported.
- [x] Add OAuth 2.0 client-credentials exchange with short-lived,
  directory-bound access tokens while preserving static bearer compatibility.
- [x] Add request-size, rate, page-size, filter-complexity, group-membership,
  and returned-result budgets.
- [x] Add constant-time credential validation, rotation overlap, expiry,
  revocation, last-used metadata, and complete secret redaction.

### Phase 4: Lifecycle, sessions, and authorization

- [x] Make provisioning create or link exactly one internal user.
- [x] Require fail-closed, auditable conflict resolution for unsafe
  existing-user matches: email alone returns `409`; the only supported
  resolution is an active external identity for the associated sign-in
  provider followed by a retried SCIM create. No force-link API exists.
- [x] Apply IdP-owned profile updates without overwriting application-owned
  fields.
- [x] Make `active=false` and SCIM DELETE deactivate the account, increment the
  authentication session version, revoke refresh tokens, and block all sign-in.
- [x] Remove only directory-owned memberships and preserve unrelated manual,
  configuration, API, or provider assignments.
- [x] Preserve authored resources, audit history, identity links, and dormant
  non-directory assignments during deactivation.
- [x] Reactivate the existing account without duplicate identity or data loss.
- [x] Reconcile SCIM group membership through explicit external-group mappings.
- [x] Remove directory-source membership immediately after group removal or
  deletion without deleting internally managed groups.
- [x] Add structured, redacted audit events for every credential, user, group,
  lifecycle, conflict, mapping, and session action.
- [x] Separate privileged platform-role assignment from routine user creation
  and require explicit authorization, confirmation, reason, and audit.
- [x] Add a separately configured, SCIM-excluded recovery administrator path.
- [x] Enforce conditional-access IP/CIDR conditions fail closed using trusted
  request context and require only verified OIDC/SAML assurance for MFA rules.
- [x] Persist verified provider subject/session lineage and implement OIDC
  back-channel/RP-initiated logout plus signed, correlated SAML single logout.

### Phase 5: Administrative APIs, OpenAPI, and headless configuration

- [x] Add provisioning-directory create, read, update, archive, test,
  credential-create, rotate, revoke, and event APIs.
- [x] Mark a server-initiated run API not applicable: SCIM is a push protocol
  and the directory client owns scheduling and retries.
- [x] Mark a force-link conflict API not applicable: unsafe matches are exposed
  as sanitized diagnostic events and resolve only through a verified provider
  subject, never an administrator email assertion.
- [x] Add source-aware user filtering and identity-context, effective-access,
  session, audit, deactivate, reactivate, and revoke-session APIs.
- [x] Preserve compatible existing user routes and document any deprecations.
- [x] Register canonical request, response, security, media-type, error, and
  authorization contracts in generated OpenAPI.
- [x] Add optional `identity-provisioning-directories.json` to configuration
  bundles.
- [x] Implement configuration preview, diff, apply, export, ownership,
  conflict, and secret-preflight behavior.
- [x] Accept and export only credential secret references; never export token
  values or hashes.
- [x] Keep the current bundle version backward compatible unless a reviewed
  breaking semantic change is unavoidable.
- [x] Add complete API and configuration examples.

### Phase 6: Source-aware User management

- [x] Add status, authentication source, provisioning source, effective
  platform access, last sign-in, last provisioned, and provisioning-health
  columns with responsive prioritization.
- [x] Add Overview, Linked identities, Effective access, Sessions, and Audit
  detail views.
- [x] Show source lineage for directory, mapping, configuration, API, and
  manual access.
- [x] Make IdP-owned fields read-only and provide a clear “Manage in directory”
  route.
- [x] Hide local password/reset/unlock controls for SSO-only accounts.
- [x] Retain local deactivate and revoke-session emergency controls.
- [x] In authoritative SCIM mode, replace manual invitation with a
  directory-managed banner and provisioning-settings link.
- [x] In JIT mode without SCIM, use “Grant access” terminology.
- [x] Keep local invitation behavior unchanged when no directory is configured.

### Phase 7: Documentation, examples, rollout, and release evidence

- [x] Architecture ADR and identity trust-boundary documentation.
- [x] SSO-versus-provisioning conceptual guide.
- [x] SCIM API and generated OpenAPI reference.
- [x] Microsoft Entra and provider-neutral SCIM setup examples.
- [x] Credential creation, rotation, expiry, and revocation runbook.
- [x] User lifecycle, field ownership, and access-lineage administrator guide.
- [x] Deactivation, reactivation, session, and retention behavior.
- [x] Existing-user link and conflict-resolution guide.
- [x] Headless bundle reference and examples.
- [x] Developer guide for supported attributes and protocol extension.
- [x] Audit-event reference and provisioning troubleshooting guide.
- [x] Upgrade, rollback, recovery-administrator, and data-retention guides.
- [x] Remove “SCIM deferred” wording only after all runtime gates pass.
- [x] Complete release-note fragment, compatibility classification, package
  impacts, migrations, validation evidence, limitations, and rollback.

## Interface parity matrix

Every new resource or changed setting must be marked `aligned`, `not
applicable`, or `gap` before completion.

| Surface | Provisioning directory | SCIM user/group | User directory UX | Status |
|---|---:|---:|---:|---|
| Canonical shared schema and defaults | Required | Required | Required | Aligned |
| TypeORM entity, migration, repository | Required | Required | Derived/joined | Aligned |
| Service, authorization, audit, rollback | Required | Required | Required | Aligned |
| REST routes and OpenAPI | Required | Required | Required | Aligned |
| Headless configuration parity | Required | Not applicable: runtime resources | Not applicable: derived view | Aligned |
| Portal create/edit/view and ownership | Required | Diagnostics | Required | Aligned |
| API and configuration examples | Required | Required | Required | Aligned |
| Developer/operator/upgrade/user docs | Required | Required | Required | Aligned |
| Unit/integration/browser/negative tests | Required | Required | Required | Aligned |

## Verification matrix

### Security and behavior scenarios

- [x] Allowed same-tenant provisioning succeeds.
- [x] Sibling-tenant and cross-tenant access fail closed.
- [x] Invalid directory, credential, filter, path, patch, external ID, group
  member, stale ETag, and oversized request fail with sanitized SCIM errors.
- [x] Concurrent duplicate creates produce exactly one internal identity.
- [x] A failed multi-operation PATCH leaves the original resource unchanged.
- [x] Deactivation immediately invalidates existing refresh and access sessions.
- [x] Removing an IdP entitlement removes only matching source-owned access.
- [x] Unrelated manual, API, configuration, and provider access is preserved.
- [x] Reactivation reuses the original account and links.
- [x] Recovery administrators cannot be linked, modified, or deactivated by
  SCIM.
- [x] Raw credentials, password material, and unrestricted claims never appear
  in API responses, OpenAPI examples, logs, audit payloads, or screenshots.
- [x] OAuth client-credentials tokens are short lived, directory scoped, and
  become unusable immediately when their credential expires or is revoked.
- [x] Bulk limits, sort paths, write-only password input, invalid grant/media
  types, and mixed Basic/body OAuth credentials fail with bounded,
  non-disclosing responses.
- [x] Missing/malformed IP context, unmatched conditional allow rules, and
  unverified MFA context fail closed.
- [x] OIDC logout tokens and SAML logout messages require verified signature,
  issuer/audience or destination, freshness, and session correlation before
  targeted revocation.

### Required repository gates

Run affected gates after each phase and the complete set before completion:

```text
pnpm run release-notes:preflight -- --base-ref origin/main
pnpm run test:authz:structure
pnpm run test:authz:pr
pnpm run test:identity:verify
pnpm run test:identity:protocol-rehearsal
pnpm run test:authz:browser
pnpm run test:authz:accessibility:cross-browser
pnpm run test:engine-tenancy:release-evidence
pnpm run test:engine-tenancy:database-matrix
pnpm run test:config-bundles
pnpm run test:documentation-contracts
pnpm run guard:authz-route-inventory
pnpm run guard:plugin-api:current
pnpm run guard:plugin-api:next
pnpm run test:deployment-evidence:local
```

SCIM protocol-emulator coverage must become part of
`test:identity:protocol-rehearsal`. Emulator evidence must remain explicitly
labelled and cannot be reported as a real-provider test.

### UI evidence requirements

Capture affected states at 1440 by 900 and add narrow, 200% zoom, keyboard,
screen-reader announcement, reduced-motion, loading, empty, invalid, error,
configuration-owned, conflict, and persisted-result variants.

Every screenshot must show enough surrounding context to identify the page,
active section, selected resource, relevant controls, action, and saved result.
Run the UI-evidence screenshot audit and inspect every image visually.

## End-to-end acceptance journey

1. An administrator creates a provisioning directory and receives a SCIM
   credential exactly once.
2. Microsoft Entra-compatible provisioning assigns Alice to EnterpriseGlue.
3. SCIM creates Alice without sending a local invitation.
4. The directory creates an Engineering group and adds Alice.
5. An explicit identity mapping grants the expected internal access.
6. Alice signs in through OIDC and is linked to the pre-provisioned account.
7. A directory profile update changes an IdP-owned field and the portal marks
   the field as directory-managed.
8. Directory unassignment deactivates Alice, revokes sessions, and removes
   directory-owned memberships without deleting resources or audit history.
9. Alice's existing session and new login are denied immediately.
10. Reassignment reactivates the same account and restores current
    directory-owned memberships without duplicate identity or lost history.

## Completion audit

### Verification record (2026-08-15)

| Scope | Result | Evidence |
|---|---:|---|
| Local identity aggregate | 571/571 passed | Contracts 165, routes 112, mapping matrix 91, protocol mocks 68, provisioning documentation 5, provisioning/SCIM/relational E2E 70, UI 60 |
| Browser identity lifecycle | 13 passed, 1 intentionally skipped | Mock/local browser identity lifecycle; live-backend LDAP case is covered by the container rehearsal |
| Containerized protocol rehearsal | 10/10 passed | SCIM HTTP/database 1, OIDC 3, Entra-compatible OIDC 3, signed SAML 1, LDAP 2 |
| Cross-browser accessibility | 51/51 passed | Seventeen scenarios each in Chromium, Firefox, and WebKit |
| Focused identity-administration accessibility | 36/36 passed | Twelve scenarios each in Chromium, Firefox, and WebKit, including keyboard reachability of the true workflow bottom and action-footer separation |
| Authorization layout | 1/1 passed | Tablet viewport and long permission labels |
| Database adapter matrix | 35/35 stages passed | PostgreSQL 18, MySQL, SQL Server, Oracle, and Spanner emulator each passed clean install, upgrade baselines, interrupted retry, schema equivalence, service behavior, rollback, and cleanup |
| Authorization structure and route inventory | Passed | 218/218 actions referenced, critical literal coverage 100%, 444/444 authenticated routes classified |
| Authorization PR suites | 125/125 passed | All code and database lanes, including randomized authorization, custom-role scope, and machine-principal parity, against a clean disposable PostgreSQL container |
| Configuration and documentation contracts | 185 and 28 passed | Configuration preview/diff/apply/export/secret behavior and operator/developer/reference contracts |
| TypeScript and production frontend | Passed | Backend, frontend, and frontend-host type checks; shared/frontend-host production build |
| Screenshot audit and visual inspection | 52/52 passed | Thirty-six 1440×900 desktop, fourteen 390×844 narrow, and two 720×450 200%-reflow screenshots; the added desktop captures prove the provider and mapping forms at their true scroll endpoints |
| Local source-image deployment | Passed | Backend and frontend were built from this exact worktree, launched through nginx at `http://127.0.0.1:18080`, reported healthy, exposed generated OpenAPI, and passed real cookie/CSRF login, refresh, logout, browser, and accessibility checks |
| Published Docker Hub deployment | Passed | The image-only Compose overlay pulled both public multi-architecture images from `haryenterpriseglue`, disabled inherited local builds, and passed the same-origin authentication smoke journey without fallback |
| Engine-tenancy release index | Diagnostic only | The complete five-database matrix passed from the dirty development worktree; release qualification is intentionally deferred until the implementation is committed and has a same-commit CI evidence bundle |

Fixtures are explicitly classified: Keycloak, OpenLDAP, the Entra-compatible
Keycloak profile, and the SCIM client are disposable local emulators or
containers. No real customer IdP tenant was used, and the static-bearer or
OAuth-client-credentials SCIM profiles are not a Microsoft Entra gallery
certification claim.

Before declaring the plan complete:

- [x] Re-read every unchecked item in this document.
- [x] Inspect schemas, migrations, services, routes, OpenAPI, configuration,
  portal behavior, examples, documentation, tests, and screenshot artifacts.
- [x] Confirm the test and evidence scopes actually prove each requirement.
- [x] Record commands, versions, adapters, fixtures, artifacts, pass/fail
  counts, skipped lanes, limitations, and external-provider evidence separately.
- [x] Update every parity row from `Gap` to `Aligned` or a justified `Not
  applicable`.
- [x] Ensure no required item relies only on intent, a mock outside its stated
  scope, generated output, or a narrow test standing in for a broad claim.
