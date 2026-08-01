/**
 * Platform Settings Service
 * Manages global platform configuration
 */

import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { PlatformSettings } from '@enterpriseglue/shared/infrastructure/persistence/entities/PlatformSettings.js';
import { EngineBackstopSyncRun } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineBackstopSyncRun.js';
import {
  AccessGovernanceDriftStatusSchema,
  AccessAuthorityModeSchema,
  derivePlatformGovernanceBehavior,
  EngineOnboardingModeSchema,
  EngineRuntimeAuthorizationModeSchema,
  LocalPasswordLoginModeSchema,
  ProjectEngineTargetPolicyModeSchema,
  SsoProviderSelectionModeSchema,
  type AccessAuthorityMode,
  type AccessGovernanceDriftStatus,
  type EngineOnboardingMode,
  type EngineRuntimeAuthorizationMode,
  type LocalPasswordLoginMode,
  type PlatformGovernanceBehavior,
  type ProjectEngineTargetPolicyMode,
  type SsoProviderSelectionMode,
} from '@enterpriseglue/shared/schemas/platform-admin/platform-settings.js';
import { encrypt, isEncrypted, safeDecrypt } from '../encryption.js';
import type { DataSource, EntityManager } from 'typeorm';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';

const DEFAULT_PII_SCOPES = ['processDetails', 'history', 'logs', 'errors', 'audit'];
export const DEFAULT_ENGINE_ONBOARDING_MODE: EngineOnboardingMode = 'manual_allowed';
export const DEFAULT_PROJECT_ENGINE_TARGET_MODE: ProjectEngineTargetPolicyMode = 'manual_allowed';
export const DEFAULT_ACCESS_AUTHORITY_MODE: AccessAuthorityMode = 'manual';
export const DEFAULT_ENGINE_RUNTIME_AUTHORIZATION_MODE: EngineRuntimeAuthorizationMode = 'enterpriseglue_authoritative';
export const DEFAULT_LOCAL_PASSWORD_LOGIN_MODE: LocalPasswordLoginMode = 'auto';
export const DEFAULT_SSO_PROVIDER_SELECTION_MODE: SsoProviderSelectionMode = 'auto_redirect_single';

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

export function normalizeLocalPasswordLoginMode(value: unknown): LocalPasswordLoginMode {
  const parsed = LocalPasswordLoginModeSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_LOCAL_PASSWORD_LOGIN_MODE;
}

function requireLocalPasswordLoginMode(value: unknown): LocalPasswordLoginMode {
  const parsed = LocalPasswordLoginModeSchema.safeParse(value);
  if (!parsed.success) throw Errors.validation('Invalid local password login mode');
  return parsed.data;
}

export function normalizeSsoProviderSelectionMode(value: unknown): SsoProviderSelectionMode {
  const parsed = SsoProviderSelectionModeSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_SSO_PROVIDER_SELECTION_MODE;
}

function requireSsoProviderSelectionMode(value: unknown): SsoProviderSelectionMode {
  const parsed = SsoProviderSelectionModeSchema.safeParse(value);
  if (!parsed.success) throw Errors.validation('Invalid SSO provider selection mode');
  return parsed.data;
}

export function normalizeAccessGovernanceDriftStatus(value: unknown): AccessGovernanceDriftStatus | null {
  const parsed = AccessGovernanceDriftStatusSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
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
  accessGovernanceSourceRef: string | null;
  accessGovernanceOwnershipMode: 'manual' | 'config_locked' | 'config_warn';
  accessGovernanceSourceHash: string | null;
  accessGovernanceLastAppliedAt: number | null;
  accessGovernanceDriftStatus: AccessGovernanceDriftStatus | null;
  governanceBehavior: PlatformGovernanceBehavior;
  credentiallessCustomerSidecarsEnabled: boolean;
  inviteAllowAllDomains: boolean;
  inviteAllowedDomains: string[];
  localPasswordLoginMode: LocalPasswordLoginMode;
  ssoProviderSelectionMode: SsoProviderSelectionMode;
  ssoAllEnginesAssignmentMappingsEnabled: boolean;
  ssoEngineOwnerAssignmentMappingsEnabled: boolean;
  ssoEngineDelegateAssignmentMappingsEnabled: boolean;
  ssoRegexClaimMappingsEnabled: boolean;
  ssoBroadEntitlementMappingsEnabled: boolean;
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
        accessGovernanceSourceRef: null,
        accessGovernanceOwnershipMode: 'manual',
        accessGovernanceSourceHash: null,
        accessGovernanceLastAppliedAt: null,
        accessGovernanceDriftStatus: null,
        governanceBehavior: derivePlatformGovernanceBehavior({
          engineOnboardingMode: DEFAULT_ENGINE_ONBOARDING_MODE,
          projectEngineTargetMode: DEFAULT_PROJECT_ENGINE_TARGET_MODE,
          engineAccessAuthority: DEFAULT_ACCESS_AUTHORITY_MODE,
          projectAccessAuthority: DEFAULT_ACCESS_AUTHORITY_MODE,
          accessGovernanceOwnershipMode: 'manual',
        }),
        credentiallessCustomerSidecarsEnabled: false,
        inviteAllowAllDomains: true,
        inviteAllowedDomains: [],
        localPasswordLoginMode: DEFAULT_LOCAL_PASSWORD_LOGIN_MODE,
        ssoProviderSelectionMode: DEFAULT_SSO_PROVIDER_SELECTION_MODE,
        ssoAllEnginesAssignmentMappingsEnabled: true,
        ssoEngineOwnerAssignmentMappingsEnabled: false,
        ssoEngineDelegateAssignmentMappingsEnabled: false,
        ssoRegexClaimMappingsEnabled: false,
        ssoBroadEntitlementMappingsEnabled: false,
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

    const engineOnboardingMode = normalizeEngineOnboardingMode(settings.engineOnboardingMode);
    const projectEngineTargetMode = normalizeProjectEngineTargetMode(settings.projectEngineTargetMode);
    const engineAccessAuthority = normalizeAccessAuthorityMode(settings.engineAccessAuthority);
    const projectAccessAuthority = normalizeAccessAuthorityMode(settings.projectAccessAuthority);
    const accessGovernanceOwnershipMode = ['config_locked', 'config_warn'].includes(String(settings.accessGovernanceOwnershipMode))
      ? settings.accessGovernanceOwnershipMode as 'config_locked' | 'config_warn'
      : 'manual';

    return {
      defaultEnvironmentTagId: settings.defaultEnvironmentTagId,
      syncPushEnabled: settings.syncPushEnabled,
      syncPullEnabled: settings.syncPullEnabled,
      gitProjectTokenSharingEnabled: settings.gitProjectTokenSharingEnabled ?? false,
      defaultDeployRoles: JSON.parse(settings.defaultDeployRoles),
      engineOnboardingMode,
      projectEngineTargetMode,
      engineAccessAuthority,
      projectAccessAuthority,
      engineRuntimeAuthorizationMode: normalizeEngineRuntimeAuthorizationMode(settings.engineRuntimeAuthorizationMode),
      accessGovernanceSourceRef: settings.accessGovernanceSourceRef ?? null,
      accessGovernanceOwnershipMode,
      accessGovernanceSourceHash: settings.accessGovernanceSourceHash ?? null,
      accessGovernanceLastAppliedAt: settings.accessGovernanceLastAppliedAt === null || settings.accessGovernanceLastAppliedAt === undefined
        ? null
        : Number(settings.accessGovernanceLastAppliedAt),
      accessGovernanceDriftStatus: normalizeAccessGovernanceDriftStatus(
        settings.accessGovernanceDriftStatus,
      ),
      governanceBehavior: derivePlatformGovernanceBehavior({
        engineOnboardingMode,
        projectEngineTargetMode,
        engineAccessAuthority,
        projectAccessAuthority,
        accessGovernanceOwnershipMode,
      }),
      credentiallessCustomerSidecarsEnabled: settings.credentiallessCustomerSidecarsEnabled ?? false,
      inviteAllowAllDomains: settings.inviteAllowAllDomains ?? true,
      inviteAllowedDomains: (() => {
        try {
          return JSON.parse(String(settings.inviteAllowedDomains || '[]'));
        } catch {
          return [];
        }
      })(),
      localPasswordLoginMode: normalizeLocalPasswordLoginMode(settings.localPasswordLoginMode),
      ssoProviderSelectionMode: normalizeSsoProviderSelectionMode(settings.ssoProviderSelectionMode),
      ssoAllEnginesAssignmentMappingsEnabled: settings.ssoAllEnginesAssignmentMappingsEnabled ?? true,
      ssoEngineOwnerAssignmentMappingsEnabled: settings.ssoEngineOwnerAssignmentMappingsEnabled ?? false,
      ssoEngineDelegateAssignmentMappingsEnabled: settings.ssoEngineDelegateAssignmentMappingsEnabled ?? false,
      ssoRegexClaimMappingsEnabled: settings.ssoRegexClaimMappingsEnabled ?? false,
      ssoBroadEntitlementMappingsEnabled: settings.ssoBroadEntitlementMappingsEnabled ?? false,
      ssoSecretViewMappingsEnabled: settings.ssoSecretViewMappingsEnabled ?? false,
      ssoUnredactedAuditMappingsEnabled: settings.ssoUnredactedAuditMappingsEnabled ?? false,
      ssoPermanentDeleteMappingsEnabled: settings.ssoPermanentDeleteMappingsEnabled ?? false,
      piiRegexEnabled: settings.piiRegexEnabled ?? false,
      piiExternalProviderEnabled: settings.piiExternalProviderEnabled ?? false,
      piiExternalProviderType: settings.piiExternalProviderType ?? null,
      piiExternalProviderEndpoint: settings.piiExternalProviderEndpoint ?? null,
      piiExternalProviderAuthHeader: settings.piiExternalProviderAuthHeader ?? null,
      piiExternalProviderAuthToken: null,
      piiExternalProviderProjectId: settings.piiExternalProviderProjectId ?? null,
      piiExternalProviderRegion: settings.piiExternalProviderRegion ?? null,
      piiRedactionStyle: settings.piiRedactionStyle ?? '<TYPE>',
      piiScopes: (() => {
        try {
          return JSON.parse(String(settings.piiScopes || '[]'));
        } catch {
          return [...DEFAULT_PII_SCOPES];
        }
      })(),
      piiMaxPayloadSizeBytes: Number(settings.piiMaxPayloadSizeBytes ?? 262144),
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
    const token = settings.piiExternalProviderAuthToken ?? null;
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
      localPasswordLoginMode: LocalPasswordLoginMode;
      ssoProviderSelectionMode: SsoProviderSelectionMode;
      ssoAllEnginesAssignmentMappingsEnabled: boolean;
      ssoEngineOwnerAssignmentMappingsEnabled: boolean;
      ssoEngineDelegateAssignmentMappingsEnabled: boolean;
      ssoRegexClaimMappingsEnabled: boolean;
      ssoBroadEntitlementMappingsEnabled: boolean;
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
    updatedById: string,
    options?: {
      store?: DataSource | EntityManager;
      sourceRef?: string | null;
      ownershipMode?: 'manual' | 'config_locked' | 'config_warn';
      sourceHash?: string | null;
      lastAppliedAt?: number | null;
      driftStatus?: AccessGovernanceDriftStatus | null;
      bypassOwnership?: boolean;
    },
  ): Promise<void> {
    const dataSource = options?.store || await getDataSource();
    const settingsRepo = dataSource.getRepository(PlatformSettings);
    const now = Date.now();
    const existing = await settingsRepo.findOneBy({ id: this.DEFAULT_ID });
    const governanceKeys = [
      'engineOnboardingMode',
      'projectEngineTargetMode',
      'engineAccessAuthority',
      'projectAccessAuthority',
      'engineRuntimeAuthorizationMode',
    ] as const;
    const changesGovernance = governanceKeys.some((key) => data[key] !== undefined);
    const existingOwnershipMode = existing?.accessGovernanceOwnershipMode || 'manual';
    if (changesGovernance && !options?.bypassOwnership && existingOwnershipMode === 'config_locked') {
      throw Errors.forbidden('Engine and access governance settings are managed by configuration');
    }

    if (data.engineRuntimeAuthorizationMode === 'mirrored_engine_backstop') {
      const successfulRun = await dataSource.getRepository(EngineBackstopSyncRun).findOne({
        where: { status: 'succeeded' },
        order: { completedAt: 'DESC', id: 'DESC' },
      });
      if (!successfulRun) {
        throw new Error('mirrored_engine_backstop requires at least one successful, retained Camunda 7 or Operaton backstop synchronization');
      }
    }

    // Prepare update data
    const updateData: Record<string, any> = {
      updatedAt: now,
      updatedById,
    };
    if (changesGovernance && existingOwnershipMode === 'config_warn' && !options?.bypassOwnership) {
      updateData.accessGovernanceDriftStatus = 'drifted';
    }
    if (options?.sourceRef !== undefined) updateData.accessGovernanceSourceRef = options.sourceRef;
    if (options?.ownershipMode !== undefined) updateData.accessGovernanceOwnershipMode = options.ownershipMode;
    if (options?.sourceHash !== undefined) updateData.accessGovernanceSourceHash = options.sourceHash;
    if (options?.lastAppliedAt !== undefined) updateData.accessGovernanceLastAppliedAt = options.lastAppliedAt;
    if (options?.driftStatus !== undefined) updateData.accessGovernanceDriftStatus = options.driftStatus;

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
    if (data.localPasswordLoginMode !== undefined) {
      updateData.localPasswordLoginMode = requireLocalPasswordLoginMode(data.localPasswordLoginMode);
    }
    if (data.ssoProviderSelectionMode !== undefined) {
      updateData.ssoProviderSelectionMode = requireSsoProviderSelectionMode(data.ssoProviderSelectionMode);
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
    if (data.ssoBroadEntitlementMappingsEnabled !== undefined) {
      updateData.ssoBroadEntitlementMappingsEnabled = data.ssoBroadEntitlementMappingsEnabled;
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
        accessGovernanceSourceRef: options?.sourceRef ?? null,
        accessGovernanceOwnershipMode: options?.ownershipMode ?? 'manual',
        accessGovernanceSourceHash: options?.sourceHash ?? null,
        accessGovernanceLastAppliedAt: options?.lastAppliedAt ?? null,
        accessGovernanceDriftStatus: options?.driftStatus !== undefined
          ? options.driftStatus
          : options?.sourceRef ? 'in_sync' : null,
        credentiallessCustomerSidecarsEnabled: data.credentiallessCustomerSidecarsEnabled ?? false,
        inviteAllowAllDomains: data.inviteAllowAllDomains ?? true,
        inviteAllowedDomains: JSON.stringify(data.inviteAllowedDomains ?? []),
        localPasswordLoginMode: data.localPasswordLoginMode ?? DEFAULT_LOCAL_PASSWORD_LOGIN_MODE,
        ssoProviderSelectionMode: data.ssoProviderSelectionMode ?? DEFAULT_SSO_PROVIDER_SELECTION_MODE,
        ssoAllEnginesAssignmentMappingsEnabled: data.ssoAllEnginesAssignmentMappingsEnabled ?? true,
        ssoEngineOwnerAssignmentMappingsEnabled: data.ssoEngineOwnerAssignmentMappingsEnabled ?? false,
        ssoEngineDelegateAssignmentMappingsEnabled: data.ssoEngineDelegateAssignmentMappingsEnabled ?? false,
        ssoRegexClaimMappingsEnabled: data.ssoRegexClaimMappingsEnabled ?? false,
        ssoBroadEntitlementMappingsEnabled: data.ssoBroadEntitlementMappingsEnabled ?? false,
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
