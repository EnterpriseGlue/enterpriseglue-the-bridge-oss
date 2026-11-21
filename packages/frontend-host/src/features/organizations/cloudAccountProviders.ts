import { apiClient } from '../../shared/api/client';

type CloudAccountProvider = { id: string; displayName: string; protocol: 'oidc' | 'saml' };

const preloadLifetime = 10_000;
let preload: { expiresAt: number; result: Promise<CloudAccountProvider[]> } | undefined;

function fetchProviders() {
  return apiClient.get<CloudAccountProvider[]>('/api/auth/cloud-signup/providers');
}

export function preloadCloudAccountProviders() {
  // The result is public and global. The session bootstrap can clear its own
  // data while this lookup is still in flight.
  const result = fetchProviders();
  preload = { expiresAt: Date.now() + preloadLifetime, result };
  void result.catch(() => undefined);
}

export function getCloudAccountProviders(fresh = false) {
  if (!fresh && preload && Date.now() < preload.expiresAt) return preload.result;
  preload = undefined;
  return fetchProviders();
}

export type { CloudAccountProvider };
