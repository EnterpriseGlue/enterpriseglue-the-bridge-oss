import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const HEX_64 = /^[0-9a-f]{64}$/
const SHA_40 = /^[0-9a-f]{40}$/
const SUBJECT = /^ghcr\.io\/enterpriseglue\/[a-z0-9._/-]+@sha256:[0-9a-f]{64}$/
const PREDECESSOR_REVISION = '785b5ab890aba315f6c3944ace0edcc3ff99d20f'
const PREDECESSOR_SUBJECT = 'ghcr.io/enterpriseglue/enterpriseglue-the-bridge-oss-backend@sha256:21b196a9ece726dac9f6a492cbb030c9dab6efadedf1f3f5ac842219027a3646'
const PREDECESSOR_MIGRATION_SHA256 = 'e525e9f9fe8d66498aeea6beb03d6257274de3a38a7b48819de6edccf02ecb16'
const PREDECESSOR_SCHEMA_PLAN_SHA256 = 'c702aa4f6ed7dffa7e0c2d3da1d990cafb162a8d1e416b92f0d678b3341799d2'

export const MANIFEST_SCHEMA = 'enterpriseglue-managed-shard-bootstrap/v1'
export const RECEIPT_SCHEMA = 'enterpriseglue-managed-shard-bootstrap-receipt/v1'

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  const actual = Object.keys(value).sort()
  if (actual.join('\0') !== [...expected].sort().join('\0')) throw new Error(`${label} fields are not the signed contract`)
}

export function parseManagedShardBootstrapManifest(value) {
  exactKeys(value, ['schemaVersion', 'id', 'enabledByDefault', 'target', 'predecessor', 'execution', 'postcondition', 'implementationInventory'], 'Bootstrap manifest')
  if (value.schemaVersion !== MANIFEST_SCHEMA || value.id !== 'postgres-v0.24.2-exact-0130/v1' || value.enabledByDefault !== false) {
    throw new Error('Bootstrap manifest identity or default-off boundary is invalid')
  }
  exactKeys(value.target, ['databaseType', 'tenancyMode', 'executionTenancyMode'], 'Bootstrap target')
  if (value.target.databaseType !== 'postgres' || value.target.tenancyMode !== 'pooled' || value.target.executionTenancyMode !== 'single') {
    throw new Error('Bootstrap supports only pooled PostgreSQL through the pinned predecessor seed mode')
  }
  exactKeys(value.predecessor, ['releaseTag', 'sourceRevision', 'backendSubject', 'migrationInventory', 'postgresPolicyProfile'], 'Bootstrap predecessor')
  if (value.predecessor.releaseTag !== 'v0.24.2' || !SHA_40.test(value.predecessor.sourceRevision) || value.predecessor.sourceRevision !== PREDECESSOR_REVISION || !SUBJECT.test(value.predecessor.backendSubject) || value.predecessor.backendSubject !== PREDECESSOR_SUBJECT) {
    throw new Error('Bootstrap predecessor artifact identity is invalid')
  }
  const inventory = value.predecessor.migrationInventory
  exactKeys(inventory, ['through', 'count', 'sha256'], 'Bootstrap predecessor inventory')
  if (inventory.through !== 1700000000130 || inventory.count !== 132 || !HEX_64.test(inventory.sha256) || inventory.sha256 !== PREDECESSOR_MIGRATION_SHA256 || value.predecessor.postgresPolicyProfile !== 'legacy-tenant-context/v1') {
    throw new Error('Bootstrap predecessor is not the exact supported 0130 schema epoch')
  }
  exactKeys(value.execution, ['mode', 'synchronize', 'transaction', 'schemaPlan', 'advisoryLock', 'acceptedStartingStates', 'receiptSchema', 'maximumReceiptBytes'], 'Bootstrap execution')
  exactKeys(value.execution.schemaPlan, ['algorithm', 'sha256', 'supplementalMigrations'], 'Bootstrap schema plan')
  exactKeys(value.execution.advisoryLock, ['namespace', 'classId'], 'Bootstrap advisory lock')
  if (value.execution.mode !== 'one-shot-signed-typeorm-schema-plan/v1' || value.execution.synchronize !== 'forbidden' || value.execution.transaction !== 'all') throw new Error('Bootstrap execution can only run the bounded signed TypeORM schema-plan path')
  if (value.execution.schemaPlan.algorithm !== 'sha256-canonical-typeorm-up-queries/v1' || !HEX_64.test(value.execution.schemaPlan.sha256) || value.execution.schemaPlan.sha256 !== PREDECESSOR_SCHEMA_PLAN_SHA256) throw new Error('Bootstrap schema-plan identity is invalid')
  if (canonicalJson(value.execution.schemaPlan.supplementalMigrations) !== canonicalJson(['AddPostgresTenantRls1700000000126'])) throw new Error('Bootstrap schema-plan supplemental migration inventory is invalid')
  if (value.execution.advisoryLock.namespace !== 'enterpriseglue-managed-shard-bootstrap/v1' || value.execution.advisoryLock.classId !== 1162299212) throw new Error('Bootstrap advisory lock identity is invalid')
  if (canonicalJson(value.execution.acceptedStartingStates) !== canonicalJson(['pristine-schema', 'exact-bootstrap-0130'])) throw new Error('Bootstrap accepted starting states are not fail closed')
  if (value.execution.receiptSchema !== RECEIPT_SCHEMA || value.execution.maximumReceiptBytes !== 4096) throw new Error('Bootstrap receipt boundary is invalid')
  exactKeys(value.postcondition, ['schemaObjects', 'expectedSequences', 'relationOwner', 'roleProfile', 'runtimeGrant', 'forbiddenRelations', 'seedProfile', 'seededRelations', 'ordinaryDataPolicy', 'defaultTenant', 'loginPolicy', 'environmentTags', 'gitProviders', 'platformGroups', 'platformGroupAssignments', 'bootstrapAdministrator', 'bootstrapMemberships'], 'Bootstrap postcondition')
  exactKeys(value.postcondition.defaultTenant, ['id', 'name', 'slug', 'status', 'placementKey', 'placementEpoch', 'createdByUserId'], 'Bootstrap default tenant')
  exactKeys(value.postcondition.loginPolicy, ['id', 'tenantId', 'localPasswordMode', 'providerSelectionMode', 'updatedByUserId'], 'Bootstrap login policy')
  exactKeys(value.postcondition.bootstrapAdministrator, ['authProvider', 'firstName', 'lastName', 'platformRole', 'isActive', 'mustResetPassword', 'failedLoginAttempts', 'lockedUntil', 'isEmailVerified', 'emailVerificationToken', 'emailVerificationTokenExpiry', 'lastLoginAt', 'authSessionVersion', 'createdByUserId'], 'Bootstrap administrator')
  if (value.postcondition.schemaObjects !== 'exact-predecessor-entity-tables-ledger-and-owned-sequences/v1' || canonicalJson(value.postcondition.expectedSequences) !== canonicalJson(['migrations_id_seq']) || value.postcondition.relationOwner !== 'current-user' || value.postcondition.roleProfile !== 'restricted-owner-and-runtime-no-memberships/v1' || value.postcondition.runtimeGrant !== 'exact-owner-runtime-relation-default-and-no-column-acls/v2' || value.postcondition.seedProfile !== 'enterpriseglue-managed-shard-seeds/v2' || value.postcondition.ordinaryDataPolicy !== 'all-other-predecessor-entity-tables-empty/v1') throw new Error('Bootstrap postcondition profile is invalid')
  const seededRelations = ['audit_logs', 'authz_group_memberships', 'authz_groups', 'authz_migration_states', 'email_templates', 'environment_tags', 'git_providers', 'permissions', 'platform_settings', 'role_assignments', 'role_permissions', 'roles', 'tenant_login_policies', 'tenants', 'users']
  if (canonicalJson(value.postcondition.seededRelations) !== canonicalJson(seededRelations)) throw new Error('Bootstrap seeded relation inventory is incomplete')
  if (!Array.isArray(value.postcondition.forbiddenRelations) || !value.postcondition.forbiddenRelations.includes('release_effect_cohorts')) throw new Error('Bootstrap must reject release-effect cohort objects')
  if (!Array.isArray(value.postcondition.environmentTags) || value.postcondition.environmentTags.length !== 4 || !Array.isArray(value.postcondition.gitProviders) || value.postcondition.gitProviders.length !== 4) throw new Error('Bootstrap seed profile is incomplete')
  value.postcondition.environmentTags.forEach((tag, index) => exactKeys(tag, ['id', 'name', 'color', 'manualDeployAllowed', 'sortOrder', 'isDefault', 'configKey', 'sourceRef', 'configScopeKey', 'ownershipMode', 'sourceHash', 'lastAppliedAt', 'driftStatus', 'configGeneration'], `Bootstrap environment tag ${index}`))
  value.postcondition.gitProviders.forEach((provider, index) => exactKeys(provider, ['tenantId', 'type', 'name', 'baseUrl', 'apiUrl', 'customBaseUrl', 'customApiUrl', 'oauthClientId', 'oauthClientSecret', 'oauthScopes', 'oauthAuthUrl', 'oauthTokenUrl', 'supportsOAuth', 'supportsPAT', 'isActive', 'displayOrder'], `Bootstrap Git provider ${index}`))
  if (!Array.isArray(value.postcondition.platformGroups) || value.postcondition.platformGroups.length !== 8 || !Array.isArray(value.postcondition.platformGroupAssignments) || value.postcondition.platformGroupAssignments.length !== 8 || !Array.isArray(value.postcondition.bootstrapMemberships) || value.postcondition.bootstrapMemberships.length !== 2) throw new Error('Bootstrap RBAC seed profile is incomplete')
  value.postcondition.platformGroups.forEach((group, index) => exactKeys(group, ['id', 'tenantId', 'key', 'name', 'description', 'source', 'sourceRef', 'isSystem', 'isArchived'], `Bootstrap platform group ${index}`))
  value.postcondition.platformGroupAssignments.forEach((assignment, index) => exactKeys(assignment, ['id', 'tenantId', 'principalType', 'principalId', 'roleId', 'scopeType', 'scopeId', 'source', 'sourceRef', 'ownershipMode', 'sourceHash', 'lastAppliedAt', 'driftStatus', 'expiresAt', 'lastSeenAt', 'createdById'], `Bootstrap platform group assignment ${index}`))
  value.postcondition.bootstrapMemberships.forEach((membership, index) => exactKeys(membership, ['tenantId', 'groupId', 'source', 'sourceRef', 'expiresAt', 'createdById'], `Bootstrap administrator membership ${index}`))
  const groupIds = value.postcondition.platformGroups.map((group) => group.id).sort()
  const assignmentGroupIds = value.postcondition.platformGroupAssignments.map((assignment) => assignment.principalId).sort()
  if (new Set(groupIds).size !== 8 || canonicalJson(groupIds) !== canonicalJson(assignmentGroupIds)) throw new Error('Bootstrap platform group assignments do not cover the exact group inventory')
  exactKeys(value.implementationInventory, ['algorithm', 'purpose', 'files', 'count', 'sha256'], 'Bootstrap implementation inventory')
  if (value.implementationInventory.algorithm !== 'sha256-source-v1' || value.implementationInventory.purpose !== 'fresh-managed-shard-bootstrap-exact-v0.24.2-0130/v1' || value.implementationInventory.count !== 2 || value.implementationInventory.files.length !== value.implementationInventory.count || !HEX_64.test(value.implementationInventory.sha256)) throw new Error('Bootstrap implementation inventory is invalid')
  return value
}

export async function loadManagedShardBootstrapManifest(path) {
  return parseManagedShardBootstrapManifest(JSON.parse(await readFile(path, 'utf8')))
}

export function assertBootstrapEnabled(environment, manifest) {
  if (manifest.enabledByDefault !== false || environment.EG_MANAGED_SHARD_BOOTSTRAP_ENABLED !== 'true') throw new Error('Managed-shard bootstrap is disabled; set EG_MANAGED_SHARD_BOOTSTRAP_ENABLED=true only from the verified provisioning controller')
  if (environment.DATABASE_TYPE !== 'postgres' || environment.EG_MANAGED_SHARD_TARGET_TENANCY_MODE !== 'pooled' || environment.EG_TENANCY_MODE !== manifest.target.executionTenancyMode) throw new Error('Managed-shard bootstrap target must be pooled PostgreSQL using the pinned predecessor execution tenancy mode')
  if (!environment.EG_MANAGED_SHARD_ID || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(environment.EG_MANAGED_SHARD_ID)) throw new Error('EG_MANAGED_SHARD_ID must be a stable lowercase shard identity')
  if (!environment.EG_POSTGRES_RUNTIME_ROLE || !/^[a-z_][a-z0-9_]{0,62}$/.test(environment.EG_POSTGRES_RUNTIME_ROLE) || environment.EG_POSTGRES_RUNTIME_ROLE.startsWith('pg_')) throw new Error('EG_POSTGRES_RUNTIME_ROLE must identify the restricted runtime login')
  if (!environment.ADMIN_EMAIL || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(environment.ADMIN_EMAIL)) throw new Error('ADMIN_EMAIL must be an explicit valid bootstrap administrator email')
  for (const name of ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITLAB_CLIENT_ID', 'GITLAB_CLIENT_SECRET', 'AZURE_DEVOPS_CLIENT_ID', 'AZURE_DEVOPS_CLIENT_SECRET', 'BITBUCKET_CLIENT_ID', 'BITBUCKET_CLIENT_SECRET']) {
    if (environment[name]) throw new Error(`Managed-shard bootstrap forbids mutable Git provider credential input: ${name}`)
  }
}

export function migrationInventorySha256(inventory) {
  return sha256(JSON.stringify(inventory.map(({ name, timestamp }) => ({ name, timestamp })).sort((left, right) => left.timestamp - right.timestamp || left.name.localeCompare(right.name))))
}

export function assertMigrationInventory(label, inventory, expected) {
  const canonical = inventory.map(({ name, timestamp }) => ({ name: String(name), timestamp: Number(timestamp) })).sort((left, right) => left.timestamp - right.timestamp || left.name.localeCompare(right.name))
  if (canonical.length !== expected.count || canonical.at(-1)?.timestamp !== expected.through || migrationInventorySha256(canonical) !== expected.sha256) {
    throw new Error(`${label} is not the exact signed 0130 migration inventory`)
  }
  return canonical
}

export function classifyStartingState(snapshot, manifest) {
  const relations = Array.isArray(snapshot.relations) ? snapshot.relations : []
  const policies = Array.isArray(snapshot.policies) ? snapshot.policies : []
  const ledger = Array.isArray(snapshot.ledger) ? snapshot.ledger : []
  if (!snapshot.schemaExists || (!snapshot.ledgerExists && relations.length === 0 && policies.length === 0)) return 'pristine-schema'
  if (!snapshot.ledgerExists || ledger.length === 0) throw new Error('Managed shard has database objects without a populated migration ledger')
  assertMigrationInventory('Executed ledger', ledger, manifest.predecessor.migrationInventory)
  if (relations.some((relation) => manifest.postcondition.forbiddenRelations.includes(relation.name))) throw new Error('Managed shard contains an object reserved for a later schema epoch')
  return 'exact-bootstrap-0130'
}

export function assertBoundedReceipt(receipt, manifest) {
  const serialized = `${JSON.stringify(receipt)}\n`
  if (Buffer.byteLength(serialized) > manifest.execution.maximumReceiptBytes) throw new Error('Managed-shard bootstrap receipt exceeds its signed byte limit')
  const forbidden = /(password|secret|token|databaseUrl|connectionString|oauth)/i
  const visit = (value, path = '') => {
    if (Array.isArray(value)) value.forEach((item, index) => visit(item, `${path}[${index}]`))
    else if (value !== null && typeof value === 'object') Object.entries(value).forEach(([key, item]) => {
      if (forbidden.test(key)) throw new Error(`Managed-shard bootstrap receipt contains forbidden field ${path ? `${path}.` : ''}${key}`)
      visit(item, path ? `${path}.${key}` : key)
    })
  }
  visit(receipt)
  return serialized
}

export function createBootstrapReceipt({ manifest, manifestSha256, shardId, action, schema, role, runtimeRole, relationCount, policyCount }) {
  if (!HEX_64.test(manifestSha256)) throw new Error('Managed-shard bootstrap manifest digest is invalid')
  if (!['bootstrapped', 'verified-existing'].includes(action)) throw new Error('Managed-shard bootstrap receipt action is invalid')
  const receipt = {
    schemaVersion: RECEIPT_SCHEMA,
    status: 'qualified',
    bootstrapId: manifest.id,
    manifestSha256,
    shardId,
    action,
    target: {
      databaseType: manifest.target.databaseType,
      tenancyMode: manifest.target.tenancyMode,
      schema,
    },
    predecessor: {
      releaseTag: manifest.predecessor.releaseTag,
      sourceRevision: manifest.predecessor.sourceRevision,
      backendDigest: manifest.predecessor.backendSubject.split('@')[1],
      migrationInventory: manifest.predecessor.migrationInventory,
      postgresPolicyProfile: manifest.predecessor.postgresPolicyProfile,
    },
    observed: {
      ownerRole: role,
      runtimeRole,
      relationCount,
      policyCount,
      seedProfile: manifest.postcondition.seedProfile,
      runtimeGrant: manifest.postcondition.runtimeGrant,
    },
  }
  assertBoundedReceipt(receipt, manifest)
  return receipt
}
