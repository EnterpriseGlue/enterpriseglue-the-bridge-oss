import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { EmailSendConfig } from '@enterpriseglue/shared/infrastructure/persistence/entities/EmailSendConfig.js';
import { AuthzGroupMembership } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroupMembership.js';

const PLATFORM_ADMINISTRATORS_GROUP_ID = 'system.group.platform_administrators';

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
  async getSetupStatus(): Promise<SetupStatus> {
    const dataSource = await getDataSource();
    const emailConfigRepo = dataSource.getRepository(EmailSendConfig);

    // OSS single-tenant mode: tenant is always considered present
    const hasDefaultTenant = true;

    // Setup is complete only when an active canonical administrator grant exists.
    const hasAdminUser = await dataSource.getRepository(AuthzGroupMembership)
      .createQueryBuilder('membership')
      .where('membership.groupId = :groupId', {
        groupId: PLATFORM_ADMINISTRATORS_GROUP_ID,
      })
      .andWhere('(membership.expiresAt IS NULL OR membership.expiresAt > :now)', { now: Date.now() })
      .getExists();

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
