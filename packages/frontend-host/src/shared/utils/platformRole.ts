export type PlatformRoleTagType = 'purple' | 'gray';

const ROLE_TAG_TYPES: Record<string, PlatformRoleTagType> = {
  admin: 'purple',
  user: 'gray',
};

const ROLE_LABELS: Record<string, string> = {
  admin: 'Platform Admin',
  user: 'Standard User',
};

const ROLE_DESCRIPTIONS: Record<string, string> = {
  admin: 'Can manage users, settings, and SSO.',
  user: 'Standard workspace access only.',
};

function normalizePlatformRoleValue(role?: string | null): 'admin' | 'user' {
  return role === 'admin' ? 'admin' : 'user';
}

export function getPlatformRoleTagType(role?: string | null): PlatformRoleTagType {
  const key = normalizePlatformRoleValue(role);
  return ROLE_TAG_TYPES[key] ?? 'gray';
}

export function getPlatformRoleLabel(role?: string | null): string {
  const key = normalizePlatformRoleValue(role);
  return ROLE_LABELS[key] ?? key;
}

export function getPlatformRoleDescription(role?: string | null): string {
  const key = normalizePlatformRoleValue(role);
  return ROLE_DESCRIPTIONS[key] ?? ROLE_DESCRIPTIONS.user;
}
