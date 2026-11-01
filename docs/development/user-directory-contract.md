---
doc_class: technical
publication: github
lifecycle: as-built
audience: developer
---

# User directory presentation and action lifetime

The source-aware directory summary and effective-access response expose
`bootstrapAccess` (`admin` or `user`) as an informational account preset.
`UserDirectoryService` derives it from current platform-administrator group
membership, including membership expiry. It does not trust the legacy stored
user role. Compatibility response fields remain available to older clients.
Use the qualified shared/frontend/backend composition together: the current
browser directory client requires the explicit preset and validates the
canonical shared response schemas before presenting records.

Presentation data does not grant permissions. List/detail controls evaluate
action permission snapshots; server routes enforce the same action registry.
Locked accounts use the canonical directory status for their badge and unlock
eligibility; the summary does not need to expose legacy login counters. Unlock
still requires its action permission. User creation and profile updates keep
the existing canonical `role` request field. Profile edits submit only fields
changed from the opened record, so changing a name does not resend a stale
access preset or active flag and undo an intervening administrator change.
Status is read-only in profile editing. Use the reason-requiring lifecycle
actions in user details. The profile API accepts an unchanged compatibility
`isActive` echo, discards it before writing, and returns HTTP 409 for a status
transition. The profile service repeats that restriction and rejects SCIM/LDAP
profile overrides before writing. The compatibility `DELETE /api/users/{id}`
requires the same reason body and delegates to the audited deactivation service,
including self-deactivation and last-recovery-administrator checks. The legacy
browser helper requires an explicit reason and uses the canonical POST action.
Both SCIM and LDAP reactivation must be performed in the owning directory.
Global lifecycle audits use the existing server-created row-specific append
capability inside the owning transaction. The capability is revoked on
settlement; runtime RLS still rejects unbound or differently bound audit inserts.
Profile response timestamps are normalized to numbers at the DTO boundary.
In pooled mode a tenant-filtered query cannot prove that a global identity has
no provisioning owner in another tenant. Administrator profile-name editing is
therefore unavailable in pooled mode; update names through the authenticated
identity or provisioning provider. Manual access-preset changes remain separate.
No cross-tenant directory read capability or database-policy exception is added.

For example, submit a profile change as `PUT /api/users/{id}` with
`{"firstName":"Updated"}`. Submit a deactivation separately as
`POST /api/users/{id}/deactivate` with `{"reason":"Approved access removal"}`.
Directory-owned profiles, self-deactivation, last recovery-administrator
continuity, session revocation and audit-reason checks remain server concerns.
The frontend guard and its zero-compatibility baseline stay unchanged; screen
code contains no encoded legacy-field adapters or role-based permission gates.

Every directory response is bound to its requested user identifier. Detail
views remount when the route, actor, session or platform-permission snapshot
changes. Late loads, errors and issued mutation completions cannot overwrite,
notify through, reload or reuse a confirmation under the replacement view.
This suppresses stale UI completion; it does not cancel an already-issued
server write or authorize a retry. The list has stable hook ordering through
permission revocation and does not fetch rows solely for create permission.

Manual user creation requires a complete ownership result. The browser checks
up to the supported 200 active-directory records. An authoritative record blocks
manual creation; an incomplete page or read failure leaves ownership unknown,
with an explicit warning and no enabled manual-create action. This does not add
provisioning-read permission to a caller. Lifecycle writes still undergo the
server's independent ownership and permission checks.

Effective-access lineage retains expired and archived history, marking inherited
role assignments inactive when the user's group membership expired or the
group is archived. Direct role assignments remain evaluated separately.

## Local regression lanes

Focused tests cover API schema/identifier validation and real list/detail
components using permission snapshots. Backend service tests run against SQL.js
for development and the same cases against owned PostgreSQL:

```bash
bash scripts/run-native-tenancy-postgres-rls.sh --user-directory
```

The default PostgreSQL regression lane includes those service cases. These are
local contract/lifecycle checks, not live identity-provider, browser, SaaS
routing, tenant-isolation or exact-image acceptance.
