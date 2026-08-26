import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { TenantLoginPolicy } from '@enterpriseglue/shared/infrastructure/persistence/entities/TenantLoginPolicy.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';

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
    const repo = (await getDataSource()).getRepository(TenantLoginPolicy);
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
}

export const tenantLoginPolicyService = new TenantLoginPolicyService();
