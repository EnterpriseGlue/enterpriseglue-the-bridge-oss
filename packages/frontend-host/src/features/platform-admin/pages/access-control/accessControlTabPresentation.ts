export const ACCESS_CONTROL_TAB_IDS = [
  'roles',
  'permissions',
  'assignments',
  'by_principal',
  'by_resource',
  'groups',
  'effective_access',
  'sso_mappings',
  'sso_engine_assignments',
  'engine_sets',
  'runtime_resources',
  'project_targets',
  'policies',
  'audit',
  'external_registration',
] as const;

export type AccessControlTabId = typeof ACCESS_CONTROL_TAB_IDS[number];

/** Reads tab links in either URL-friendly dashed or internal underscored form. */
export function accessControlTabFromSearchParams(searchParams: URLSearchParams): AccessControlTabId | null {
  const requestedTab = searchParams.get('tab')?.replace(/-/g, '_');
  return ACCESS_CONTROL_TAB_IDS.includes(requestedTab as AccessControlTabId)
    ? requestedTab as AccessControlTabId
    : null;
}
