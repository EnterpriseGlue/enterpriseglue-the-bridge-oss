/**
 * Platform Settings Service
 * Manages global platform configuration
 */

import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { PlatformSettings } from '@enterpriseglue/shared/infrastructure/persistence/entities/PlatformSettings.js';
import {
  AccessAuthorityModeSchema,
  EngineOnboardingModeSchema,
  EngineRuntimeAuthorizationModeSchema,
  ProjectEngineTargetPolicyModeSchema,
  type AccessAuthorityMode,
  type EngineOnboardingMode,
  type EngineRuntimeAuthorizationMode,
  type ProjectEngineTargetPolicyMode,
} from '@enterpriseglue/shared/schemas/platform-admin/platform-settings.js';
import { encrypt, isEncrypted, safeDecrypt } from '../encryption.js';

const DEFAULT_PII_SCOPES = ['processDetails', 'history', 'logs', 'errors', 'audit'];
export const DEFAULT_ENGINE_ONBOARDING_MODE: EngineOnboardingMode = 'manual_allowed';
export const DEFAULT_PROJECT_ENGINE_TARGET_MODE: ProjectEngineTargetPolicyMode = 'manual_allowed';
export const DEFAULT_ACCESS_AUTHORITY_MODE: AccessAuthorityMode = 'manual';
export const DEFAULT_ENGINE_RUNTIME_AUTHORIZATION_MODE: EngineRuntimeAuthorizationMode = 'enterpriseglue_authoritative';

export function normalizeEngineOnboardingMode(value: unknown): EngineOnboardingMode {
  const parsed = EngineOnboardingModeSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_ENGINE_ONBOARDING_MODE;
}

export function normalizeProjectEngineTargetMode(value: unknown): ProjectEngineTargetPolicyMode {
  const parsed = ProjectEngineTargetPolicyModeSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_PROJECT_ENGINE_TARGET_MODE;
}

export function normalizeAccessAuthorityMode(value: unknown): AccessAuthorityMode {
  const parsed = AccessAuthorityModeSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_ACCESS_AUTHORITY_MODE;
}

export function normalizeEngineRuntimeAuthorizationMode(value: unknown): EngineRuntimeAuthorizationMode {
  const parsed = EngineRuntimeAuthorizationModeSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_ENGINE_RUNTIME_AUTHORIZATION_MODE;
}

export interface PlatformSettingsData {
  defaultEnvironmentTagId: string | null;
  syncPushEnabled: boolean;
  syncPullEnabled: boolean;
  gitProjectTokenSharingEnabled: boolean;
  defaultDeployRoles: string[];
  engineOnboardingMode: EngineOnboardingMode;
  projectEngineTargetMode: ProjectEngineTargetPolicyMode;
  engineAccessAuthority: AccessAuthorityMode;
  projectAccessAuthority: AccessAuthorityMode;
  engineRuntimeAuthorizationMode: EngineRuntimeAuthorizationMode;
  credentiallessCustomerSidecarsEnabled: boolean;
  inviteAllowAllDomains: boolean;
  inviteAllowedDomains: string[];
  ssoAutoRedirectSingleProvider: boolean;
  ssoAllEnginesAssignmentMappingsEnabled: boolean;
  ssoEngineOwnerAssignmentMappingsEnabled: boolean;
  ssoEngineDelegateAssignmentMappingsEnabled: boolean;
  ssoRegexClaimMappingsEnabled: boolean;
  ssoSecretViewMappingsEnabled: boolean;
  ssoUnredactedAuditMappingsEnabled: boolean;
  ssoPermanentDeleteMappingsEnabled: boolean;
  piiRegexEnabled: boolean;
  piiExternalProviderEnabled: boolean;
  piiExternalProviderType: string | null;
  piiExternalProviderEndpoint: string | null;
  piiExternalProviderAuthHeader: string | null;
  piiExternalProviderAuthToken: string | null;
  piiExternalProviderProjectId: string | null;
  piiExternalProviderRegion: string | null;
  piiRedactionStyle: string;
  piiScopes: string[];
  piiMaxPayloadSizeBytes: number;
}

export class PlatformSettingsService {
  private readonly DEFAULT_ID = 'default';

  /**
   * Get platform settings
   */
  async get(): Promise<PlatformSettingsData> {
    const dataSource = await getDataSource();
    const settingsRepo = dataSource.getRepository(PlatformSettings);
    const settings = await settingsRepo.findOneBy({ id: this.DEFAULT_ID });

    if (!settings) {
      // Return defaults
      return {
        defaultEnvironmentTagId: null,
        syncPushEnabled: true,
        syncPullEnabled: false,
        gitProjectTokenSharingEnabled: false,
        defaultDeployRoles: ['owner', 'delegate', 'operator'],
        engineOnboardingMode: DEFAULT_ENGINE_ONBOARDING_MODE,
        projectEngineTargetMode: DEFAULT_PROJECT_ENGINE_TARGET_MODE,
        engineAccessAuthority: DEFAULT_ACCESS_AUTHORITY_MODE,
        projectAccessAuthority: DEFAULT_ACCESS_AUTHORITY_MODE,
        engineRuntimeAuthorizationMode: DEFAULT_ENGINE_RUNTIME_AUTHORIZATION_MODE,
        credentiallessCustomerSidecarsEnabled: false,
        inviteAllowAllDomains: true,
        inviteAllowedDomains: [],
        ssoAutoRedirectSingleProvider: false,
        ssoAllEnginesAssignmentMappingsEnabled: true,
        ssoEngineOwnerAssignmentMappingsEnabled: false,
        ssoEngineDelegateAssignmentMappingsEnabled: false,
        ssoRegexClaimMappingsEnabled: false,
        ssoSecretViewMappingsEnabled: false,
        ssoUnredactedAuditMappingsEnabled: false,
        ssoPermanentDeleteMappingsEnabled: false,
        piiRegexEnabled: false,
        piiExternalProviderEnabled: false,
        piiExternalProviderType: null,
        piiExternalProviderEndpoint: null,
        piiExternalProviderAuthHeader: null,
        piiExternalProviderAuthToken: null,
        piiExternalProviderProjectId: null,
        piiExternalProviderRegion: null,
        piiRedactionStyle: '<TYPE>',
        piiScopes: [...DEFAULT_PII_SCOPES],
        piiMaxPayloadSizeBytes: 262144,
      };
    }

    return {
      defaultEnvironmentTagId: settings.defaultEnvironmentTagId,
      syncPushEnabled: settings.syncPushEnabled,
      syncPullEnabled: settings.syncPullEnabled,
      gitProjectTokenSharingEnabled: (settings as any).gitProjectTokenSharingEnabled ?? false,
      defaultDeployRoles: JSON.parse(settings.defaultDeployRoles),
      engineOnboardingMode: normalizeEngineOnboardingMode((settings as any).engineOnboardingMode),
      projectEngineTargetMode: normalizeProjectEngineTargetMode((settings as any).projectEngineTargetMode),
      engineAccessAuthority: normalizeAccessAuthorityMode((settings as any).engineAccessAuthority),
      projectAccessAuthority: normalizeAccessAuthorityMode((settings as any).projectAccessAuthority),
      engineRuntimeAuthorizationMode: normalizeEngineRuntimeAuthorizationMode((settings as any).engineRuntimeAuthorizationMode),
      credentiallessCustomerSidecarsEnabled: (settings as any).credentiallessCustomerSidecarsEnabled ?? false,
      inviteAllowAllDomains: (settings as any).inviteAllowAllDomains ?? true,
      inviteAllowedDomains: (() => {
        try {
          return JSON.parse(String((settings as any).inviteAllowedDomains || '[]'));
        } catch {
          return [];
        }
      })(),
      ssoAutoRedirectSingleProvider: (settings as any).ssoAutoRedirectSingleProvider ?? false,
      ssoAllEnginesAssignmentMappingsEnabled: (settings as any).ssoAllEnginesAssignmentMappingsEnabled ?? true,
      ssoEngineOwnerAssignmentMappingsEnabled: (settings as any).ssoEngineOwnerAssignmentMappingsEnabled ?? false,
      ssoEngineDelegateAssignmentMappingsEnabled: (settings as any).ssoEngineDelegateAssignmentMappingsEnabled ?? false,
      ssoRegexClaimMappingsEnabled: (settings as any).ssoRegexClaimMappingsEnabled ?? false,
      ssoSecretViewMappingsEnabled: (settings as any).ssoSecretViewMappingsEnabled ?? false,
      ssoUnredactedAuditMappingsEnabled: (settings as any).ssoUnredactedAuditMappingsEnabled ?? false,
      ssoPermanentDeleteMappingsEnabled: (settings as any).ssoPermanentDeleteMappingsEnabled ?? false,
      piiRegexEnabled: (settings as any).piiRegexEnabled ?? false,
      piiExternalProviderEnabled: (settings as any).piiExternalProviderEnabled ?? false,
      piiExternalProviderType: (settings as any).piiExternalProviderType ?? null,
      piiExternalProviderEndpoint: (settings as any).piiExternalProviderEndpoint ?? null,
      piiExternalProviderAuthHeader: (settings as any).piiExternalProviderAuthHeader ?? null,
      piiExternalProviderAuthToken: null,
      piiExternalProviderProjectId: (settings as any).piiExternalProviderProjectId ?? null,
      piiExternalProviderRegion: (settings as any).piiExternalProviderRegion ?? null,
      piiRedactionStyle: (settings as any).piiRedactionStyle ?? '<TYPE>',
      piiScopes: (() => {
        try {
          return JSON.parse(String((settings as any).piiScopes || '[]'));
        } catch {
          return [...DEFAULT_PII_SCOPES];
        }
      })(),
      piiMaxPayloadSizeBytes: Number((settings as any).piiMaxPayloadSizeBytes ?? 262144),
    };
  }

  /**
   * Get platform settings including decrypted secrets (internal use only)
   */
  async getWithSecrets(): Promise<PlatformSettingsData> {
    const dataSource = await getDataSource();
    const settingsRepo = dataSource.getRepository(PlatformSettings);
    const settings = await settingsRepo.findOneBy({ id: this.DEFAULT_ID });
    if (!settings) return this.get();

    const base = await this.get();
    const token = (settings as any).piiExternalProviderAuthToken ?? null;
    return {
      ...base,
      piiExternalProviderAuthToken: token ? safeDecrypt(String(token)) : null,
    };
  }

  /**
   * Update platform settings
   */
  async update(
    data: Partial<{
      defaultEnvironmentTagId: string | null;
      syncPushEnabled: boolean;
      syncPullEnabled: boolean;
      gitProjectTokenSharingEnabled: boolean;
      defaultDeployRoles: string[];
      engineOnboardingMode: EngineOnboardingMode;
      projectEngineTargetMode: ProjectEngineTargetPolicyMode;
      engineAccessAuthority: AccessAuthorityMode;
      projectAccessAuthority: AccessAuthorityMode;
      engineRuntimeAuthorizationMode: EngineRuntimeAuthorizationMode;
      credentiallessCustomerSidecarsEnabled: boolean;
      inviteAllowAllDomains: boolean;
      inviteAllowedDomains: string[];
      ssoAutoRedirectSingleProvider: boolean;
      ssoAllEnginesAssignmentMappingsEnabled: boolean;
      ssoEngineOwnerAssignmentMappingsEnabled: boolean;
      ssoEngineDelegateAssignmentMappingsEnabled: boolean;
      ssoRegexClaimMappingsEnabled: boolean;
      ssoSecretViewMappingsEnabled: boolean;
      ssoUnredactedAuditMappingsEnabled: boolean;
      ssoPermanentDeleteMappingsEnabled: boolean;
      piiRegexEnabled: boolean;
      piiExternalProviderEnabled: boolean;
      piiExternalProviderType: string | null;
      piiExternalProviderEndpoint: string | null;
      piiExternalProviderAuthHeader: string | null;
      piiExternalProviderAuthToken: string | null;
      piiExternalProviderProjectId: string | null;
      piiExternalProviderRegion: string | null;
      piiRedactionStyle: string;
      piiScopes: string[];
      piiMaxPayloadSizeBytes: number;
    }>,
    updatedById: string
  ): Promise<void> {
    const dataSource = await getDataSource();
    const settingsRepo = dataSource.getRepository(PlatformSettings);
    const now = Date.now();

    // Prepare update data
    const updateData: Record<string, any> = {
      updatedAt: now,
      updatedById,
    };

    if (data.defaultEnvironmentTagId !== undefined) {
      updateData.defaultEnvironmentTagId = data.defaultEnvironmentTagId;
    }
    if (data.syncPushEnabled !== undefined) {
      updateData.syncPushEnabled = data.syncPushEnabled;
    }
    if (data.syncPullEnabled !== undefined) {
      updateData.syncPullEnabled = data.syncPullEnabled;
    }
    if (data.gitProjectTokenSharingEnabled !== undefined) {
      updateData.gitProjectTokenSharingEnabled = data.gitProjectTokenSharingEnabled;
    }
    if (data.defaultDeployRoles !== undefined) {
      updateData.defaultDeployRoles = JSON.stringify(data.defaultDeployRoles);
    }
    if (data.engineOnboardingMode !== undefined) {
      updateData.engineOnboardingMode = data.engineOnboardingMode;
    }
    if (data.projectEngineTargetMode !== undefined) {
      updateData.projectEngineTargetMode = data.projectEngineTargetMode;
    }
    if (data.engineAccessAuthority !== undefined) {
      updateData.engineAccessAuthority = data.engineAccessAuthority;
    }
    if (data.projectAccessAuthority !== undefined) {
      updateData.projectAccessAuthority = data.projectAccessAuthority;
    }
    if (data.engineRuntimeAuthorizationMode !== undefined) {
      updateData.engineRuntimeAuthorizationMode = data.engineRuntimeAuthorizationMode;
    }
    if (data.credentiallessCustomerSidecarsEnabled !== undefined) {
      updateData.credentiallessCustomerSidecarsEnabled = data.credentiallessCustomerSidecarsEnabled;
    }
    if (data.inviteAllowAllDomains !== undefined) {
      updateData.inviteAllowAllDomains = data.inviteAllowAllDomains;
    }
    if (data.inviteAllowedDomains !== undefined) {
      updateData.inviteAllowedDomains = JSON.stringify(data.inviteAllowedDomains);
    }
    if (data.ssoAutoRedirectSingleProvider !== undefined) {
      updateData.ssoAutoRedirectSingleProvider = data.ssoAutoRedirectSingleProvider;
    }
    if (data.ssoAllEnginesAssignmentMappingsEnabled !== undefined) {
      updateData.ssoAllEnginesAssignmentMappingsEnabled = data.ssoAllEnginesAssignmentMappingsEnabled;
    }
    if (data.ssoEngineOwnerAssignmentMappingsEnabled !== undefined) {
      updateData.ssoEngineOwnerAssignmentMappingsEnabled = data.ssoEngineOwnerAssignmentMappingsEnabled;
    }
    if (data.ssoEngineDelegateAssignmentMappingsEnabled !== undefined) {
      updateData.ssoEngineDelegateAssignmentMappingsEnabled = data.ssoEngineDelegateAssignmentMappingsEnabled;
    }
    if (data.ssoRegexClaimMappingsEnabled !== undefined) {
      updateData.ssoRegexClaimMappingsEnabled = data.ssoRegexClaimMappingsEnabled;
    }
    if (data.ssoSecretViewMappingsEnabled !== undefined) {
      updateData.ssoSecretViewMappingsEnabled = data.ssoSecretViewMappingsEnabled;
    }
    if (data.ssoUnredactedAuditMappingsEnabled !== undefined) {
      updateData.ssoUnredactedAuditMappingsEnabled = data.ssoUnredactedAuditMappingsEnabled;
    }
    if (data.ssoPermanentDeleteMappingsEnabled !== undefined) {
      updateData.ssoPermanentDeleteMappingsEnabled = data.ssoPermanentDeleteMappingsEnabled;
    }
    if (data.piiRegexEnabled !== undefined) {
      updateData.piiRegexEnabled = data.piiRegexEnabled;
    }
    if (data.piiExternalProviderEnabled !== undefined) {
      updateData.piiExternalProviderEnabled = data.piiExternalProviderEnabled;
    }
    if (data.piiExternalProviderType !== undefined) {
      updateData.piiExternalProviderType = data.piiExternalProviderType;
    }
    if (data.piiExternalProviderEndpoint !== undefined) {
      updateData.piiExternalProviderEndpoint = data.piiExternalProviderEndpoint;
    }
    if (data.piiExternalProviderAuthHeader !== undefined) {
      updateData.piiExternalProviderAuthHeader = data.piiExternalProviderAuthHeader;
    }
    if (data.piiExternalProviderAuthToken !== undefined) {
      if (!data.piiExternalProviderAuthToken) {
        updateData.piiExternalProviderAuthToken = null;
      } else {
        updateData.piiExternalProviderAuthToken = isEncrypted(data.piiExternalProviderAuthToken)
          ? data.piiExternalProviderAuthToken
          : encrypt(data.piiExternalProviderAuthToken);
      }
    }
    if (data.piiExternalProviderProjectId !== undefined) {
      updateData.piiExternalProviderProjectId = data.piiExternalProviderProjectId;
    }
    if (data.piiExternalProviderRegion !== undefined) {
      updateData.piiExternalProviderRegion = data.piiExternalProviderRegion;
    }
    if (data.piiRedactionStyle !== undefined) {
      updateData.piiRedactionStyle = data.piiRedactionStyle;
    }
    if (data.piiScopes !== undefined) {
      updateData.piiScopes = JSON.stringify(data.piiScopes);
    }
    if (data.piiMaxPayloadSizeBytes !== undefined) {
      updateData.piiMaxPayloadSizeBytes = data.piiMaxPayloadSizeBytes;
    }

    // Check if record exists
    const existing = await settingsRepo.findOneBy({ id: this.DEFAULT_ID });

    if (!existing) {
      // Insert new record
      await settingsRepo.insert({
        id: this.DEFAULT_ID,
        defaultEnvironmentTagId: data.defaultEnvironmentTagId ?? null,
        syncPushEnabled: data.syncPushEnabled ?? true,
        syncPullEnabled: data.syncPullEnabled ?? false,
        gitProjectTokenSharingEnabled: data.gitProjectTokenSharingEnabled ?? false,
        defaultDeployRoles: JSON.stringify(data.defaultDeployRoles ?? ['owner', 'delegate', 'operator']),
        engineOnboardingMode: data.engineOnboardingMode ?? DEFAULT_ENGINE_ONBOARDING_MODE,
        projectEngineTargetMode: data.projectEngineTargetMode ?? DEFAULT_PROJECT_ENGINE_TARGET_MODE,
        engineAccessAuthority: data.engineAccessAuthority ?? DEFAULT_ACCESS_AUTHORITY_MODE,
        projectAccessAuthority: data.projectAccessAuthority ?? DEFAULT_ACCESS_AUTHORITY_MODE,
        engineRuntimeAuthorizationMode: data.engineRuntimeAuthorizationMode ?? DEFAULT_ENGINE_RUNTIME_AUTHORIZATION_MODE,
        credentiallessCustomerSidecarsEnabled: data.credentiallessCustomerSidecarsEnabled ?? false,
        inviteAllowAllDomains: data.inviteAllowAllDomains ?? true,
        inviteAllowedDomains: JSON.stringify(data.inviteAllowedDomains ?? []),
        ssoAutoRedirectSingleProvider: data.ssoAutoRedirectSingleProvider ?? false,
        ssoAllEnginesAssignmentMappingsEnabled: data.ssoAllEnginesAssignmentMappingsEnabled ?? true,
        ssoEngineOwnerAssignmentMappingsEnabled: data.ssoEngineOwnerAssignmentMappingsEnabled ?? false,
        ssoEngineDelegateAssignmentMappingsEnabled: data.ssoEngineDelegateAssignmentMappingsEnabled ?? false,
        ssoRegexClaimMappingsEnabled: data.ssoRegexClaimMappingsEnabled ?? false,
        ssoSecretViewMappingsEnabled: data.ssoSecretViewMappingsEnabled ?? false,
        ssoUnredactedAuditMappingsEnabled: data.ssoUnredactedAuditMappingsEnabled ?? false,
        ssoPermanentDeleteMappingsEnabled: data.ssoPermanentDeleteMappingsEnabled ?? false,
        piiRegexEnabled: data.piiRegexEnabled ?? false,
        piiExternalProviderEnabled: data.piiExternalProviderEnabled ?? false,
        piiExternalProviderType: data.piiExternalProviderType ?? null,
        piiExternalProviderEndpoint: data.piiExternalProviderEndpoint ?? null,
        piiExternalProviderAuthHeader: data.piiExternalProviderAuthHeader ?? null,
        piiExternalProviderAuthToken: data.piiExternalProviderAuthToken
          ? (isEncrypted(data.piiExternalProviderAuthToken)
            ? data.piiExternalProviderAuthToken
            : encrypt(data.piiExternalProviderAuthToken))
          : null,
        piiExternalProviderProjectId: data.piiExternalProviderProjectId ?? null,
        piiExternalProviderRegion: data.piiExternalProviderRegion ?? null,
        piiRedactionStyle: data.piiRedactionStyle ?? '<TYPE>',
        piiScopes: JSON.stringify(data.piiScopes ?? DEFAULT_PII_SCOPES),
        piiMaxPayloadSizeBytes: data.piiMaxPayloadSizeBytes ?? 262144,
        updatedAt: now,
        updatedById,
      });
    } else {
      // Update existing
      await settingsRepo.update({ id: this.DEFAULT_ID }, updateData);
    }
  }

  /**
   * Get the default deploy roles
   */
  async getDefaultDeployRoles(): Promise<string[]> {
    const settings = await this.get();
    return settings.defaultDeployRoles;
  }

  /**
   * Check if a role can deploy by default
   */
  async canRoleDeploy(role: string): Promise<boolean> {
    const deployRoles = await this.getDefaultDeployRoles();
    return deployRoles.includes(role);
  }
}

// Export singleton instance
export const platformSettingsService = new PlatformSettingsService();
