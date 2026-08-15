# Upgrade identity provisioning

The identity-provisioning foundation adds six tables. Federated logout adds
three nullable, indexed lineage fields to existing refresh sessions. Neither
migration destructively changes users, identity providers, mappings, or
assignments.

## Before upgrade

1. Back up the database and verify restoration.
2. Confirm at least one active local recovery administrator.
3. Export the current configuration bundle and retain secret references in the
   external secret manager.
4. Disable external SCIM traffic until every application instance is upgraded.

## Migration

Migration `1700000000111-add-identity-provisioning-foundation` creates:

- `identity_provisioning_directories`
- `identity_provisioning_credentials`
- `scim_user_links`
- `scim_group_links`
- `scim_group_memberships`
- `identity_provisioning_diagnostics`

Migration `1700000000112-add-federated-session-lineage` adds
`provider_subject_id`, `provider_session_id`, and
`provider_name_id_format` to `refresh_tokens`, plus provider-subject and
provider-session indexes. New OIDC/SAML sessions populate these fields from
verified token/assertion evidence. Existing sessions remain locally revocable
and expire normally; provider-targeted logout applies to sessions that carry
the new lineage.

The migration is idempotent and reversible and uses portable non-null identity
columns for tenant/key, active-authority, user-name, external-ID, and membership
uniqueness. Run the normal EnterpriseGlue migration command, then verify the
application readiness endpoint and generated OpenAPI.

## After upgrade

- Provisioning remains off until a directory is created or applied.
- Existing local, JIT, OIDC, SAML, LDAP, and user API behavior remains
  compatible.
- Create a disabled pilot directory and a short-lived credential.
- Verify create, update, deactivate, denied-session, reactivate, and mapped
  group membership with test accounts before enabling broad assignment.

## Rollback

1. Stop SCIM client traffic and revoke all provisioning credentials.
2. Disable or archive configured directories through their owning channel.
3. Roll application instances back.
4. Keep the six new tables during an application-only rollback so identity and
   audit history remain available for a forward retry.
5. Run migration `down` only after a reviewed retention decision and a
   verified backup. Reverting `0112` removes logout lineage, and reverting
   `0111` removes all six provisioning tables and is therefore destructive.

Rollback does not restore sessions already invalidated by deprovisioning. Users
must authenticate again after access is deliberately restored.
