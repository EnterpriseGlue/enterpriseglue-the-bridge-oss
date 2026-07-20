import { describe, expect, it } from 'vitest';
import { AddIdentityProviders1700000000056 as DbIdentityProvidersMigration } from '@enterpriseglue/shared/db/migrations/1700000000056-add-identity-providers.js';
import { AddIdentityReconciliationAndDeploymentReceipts1700000000057 as DbReconciliationMigration } from '@enterpriseglue/shared/db/migrations/1700000000057-add-identity-reconciliation-and-deployment-receipts.js';
import { AddIdentityProviders1700000000056 as PersistenceIdentityProvidersMigration } from '@enterpriseglue/shared/infrastructure/persistence/migrations/1700000000056-add-identity-providers.js';
import { AddIdentityReconciliationAndDeploymentReceipts1700000000057 as PersistenceReconciliationMigration } from '@enterpriseglue/shared/infrastructure/persistence/migrations/1700000000057-add-identity-reconciliation-and-deployment-receipts.js';
import { DropLegacySsoMappingTables1700000000089 as DbDropLegacyMappingsMigration } from '@enterpriseglue/shared/db/migrations/1700000000089-drop-legacy-sso-mapping-tables.js';
import { DropLegacySsoMappingTables1700000000089 as PersistenceDropLegacyMappingsMigration } from '@enterpriseglue/shared/infrastructure/persistence/migrations/1700000000089-drop-legacy-sso-mapping-tables.js';
import { DropLegacySsoProviders1700000000090 as DbDropLegacyProvidersMigration } from '@enterpriseglue/shared/db/migrations/1700000000090-drop-legacy-sso-providers.js';
import { DropLegacySsoProviders1700000000090 as PersistenceDropLegacyProvidersMigration } from '@enterpriseglue/shared/infrastructure/persistence/migrations/1700000000090-drop-legacy-sso-providers.js';
import { FinalizeLegacyRoleAssignmentProjections1700000000091 as DbFinalizeLegacyRoleAssignmentsMigration } from '@enterpriseglue/shared/db/migrations/1700000000091-finalize-legacy-role-assignment-projections.js';
import { FinalizeLegacyRoleAssignmentProjections1700000000091 as PersistenceFinalizeLegacyRoleAssignmentsMigration } from '@enterpriseglue/shared/infrastructure/persistence/migrations/1700000000091-finalize-legacy-role-assignment-projections.js';
import { DropLegacyUserIdentityColumns1700000000092 as DbDropLegacyUserIdentityColumnsMigration } from '@enterpriseglue/shared/db/migrations/1700000000092-drop-legacy-user-identity-columns.js';
import { DropLegacyUserIdentityColumns1700000000092 as PersistenceDropLegacyUserIdentityColumnsMigration } from '@enterpriseglue/shared/infrastructure/persistence/migrations/1700000000092-drop-legacy-user-identity-columns.js';
import { DropRoleAssignmentSourceMappingAlias1700000000093 as DbDropRoleAssignmentSourceMappingAliasMigration } from '@enterpriseglue/shared/db/migrations/1700000000093-drop-role-assignment-source-mapping-alias.js';
import { DropRoleAssignmentSourceMappingAlias1700000000093 as PersistenceDropRoleAssignmentSourceMappingAliasMigration } from '@enterpriseglue/shared/infrastructure/persistence/migrations/1700000000093-drop-role-assignment-source-mapping-alias.js';

describe('persistence migration bridges', () => {
  it('re-exports the identity-provider and deployment-receipt migrations from the canonical persistence path', () => {
    expect(PersistenceIdentityProvidersMigration).toBe(DbIdentityProvidersMigration);
    expect(PersistenceReconciliationMigration).toBe(DbReconciliationMigration);
    expect(PersistenceDropLegacyMappingsMigration).toBe(DbDropLegacyMappingsMigration);
    expect(PersistenceDropLegacyProvidersMigration).toBe(DbDropLegacyProvidersMigration);
    expect(PersistenceFinalizeLegacyRoleAssignmentsMigration).toBe(DbFinalizeLegacyRoleAssignmentsMigration);
    expect(PersistenceDropLegacyUserIdentityColumnsMigration).toBe(DbDropLegacyUserIdentityColumnsMigration);
    expect(PersistenceDropRoleAssignmentSourceMappingAliasMigration).toBe(DbDropRoleAssignmentSourceMappingAliasMigration);
  });
});
