# Authentication and authoritative provisioning

EnterpriseGlue treats authentication, provisioning, and authorization as
separate trust decisions.

| Decision | Authority | EnterpriseGlue responsibility |
|---|---|---|
| Who proved the user's identity? | Local credentials, OIDC, SAML, or LDAP | Validate the authentication protocol and create a session |
| Should the account exist and be active? | Local administration, JIT sign-in, LDAP reconciliation, or SCIM 2.0 | Persist lifecycle state, preserve history, and invalidate sessions immediately when access is withdrawn |
| What may the user do? | EnterpriseGlue groups, roles, policies, and scoped assignments | Evaluate effective access and retain source lineage |

SCIM is not a login method. A user can be provisioned by SCIM and authenticate
through OIDC or SAML. The durable SCIM link continues to own synchronized
profile and lifecycle fields after the authentication source changes.

## Ownership rules

- The authoritative directory owns synchronized email, name, display-name,
  active-state, and directory-group membership fields.
- EnterpriseGlue owns sessions, recovery controls, product roles, scoped
  permissions, authored resources, and audit history.
- Directory groups do not grant product access by name. A SCIM group is
  projected to an EnterpriseGlue group only when its associated sign-in
  provider has exactly one active, exact identity mapping for the SCIM
  `externalId` or `displayName`.
- Identity mappings and SCIM groups cannot target the Platform Administrators
  system group. Privileged recovery and platform-administrator membership uses
  the dedicated, authorized, confirmed, and audited local workflow.
- Manual, API, configuration, and other-provider assignments are not removed
  when SCIM removes a directory-owned membership.
- `active=false` and SCIM `DELETE /Users/{id}` are soft deprovisioning. They
  deactivate the account, advance the authentication-session version, revoke
  refresh sessions, and remove directory-owned access while preserving user
  identity, resources, audit history, and non-directory assignments.
- Reactivation reuses the same user and SCIM link. It does not create a second
  account.

## Existing-account linking

Email alone is never sufficient to link an existing account.

EnterpriseGlue can reuse an existing account during SCIM creation only when:

1. the provisioning directory is associated with a configured identity
   provider;
2. that provider already has an active external-identity link to the exact
   existing account; and
3. the account is not a local recovery administrator.

Otherwise SCIM returns `409 uniqueness` and makes no account or access change.
This fail-closed rule prevents an untrusted directory client from taking over a
local account merely by asserting the same email address.

## Recovery administration

A recovery administrator is an active local-password user with effective
Platform Administrator membership. Recovery administrators are excluded from
automatic SCIM linking. EnterpriseGlue also rejects deactivation of the last
active local recovery administrator.

## OSS behavior

Provisioning is disabled until an administrator creates or applies a directory
record. OSS supports multiple sign-in providers and one active authoritative
SCIM directory per tenant. The feature appears under **Platform settings →
Identity and access → Provisioning**; it does not create an Enterprise menu.

See also:

- [Configure SCIM provisioning](../how-to/configure-scim-provisioning.md)
- [Operate user lifecycle and provisioning](../how-to/operate-identity-lifecycle.md)
- [SCIM and user-lifecycle API](../reference/scim-and-user-lifecycle-api.md)
- [ADR 0003](../architecture/decisions/0003-separate-authentication-and-authoritative-provisioning.md)

## Standards and market alignment

The implementation profile is grounded in primary specifications and the
published behavior of common enterprise directory clients:

- [RFC 7643](https://www.rfc-editor.org/rfc/rfc7643) defines stable
  service-provider IDs, provisioning-domain `externalId` values, and the User
  and Group schemas.
- [RFC 7644](https://www.rfc-editor.org/rfc/rfc7644) defines discovery,
  filtering, ListResponse, PATCH, ETags, conditional mutation, and SCIM error
  behavior.
- [Microsoft Entra's SCIM endpoint guidance](https://learn.microsoft.com/en-us/entra/identity/app-provisioning/use-scim-to-provision-users-and-groups)
  documents the client operations, empty ListResponse connection probe,
  `application/scim+json`, group uniqueness expectations, and its 25
  requests-per-second gallery-readiness baseline.
- [Okta's SCIM lifecycle guidance](https://developer.okta.com/docs/concepts/scim/)
  treats `active=false` as deprovisioning and `active=true` as reprovisioning.
- [GitHub's enterprise SCIM lifecycle guidance](https://docs.github.com/en/enterprise-cloud@latest/admin/managing-iam/provisioning-user-accounts-with-scim/deprovisioning-and-reinstating-users)
  demonstrates the established enterprise pattern of suspending access while
  retaining the account and supporting controlled reinstatement.

EnterpriseGlue's OSS profile supports private/custom Entra, Okta, and
provider-neutral SCIM 2.0 integrations with either the reveal-once static
bearer credential or an OAuth 2.0 client-credentials exchange. OAuth access
tokens are short lived and remain bound to the credential's one directory.
Bounded Bulk, deterministic sorting, and write-only password interoperability
are implemented. Password input is deliberately discarded: SCIM never creates
or changes a local EnterpriseGlue password, and discovery continues to
advertise `changePassword.supported: false`.

This standards support is not a claim of Microsoft Entra gallery
certification. Gallery publication also requires Microsoft review, support and
commercial onboarding work, plus validation against a real tenant; those
external activities cannot be proven by the OSS repository or local emulators.
