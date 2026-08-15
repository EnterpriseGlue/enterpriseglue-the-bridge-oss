# Operate user lifecycle and provisioning

## Read a user record

Open **Admin → User Management**, then **View details**. Treat the five tabs as
separate operational questions:

- **Overview**: status, authentication, provisioning, health, and field owner.
- **Linked identities**: immutable provider and directory links.
- **Effective access**: every group or role with its manual, API,
  configuration, provider-mapping, or directory-mapping source.
- **Sessions**: redacted source, times, IP address, and user-agent metadata.
- **Audit**: bounded lifecycle and sign-in outcomes.

`Provisioning: SCIM 2.0` never implies `Authentication: SCIM`. A user with no
login method remains unable to authenticate until OIDC, SAML, LDAP, or local
credentials are available.

## Deactivate and reactivate

- A directory should normally set `active=false` or delete its SCIM User.
- An administrator may use **Deactivate** for an emergency. A 3–500 character
  audit reason is required. Existing sessions are invalidated immediately.
- Reactivate directory-managed users in the authoritative directory. The
  portal deliberately disables local reactivation for those users.
- Locally managed users can be reactivated in EnterpriseGlue with an audit
  reason.
- Physical deletion remains a local-only retention action and is never a SCIM
  side effect.

## Rotate credentials

1. Open the directory's **Credentials** tab.
2. Rotate the current credential with a bounded overlap, no longer than 24
   hours.
3. Copy the replacement token from the reveal-once dialog into the provider.
4. Confirm `lastUsedAt` advances for the new fingerprint.
5. Revoke the old credential immediately after the provider cutover.

If a token might have leaked, use zero overlap and revoke it immediately.
Credential values and hashes must never appear in tickets, logs, screenshots,
configuration exports, or diagnostics.

## Audit events

Representative actions include:

| Action | Meaning |
|---|---|
| `identity.provisioning.directory.create|update|archive|test` | Directory administration |
| `identity.provisioning.credential.create|rotate|revoke` | Credential lifecycle; fingerprint only |
| `identity.provisioning.user.create|link|update|deactivate` | SCIM user lifecycle |
| `identity.provisioning.group.create|update|archive` | SCIM group and membership lifecycle |
| `identity.user.deactivate|reactivate|sessions.revoke` | Administrator lifecycle action with reason |

Provisioning Diagnostics retain sanitized request ID, resource type and ID,
status, code, message, and time. Raw request bodies, bearer tokens, password
material, unrestricted claims, and stack traces are not retained.

## Troubleshooting

| Symptom | Check | Safe response |
|---|---|---|
| Provider connection test fails | Directory active state and active credential count | Create/rotate a credential; do not paste it into logs |
| `401` from SCIM | Token format, fingerprint, expiry, overlap, revocation, URL key | Rotate if uncertain; generic errors intentionally hide which check failed |
| `409 uniqueness` on User | Existing email, associated IdP, verified external link | Associate the correct IdP or resolve the account conflict; do not delete history to bypass it |
| `412 invalidVers` | Stale ETag | Read the resource again and retry with its current ETag |
| Group exists but grants no access | Associated IdP and one active exact group Identity mapping | Create or correct the explicit mapping |
| User remains active after directory removal | Diagnostics event, link state, provider retries | Emergency-deactivate, then repair and replay the provider operation |
| User cannot be reactivated in portal | SCIM field ownership | Restore the directory assignment instead |

## Capacity and throttling

SCIM traffic has an isolated per-credential budget. Production defaults to
30,000 requests per 15-minute window (sustained 33 requests per second), which
exceeds the Microsoft Entra gallery-readiness baseline of 25 requests per
second per tenant. Set `EG_SCIM_RATE_LIMIT_MAX` only after capacity testing;
the value is the maximum request count in a 15-minute window. A limited client
receives `429 tooMany` and standard rate-limit response headers.

The OSS credential model supports a reveal-once, directory-bound static bearer
and OAuth 2.0 client-credentials exchange for short-lived access tokens. It is
compatible with private or non-gallery Entra and Okta SCIM integrations.
Microsoft gallery publication still requires external Microsoft validation,
support/commercial onboarding, and real-tenant certification; do not describe
the OSS connector as gallery-certified unless that separate work is complete.

## Recovery and retention

Continuously test one local recovery administrator in a separate browser
profile. Rotate its credential outside the SCIM system. Back up the database
before migration or rollback. Deactivated users, SCIM links, audit history, and
authored resources remain retained until an explicit local retention process
removes eligible data.

See [Upgrade identity provisioning](./upgrade-identity-provisioning.md) for
migration and rollback steps.
