// Snapshot of the reserved platform groups that existed before migration 125.
// Keep historical migrations independent of the runtime group catalogue.
export const LEGACY_PLATFORM_GROUP_IDS = [
  'system.group.platform_administrators',
  'system.group.authenticated_users',
  'system.group.access_administrators',
  'system.group.access_auditors',
  'system.group.user_administrators',
  'system.group.sso_administrators',
  'system.group.engine_registry_administrators',
  'system.group.api_client_administrators',
];
