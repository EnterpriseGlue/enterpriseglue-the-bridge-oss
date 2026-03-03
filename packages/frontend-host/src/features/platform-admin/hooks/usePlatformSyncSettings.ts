import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../shared/api/client';

export interface PlatformSyncSettings {
  syncPushEnabled: boolean;
  syncPullEnabled: boolean;
  gitProjectTokenSharingEnabled: boolean;
  defaultDeployRoles: string[];
}

export function usePlatformSyncSettings() {
  return useQuery({
    queryKey: ['platform', 'sync-settings'],
    queryFn: () => apiClient.get<PlatformSyncSettings>('/api/auth/platform-settings'),
  });
}
