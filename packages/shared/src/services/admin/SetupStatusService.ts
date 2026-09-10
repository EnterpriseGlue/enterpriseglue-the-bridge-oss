import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { EmailSendConfig } from '@enterpriseglue/shared/infrastructure/persistence/entities/EmailSendConfig.js';
import { config } from '@enterpriseglue/shared/config/index.js';
import type { DataSource } from 'typeorm';
import { getActivePlatformAdministratorUserIds, hasActivePlatformAdministrator } from '../platform-admin/PlatformAdministratorMembershipService.js';

export interface SetupStatus {
  isConfigured: boolean;
  checks: {
    hasDefaultTenant: boolean;
    hasAdminUser: boolean;
    hasEmailConfig: boolean;
  };
  requiredActions: string[];
}

class SetupStatusServiceImpl {
  private async hasPooledAdministrator(dataSource: DataSource, authenticatedUserId?: string): Promise<boolean> {
    // This optional witness comes only from requireAuth, not request input.
    // The usual administrator request needs one narrow membership query.
    if (authenticatedUserId && (await getActivePlatformAdministratorUserIds([authenticatedUserId], dataSource)).size) return true;

    // A delegated settings reader receives one boolean setup witness. The
    // capability and RLS policy never cross this service boundary as a
    // platform-administrator membership directory.
    return hasActivePlatformAdministrator(dataSource);
  }

  async getSetupStatus(authenticatedUserId?: string): Promise<SetupStatus> {
    const dataSource = await getDataSource();
    const emailConfigRepo = dataSource.getRepository(EmailSendConfig);

    // OSS single-tenant mode: tenant is always considered present
    const hasDefaultTenant = true;

    // Setup is complete only when an active canonical administrator grant exists.
    const hasAdminUser = config.tenancyMode === 'pooled'
      ? await this.hasPooledAdministrator(dataSource, authenticatedUserId)
      : await hasActivePlatformAdministrator(dataSource);

    // Check if email config exists (optional but recommended)
    const hasEmailConfig = await emailConfigRepo.count() > 0;

    // Build required actions list
    const requiredActions: string[] = [];
    if (!hasAdminUser) {
      requiredActions.push('Configure admin user');
    }

    // Platform is configured if we have an admin user
    const isConfigured = hasAdminUser;

    return {
      isConfigured,
      checks: {
        hasDefaultTenant,
        hasAdminUser,
        hasEmailConfig,
      },
      requiredActions,
    };
  }
}

export const setupStatusService = new SetupStatusServiceImpl();
