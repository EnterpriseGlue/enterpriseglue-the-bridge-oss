export type PlatformRoleTagType = 'purple' | 'blue' | 'gray';

const ROLE_TAG_TYPES: Record<string, PlatformRoleTagType> = {
  admin: 'purple',
  developer: 'blue',
  user: 'gray',
};

const ROLE_LABELS: Record<string, string> = {
  admin: 'Platform Admin',
  developer: 'Developer',
  user: 'User',
};

export function getPlatformRoleTagType(role?: string | null): PlatformRoleTagType {
  const key = String(role || 'user');
  return ROLE_TAG_TYPES[key] ?? 'gray';
}

export function getPlatformRoleLabel(role?: string | null): string {
  const key = String(role || 'user');
  return ROLE_LABELS[key] ?? key;
}
