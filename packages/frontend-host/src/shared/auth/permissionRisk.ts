export interface PermissionRisk {
  label: string;
  description: string;
}

export function getPermissionRiskForKey(key: string): PermissionRisk | null {
  if (key.includes('permanent-delete')) {
    return { label: 'Permanent delete', description: 'Can permanently remove records and should be assigned sparingly.' };
  }
  if (key.includes(':delete')) {
    return { label: 'Delete', description: 'Can delete business resources or runtime data.' };
  }
  if (
    (key.includes(':members:') && !key.endsWith(':view')) ||
    key.includes(':project-access:') ||
    key.includes(':delegate:') ||
    key.includes(':ownership:') ||
    key.includes(':authz:roles:manage') ||
    key.includes(':sso-assignments:manage')
  ) {
    return { label: 'Access control', description: 'Can change who has access to resources.' };
  }
  if (
    key.includes(':settings:manage') ||
    key.includes(':engine-registration:manage') ||
    key.includes(':variables:edit') ||
    key.includes(':environment:')
  ) {
    return { label: 'Sensitive operation', description: 'Can change sensitive platform, engine, or runtime settings.' };
  }
  return null;
}
