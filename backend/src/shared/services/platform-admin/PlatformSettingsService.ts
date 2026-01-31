/**
 * Platform Settings Service
 * Manages global platform configuration
 */

import { getDataSource } from '@shared/db/data-source.js';
import { PlatformSettings } from '@shared/db/entities/PlatformSettings.js';

export interface PlatformSettingsData {
  defaultEnvironmentTagId: string | null;
  syncPushEnabled: boolean;
  syncPullEnabled: boolean;
  syncBothEnabled: boolean;
  gitProjectTokenSharingEnabled: boolean;
  defaultDeployRoles: string[];
  inviteAllowAllDomains: boolean;
  inviteAllowedDomains: string[];
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
        syncBothEnabled: false,
        gitProjectTokenSharingEnabled: false,
        defaultDeployRoles: ['owner', 'delegate', 'operator', 'deployer'],
        inviteAllowAllDomains: true,
        inviteAllowedDomains: [],
      };
    }

    return {
      defaultEnvironmentTagId: settings.defaultEnvironmentTagId,
      syncPushEnabled: settings.syncPushEnabled,
      syncPullEnabled: settings.syncPullEnabled,
      syncBothEnabled: settings.syncBothEnabled,
      gitProjectTokenSharingEnabled: (settings as any).gitProjectTokenSharingEnabled ?? false,
      defaultDeployRoles: JSON.parse(settings.defaultDeployRoles),
      inviteAllowAllDomains: (settings as any).inviteAllowAllDomains ?? true,
      inviteAllowedDomains: (() => {
        try {
          return JSON.parse(String((settings as any).inviteAllowedDomains || '[]'));
        } catch {
          return [];
        }
      })(),
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
      syncBothEnabled: boolean;
      gitProjectTokenSharingEnabled: boolean;
      defaultDeployRoles: string[];
      inviteAllowAllDomains: boolean;
      inviteAllowedDomains: string[];
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
    if (data.syncBothEnabled !== undefined) {
      updateData.syncBothEnabled = data.syncBothEnabled;
    }
    if (data.gitProjectTokenSharingEnabled !== undefined) {
      updateData.gitProjectTokenSharingEnabled = data.gitProjectTokenSharingEnabled;
    }
    if (data.defaultDeployRoles !== undefined) {
      updateData.defaultDeployRoles = JSON.stringify(data.defaultDeployRoles);
    }
    if (data.inviteAllowAllDomains !== undefined) {
      updateData.inviteAllowAllDomains = data.inviteAllowAllDomains;
    }
    if (data.inviteAllowedDomains !== undefined) {
      updateData.inviteAllowedDomains = JSON.stringify(data.inviteAllowedDomains);
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
        syncBothEnabled: data.syncBothEnabled ?? false,
        gitProjectTokenSharingEnabled: data.gitProjectTokenSharingEnabled ?? false,
        defaultDeployRoles: JSON.stringify(data.defaultDeployRoles ?? ['owner', 'delegate', 'operator', 'deployer']),
        inviteAllowAllDomains: data.inviteAllowAllDomains ?? true,
        inviteAllowedDomains: JSON.stringify(data.inviteAllowedDomains ?? []),
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
