import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../shared/api/client';
import type { AccessAuthorityMode, EngineOnboardingMode, ProjectEngineTargetPolicyMode } from '../../../api/platform-admin';

export interface PlatformSyncSettings {
  syncPushEnabled: boolean;
  syncPullEnabled: boolean;
  gitProjectTokenSharingEnabled: boolean;
  defaultDeployRoles: string[];
  engineOnboardingMode: EngineOnboardingMode;
  projectEngineTargetMode: ProjectEngineTargetPolicyMode;
  engineAccessAuthority: AccessAuthorityMode;
  projectAccessAuthority: AccessAuthorityMode;
  ssoAllEnginesAssignmentMappingsEnabled: boolean;
  ssoEngineOwnerAssignmentMappingsEnabled: boolean;
  ssoEngineDelegateAssignmentMappingsEnabled: boolean;
  ssoRegexClaimMappingsEnabled: boolean;
  ssoSecretViewMappingsEnabled: boolean;
  ssoUnredactedAuditMappingsEnabled: boolean;
  ssoPermanentDeleteMappingsEnabled: boolean;
}

export function usePlatformSyncSettings() {
  return useQuery({
    queryKey: ['platform', 'sync-settings'],
    queryFn: () => apiClient.get<PlatformSyncSettings>('/api/auth/platform-settings'),
  });
}
