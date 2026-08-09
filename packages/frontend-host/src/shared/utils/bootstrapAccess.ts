export type BootstrapAccessTagType = 'purple' | 'gray';
export type BootstrapAccessValue = 'admin' | 'user';

const ACCESS_TAG_TYPES: Record<BootstrapAccessValue, BootstrapAccessTagType> = {
  admin: 'purple',
  user: 'gray',
};

const ACCESS_LABELS: Record<BootstrapAccessValue, string> = {
  admin: 'Platform Admin',
  user: 'Standard User',
};

const ACCESS_DESCRIPTIONS: Record<BootstrapAccessValue, string> = {
  admin: 'Initial platform administration access. Detailed permissions are managed through RBAC.',
  user: 'Standard platform account. Detailed permissions are managed through RBAC.',
};

function normalizeBootstrapAccess(candidate?: string | null): BootstrapAccessValue {
  return candidate === 'admin' ? 'admin' : 'user';
}

export function getBootstrapAccessTagType(candidate?: string | null): BootstrapAccessTagType {
  const key = normalizeBootstrapAccess(candidate);
  return ACCESS_TAG_TYPES[key] ?? 'gray';
}

export function getBootstrapAccessLabel(candidate?: string | null): string {
  const key = normalizeBootstrapAccess(candidate);
  return ACCESS_LABELS[key] ?? key;
}

export function getBootstrapAccessDescription(candidate?: string | null): string {
  const key = normalizeBootstrapAccess(candidate);
  return ACCESS_DESCRIPTIONS[key] ?? ACCESS_DESCRIPTIONS.user;
}
