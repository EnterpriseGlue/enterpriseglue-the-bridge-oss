import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { TenantLoginPolicy } from '@enterpriseglue/shared/infrastructure/persistence/entities/TenantLoginPolicy.js';
import { IdentityProvider } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvider.js';
import type { RefreshToken } from '@enterpriseglue/shared/infrastructure/persistence/entities/RefreshToken.js';
import type { DataSource } from 'typeorm';
import { config } from '@enterpriseglue/shared/config/index.js';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import type { JwtPayload } from '@enterpriseglue/shared/utils/jwt.js';
import { runWithTenantDatabaseContext, type TenantDatabaseContext } from '../tenant-database-context.js';

export interface TenantLoginPolicyData {
  localPasswordMode: TenantLoginPolicy['localPasswordMode'];
  providerSelectionMode: TenantLoginPolicy['providerSelectionMode'];
}

export class TenantLoginPolicyService {
  async get(tenantId: string): Promise<TenantLoginPolicyData | null> {
    const row = await (await getDataSource()).getRepository(TenantLoginPolicy).findOneBy({ tenantId });
    return row ? { localPasswordMode: row.localPasswordMode, providerSelectionMode: row.providerSelectionMode } : null;
  }

  async upsert(tenantId: string, input: TenantLoginPolicyData, actorId: string): Promise<TenantLoginPolicyData> {
    const dataSource = await getDataSource();
    if (config.tenancyCloudRequired && input.localPasswordMode === 'disabled' && !await dataSource.getRepository(IdentityProvider).existsBy({
      tenantId, isEnabled: true, authenticationMode: 'direct',
    })) throw Errors.conflict('Enable a company sign-in provider before requiring company SSO');
    const repo = dataSource.getRepository(TenantLoginPolicy);
    const existing = await repo.findOneBy({ tenantId });
    const now = Date.now();
    await repo.upsert({
      id: existing?.id || generateId(),
      tenantId,
      localPasswordMode: input.localPasswordMode,
      providerSelectionMode: input.providerSelectionMode,
      updatedByUserId: actorId,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    }, { conflictPaths: ['tenantId'] });
    return { ...input };
  }

  async requireCompanySso(tenant: TenantDatabaseContext, principal: Pick<JwtPayload, 'authenticationMethod' | 'recovery'>,
    session: Pick<RefreshToken, 'identityProviderId' | 'providerSubjectId'> | undefined, dataSource: DataSource): Promise<void> {
    if (config.tenancyMode !== 'pooled' || !config.tenancyCloudRequired || principal.recovery === 'platform_administrator') return;
    await runWithTenantDatabaseContext(tenant, async () => {
      const policy = await dataSource.getRepository(TenantLoginPolicy).findOneBy({ tenantId: tenant.tenantId });
      if (policy?.localPasswordMode !== 'disabled') return;
      const protocol = principal.authenticationMethod;
      if (!session?.identityProviderId || !session.providerSubjectId || (protocol !== 'oidc' && protocol !== 'saml' && protocol !== 'ldap') ||
          !await dataSource.getRepository(IdentityProvider).existsBy({ id: session.identityProviderId, protocol,
            tenantId: tenant.tenantId, isEnabled: true, authenticationMode: 'direct' })) {
        throw Errors.forbidden('Sign in through your organization’s SSO provider');
      }
    });
  }
}

export const tenantLoginPolicyService = new TenantLoginPolicyService();
