# ADR 0003: Separate Authentication from Authoritative Provisioning

Status: Accepted

Date: 2026-08-14

## Context

OIDC and SAML prove an identity during an interactive sign-in. They do not
provide a complete background user lifecycle. LDAP can authenticate and
perform bounded reconciliation, while SCIM 2.0 is the enterprise-standard
interface for creating, updating, deactivating, reactivating, and grouping
accounts outside a browser session.

Treating a sign-in provider as a provisioning directory would create unsafe
ambiguity around field ownership, deactivation, credentials, external IDs,
group membership, and recovery access. It would also prevent an organization
from pairing one SCIM directory with multiple sign-in providers.

## Decision

EnterpriseGlue models an `IdentityProvisioningDirectory` separately from an
`IdentityProvider`. A provisioning directory may optionally reference a
provider key to explain how a provisioned account later authenticates, but
neither resource owns or embeds the other.

The first OSS implementation has these invariants:

- at most one non-archived authoritative provisioning directory is enabled in
  a tenant;
- multiple OIDC, SAML, or LDAP sign-in providers remain supported;
- a SCIM credential is bound to exactly one directory and tenant, so the
  caller cannot select tenancy through a request header;
- credential values are generated once, stored only as hashes, displayed only
  at issuance or rotation, and never exported;
- credential rotation permits a bounded overlap window and supports explicit
  expiry and revocation;
- the durable SCIM identity is the directory-scoped SCIM resource ID and
  external ID; email is searchable profile data, not the sole identity key;
- one SCIM user link refers to exactly one existing internal user, and
  reactivation reuses that user and link;
- unsafe collisions with local or other-directory users require an explicit,
  audited conflict-resolution action;
- directory-owned fields are email, first name, last name, display name, and
  lifecycle state when present in SCIM; EnterpriseGlue continues to own
  platform roles, resource grants, sessions, audit history, recovery controls,
  and authored resources;
- directory group membership has no privileged effect until an explicit
  external-group mapping connects it to an EnterpriseGlue group or role;
- `active=false` and SCIM `DELETE` soft-deprovision the account, revoke its
  sessions, and remove only directory-owned memberships;
- physical user deletion is a separate, local retention operation and is not
  exposed through SCIM;
- a recovery administrator is explicitly configured, authenticates locally,
  is excluded from SCIM linking and lifecycle mutations, and has every use and
  configuration change audited; and
- existing local, JIT, LDAP, user API, and configuration-bundle behavior stays
  compatible when no provisioning directory is enabled.

Configuration bundles contain only credential secret references. The public
SCIM base path is `/scim/v2/{directoryKey}` and uses the SCIM media type,
errors, pagination, filters, patch semantics, and ETags defined by the shared
canonical schemas.

## Consequences

- Administrators can understand whether a user authenticates through SSO and
  whether a directory owns that user's lifecycle as two independent facts.
- SSO-only deployments keep JIT and explicit access-grant behavior without
  claiming background directory authority.
- Authoritative deployments hide manual invitation for directory-managed
  users and direct administrators to the connected directory.
- Deactivation remains recoverable and preserves resources and audit history.
- Services, persistence, REST, OpenAPI, configuration bundles, portal copy,
  tests, and documentation must preserve source lineage and the same ownership
  rules.
- Additional provisioning directories require a later compatibility decision
  for precedence and field ownership; the initial one-active-directory limit
  is deliberate rather than accidental.

## Verification

- canonical schema tests reject secret material, unbounded SCIM input, missing
  stable identities, and tenant selection by callers;
- migration and repository tests enforce directory, user-link, group-link,
  membership, and credential uniqueness on every supported database adapter;
- protocol tests cover SCIM discovery, filters, pagination, ETags, atomic
  PATCH, create/replace/deactivate/reactivate, and sanitized errors;
- lifecycle tests prove immediate session invalidation and source-selective
  membership removal; and
- browser tests prove source-aware user management and the recovery path.

## Related Documentation

- [Enterprise identity lifecycle implementation plan](../../development/enterprise-identity-lifecycle-implementation-plan.md)
- [OSS security and trust boundaries](../07-oss-security-and-trust-boundaries.md)
- [Authorization and access control model](../09-oss-authorization-access-control-model.md)
- [Configure SSO](../../how-to/auth-sso.md)
