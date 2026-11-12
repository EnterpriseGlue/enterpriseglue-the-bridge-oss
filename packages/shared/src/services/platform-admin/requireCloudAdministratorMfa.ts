import type { DataSource, EntityManager } from 'typeorm';
import { config } from '@enterpriseglue/shared/config/index.js';
import { AppError } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { getActivePlatformAdministratorUserIds } from './PlatformAdministratorMembershipService.js';

export class CloudAdministratorMfaRequiredError extends AppError {
  constructor() {
    super('PLATFORM_ADMINISTRATOR_MFA_REQUIRED', 'Sign in with an identity provider or passkey that verifies a second factor.', 401);
  }
}

export async function requireCloudAdministratorMfa(
  userId: string,
  verified: boolean | undefined,
  store?: DataSource | EntityManager,
): Promise<void> {
  if (!config.cloudPlatformAdminMfaRequired || verified === true) return;
  if ((await getActivePlatformAdministratorUserIds([userId], store)).has(userId)) {
    throw new CloudAdministratorMfaRequiredError();
  }
}
