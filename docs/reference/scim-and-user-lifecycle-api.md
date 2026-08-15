# SCIM and user-lifecycle API

Canonical Zod contracts live in
`packages/shared/src/schemas/scim.ts`,
`packages/shared/src/schemas/platform-admin/provisioning.ts`, and
`packages/shared/src/schemas/platform-admin/user-directory.ts`. Generated
OpenAPI is the machine-readable authority for request and response shapes.

## SCIM authentication and media type

The base path is `/scim/v2/{directoryKey}`. Use `application/scim+json` for
SCIM resources. A newly issued credential is revealed once and returns:

- `clientId`: the OAuth client identifier;
- `token`: the OAuth client secret and backward-compatible static bearer; and
- `tokenEndpointPath`: `/scim/v2/{directoryKey}/oauth/token`.

For OAuth 2.0 client credentials, send HTTP Basic credentials to the token
endpoint with form body `grant_type=client_credentials&scope=scim`. The
response is `Cache-Control: no-store` and contains a 300-second directory-
scoped bearer access token. Revoking or expiring the underlying credential
invalidates both new exchanges and already-issued access tokens immediately.
Body credentials are accepted for clients that cannot send Basic auth, but a
request must not mix the two mechanisms. Existing clients may continue to send
the reveal-once token directly as `Authorization: Bearer <token>`.

The token is bound to one directory and tenant. A tenant header cannot change
that scope. Failed credentials return a generic `401` with `WWW-Authenticate`;
responses never reveal whether a directory or credential ID exists.

## Discovery

| Method and path | Purpose |
|---|---|
| `GET /ServiceProviderConfig` | Supported capabilities and budgets |
| `GET /Schemas` and `GET /Schemas/{schemaId}` | User and Group schema discovery |
| `GET /ResourceTypes` and `GET /ResourceTypes/{resourceType}` | User and Group endpoint discovery |

## Resources

| Method and path | Behavior |
|---|---|
| `GET /Users` | Bounded list; equality filter on `userName` or `externalId` |
| `POST /Users` | Create a new account or safely reuse an already verified associated-provider account |
| `GET /Users/{id}` | Return one user and ETag |
| `PUT /Users/{id}` | Replace synchronized user attributes |
| `PATCH /Users/{id}` | Apply all supported operations atomically |
| `DELETE /Users/{id}` | Soft-deprovision; equivalent to setting `active=false` |
| `GET /Groups` | Bounded list; equality filter on `displayName` or `externalId` |
| `POST /Groups` | Create a directory group and optional explicit mapping projection |
| `GET /Groups/{id}` | Return one active group and ETag |
| `PUT /Groups/{id}` | Replace group attributes and membership atomically |
| `PATCH /Groups/{id}` | Add, replace, or remove membership atomically |
| `DELETE /Groups/{id}` | Archive the SCIM group and remove directory-owned access |
| `POST /Bulk` | Execute up to 50 ordered User/Group operations with prior `bulkId` references and `failOnErrors` |

Use `If-Match: W/"<version>"` on mutations. A stale version returns `412
invalidVers`. PATCH rejects unsupported or sensitive paths before committing
any operation.

List defaults are 1-based. `startIndex` is at least 1, `count` is at most 200,
and a group can contain at most 10,000 members. User results can sort by
`userName`, `externalId`, `displayName`, `active`, `meta.created`, or
`meta.lastModified`; Group results can sort by `displayName`, `externalId`, or
the two metadata timestamps. Unsupported sort paths fail with `invalidPath`.
Request bodies, including Bulk, are limited to 256 KiB. Unsupported or
over-complex filters fail with a sanitized SCIM error.

Clients may send the core User `password` attribute on create, replace, or
patch. EnterpriseGlue accepts it for provisioning interoperability, removes it
before persistence, never returns it, and never creates a local password from
it. Discovery marks the attribute `writeOnly`/`returned: never` while
`changePassword.supported` remains false.

## SCIM errors

Errors use `urn:ietf:params:scim:api:messages:2.0:Error`. Common statuses are:

| Status | `scimType` | Meaning |
|---:|---|---|
| 400 | `invalidSyntax`, `invalidPath`, `invalidFilter`, `invalidValue` | Invalid request contract |
| 401 | omitted | Missing, expired, revoked, or wrong-directory credential |
| 409 | `uniqueness` or `mutability` | Unsafe account collision or ambiguous immutable identity |
| 412 | `invalidVers` | Stale `If-Match` ETag |
| 413 | `tooMany` | Payload, result, or group-membership budget exceeded |

## Provisioning administration API

These routes use the authenticated EnterpriseGlue session and
`platform.sso.providers.read` or `platform.sso.providers.manage`:

- `GET|POST /api/identity/provisioning-directories`
- `GET|PUT|DELETE /api/identity/provisioning-directories/{key}`
- `POST /api/identity/provisioning-directories/{key}/test`
- `GET|POST /api/identity/provisioning-directories/{key}/credentials`
- `POST /api/identity/provisioning-directories/{key}/credentials/{credentialId}/rotate`
- `DELETE /api/identity/provisioning-directories/{key}/credentials/{credentialId}`
- `GET /api/identity/provisioning-directories/{key}/events`

Credential create and rotate return the client ID, client secret/static bearer,
and token endpoint exactly once. All later reads expose only name, status,
timestamps, and fingerprint.

There is no administrative “run” API because this release is a push SCIM
service provider; the directory client owns synchronization scheduling and
retries. There is no force-link conflict API. Unsafe collisions return `409`,
are visible through the events API, and can be resolved only by first creating
the verified external-identity link described in the setup guide. This keeps
resolution explicit and auditable without allowing an administrator to link
accounts based on email alone.

## Source-aware user API

| Route | Authorization | Result |
|---|---|---|
| `GET /api/users/directory` | `platform.users.read` | Filtered users with authentication, provisioning, access, sign-in, provisioned-at, and health summary |
| `GET /api/users/{id}/identity-context` | `platform.users.read` | Linked identities and field ownership |
| `GET /api/users/{id}/effective-access` | `platform.users.read` | Effective group/role lineage |
| `GET /api/users/{id}/sessions` | `platform.users.read` | Redacted refresh-session metadata |
| `GET /api/users/{id}/audit` | `platform.users.read` | Bounded lifecycle audit summary |
| `POST /api/users/{id}/deactivate` | `platform.users.deactivate` | Emergency deactivation and immediate session invalidation |
| `POST /api/users/{id}/reactivate` | `platform.users.update` | Reactivate a locally managed account only |
| `POST /api/users/{id}/revoke-sessions` | `platform.users.update` | Invalidate every current session |

Lifecycle mutation bodies require a 3–500 character `reason`, retained in the
administrator audit event. Existing compatible user routes remain available;
the source-aware routes are additive.
