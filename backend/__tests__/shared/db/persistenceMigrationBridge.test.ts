import { describe, expect, it } from 'vitest';
import { AddIdentityProviders1700000000056 as DbIdentityProvidersMigration } from '@enterpriseglue/shared/db/migrations/1700000000056-add-identity-providers.js';
import { AddIdentityReconciliationAndDeploymentReceipts1700000000057 as DbReconciliationMigration } from '@enterpriseglue/shared/db/migrations/1700000000057-add-identity-reconciliation-and-deployment-receipts.js';
import { AddIdentityProviders1700000000056 as PersistenceIdentityProvidersMigration } from '@enterpriseglue/shared/infrastructure/persistence/migrations/1700000000056-add-identity-providers.js';
import { AddIdentityReconciliationAndDeploymentReceipts1700000000057 as PersistenceReconciliationMigration } from '@enterpriseglue/shared/infrastructure/persistence/migrations/1700000000057-add-identity-reconciliation-and-deployment-receipts.js';

describe('persistence migration bridges', () => {
  it('re-exports the identity-provider and deployment-receipt migrations from the canonical persistence path', () => {
    expect(PersistenceIdentityProvidersMigration).toBe(DbIdentityProvidersMigration);
    expect(PersistenceReconciliationMigration).toBe(DbReconciliationMigration);
  });
});
