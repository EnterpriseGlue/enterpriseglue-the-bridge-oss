import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../shared/api/client';
import type { PublicPlatformSettings } from '@enterpriseglue/shared/schemas/platform-admin/platform-settings.js';

export type PlatformSyncSettings = PublicPlatformSettings;

export function usePlatformSyncSettings() {
  return useQuery({
    queryKey: ['platform', 'sync-settings'],
    queryFn: () => apiClient.get<PublicPlatformSettings>('/api/auth/platform-settings'),
  });
}
