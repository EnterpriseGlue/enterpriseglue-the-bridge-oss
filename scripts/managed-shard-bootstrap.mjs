#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import {
  assertBootstrapEnabled,
  assertMigrationInventory,
  canonicalJson,
  classifyStartingState,
  createBootstrapReceipt,
  loadManagedShardBootstrapManifest,
  sha256,
} from './managed-shard-bootstrap-contract.mjs'

const DEFAULT_MANIFEST = '/opt/enterpriseglue-bootstrap/managed-shard-bootstrap-manifest.json'
const DEFAULT_SHARED = '/app/dist/packages/shared/dist'
const LEGACY_POLICY_SOURCE = "COALESCE(NULLIF(current_setting('enterpriseglue.tenancy_mode', true), ''), 'single') <> 'pooled' OR tenant_id = NULLIF(current_setting('enterpriseglue.tenant_id', true), '')"
const EMAIL_TEMPLATE_SEEDS = [
  {
    id: 'tpl-invite', type: 'invite', name: 'User Invitation', subject: "You've been invited to {{platformName}}",
    htmlTemplate: '<h1>Welcome to {{platformName}}</h1><p>You have been invited by {{inviterName}} to join {{platformName}}.</p><p><a href="{{inviteLink}}">Accept Invitation</a></p><p>This invitation expires in {{expiresIn}}.</p>',
    textTemplate: 'Welcome to {{platformName}}\n\nYou have been invited by {{inviterName}} to join {{platformName}}.\n\nAccept your invitation: {{inviteLink}}\n\nThis invitation expires in {{expiresIn}}.',
    variables: '["platformName", "inviterName", "inviteLink", "expiresIn"]', isActive: true, createdByUserId: null, updatedByUserId: null,
  },
  {
    id: 'tpl-password-reset', type: 'password_reset', name: 'Password Reset', subject: 'Reset your {{platformName}} password',
    htmlTemplate: '<h1>Password Reset Request</h1><p>We received a request to reset your password for {{platformName}}.</p><p><a href="{{resetLink}}">Reset Password</a></p><p>If you didn\'t request this, you can safely ignore this email.</p><p>This link expires in {{expiresIn}}.</p>',
    textTemplate: "Password Reset Request\n\nWe received a request to reset your password for {{platformName}}.\n\nReset your password: {{resetLink}}\n\nIf you didn't request this, you can safely ignore this email.\n\nThis link expires in {{expiresIn}}.",
    variables: '["platformName", "resetLink", "expiresIn"]', isActive: true, createdByUserId: null, updatedByUserId: null,
  },
  {
    id: 'tpl-welcome', type: 'welcome', name: 'Welcome Email', subject: 'Welcome to {{platformName}}!',
    htmlTemplate: '<h1>Welcome to {{platformName}}!</h1><p>Hi {{userName}},</p><p>Your account has been created successfully.</p><p><a href="{{loginLink}}">Login to get started</a></p>',
    textTemplate: 'Welcome to {{platformName}}!\n\nHi {{userName}},\n\nYour account has been created successfully.\n\nLogin to get started: {{loginLink}}',
    variables: '["platformName", "userName", "loginLink"]', isActive: true, createdByUserId: null, updatedByUserId: null,
  },
  {
    id: 'tpl-email-verification', type: 'email_verification', name: 'Email Verification', subject: 'Verify your email for {{platformName}}',
    htmlTemplate: '<h1>Verify Your Email</h1><p>Hi {{userName}},</p><p>Please verify your email address by clicking the link below:</p><p><a href="{{verifyLink}}">Verify Email</a></p><p>This link expires in {{expiresIn}}.</p>',
    textTemplate: 'Verify Your Email\n\nHi {{userName}},\n\nPlease verify your email address: {{verifyLink}}\n\nThis link expires in {{expiresIn}}.',
    variables: '["platformName", "userName", "verifyLink", "expiresIn"]', isActive: true, createdByUserId: null, updatedByUserId: null,
  },
]

const quote = (value) => `"${String(value).replace(/"/g, '""')}"`
const tableRef = (schema, table) => `${quote(schema)}.${quote(table)}`
const normalizeLegacyPolicy = (expression) => String(expression ?? '').replace(/::(?:pg_catalog\.)?text/g, '').replace(/[()\s]/g, '')

function migrationIdentity(migration) {
  const name = migration.name || migration.constructor.name
  const timestamp = Number(name.slice(-13))
  if (!/^[A-Za-z][A-Za-z0-9_]*\d{13}$/.test(name) || !Number.isSafeInteger(timestamp)) throw new Error('Published predecessor contains an invalid migration identity')
  return { name, timestamp }
}

async function assertImplementationInventory(manifest, manifestPath) {
  const root = path.resolve(path.dirname(manifestPath), '..', '..')
  const entries = []
  for (const file of manifest.implementationInventory.files) {
    const installed = file.startsWith('scripts/') ? path.join('/opt/enterpriseglue-bootstrap', path.basename(file)) : path.join(root, file)
    const bytes = await readFile(installed)
    entries.push({ path: file, sha256: sha256(bytes) })
  }
  entries.sort((left, right) => left.path.localeCompare(right.path))
  if (sha256(JSON.stringify(entries)) !== manifest.implementationInventory.sha256) throw new Error('Bootstrap implementation bytes do not match the signed manifest')
}

async function readSnapshot(runner, schema, ledgerName) {
  const schemaRows = await runner.query('SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname=$1) AS exists', [schema])
  const schemaExists = schemaRows[0]?.exists === true
  if (!schemaExists) return { schemaExists: false, ledgerExists: false, ledger: [], relations: [], policies: [] }
  const relations = await runner.query(`SELECT c.relname AS name,c.relkind AS kind,r.rolname AS owner,
      owned_table.relname AS dependent_table
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles r ON r.oid=c.relowner
    LEFT JOIN pg_depend d ON d.classid='pg_class'::regclass AND d.objid=c.oid AND d.refclassid='pg_class'::regclass AND d.deptype IN ('a','i')
    LEFT JOIN pg_class owned_table ON owned_table.oid=d.refobjid
    WHERE n.nspname=$1 AND c.relkind IN ('r','p','S','v','m','f') ORDER BY c.relkind,c.relname`, [schema])
  const ledgerExists = relations.some((relation) => relation.name === ledgerName && ['r', 'p'].includes(relation.kind))
  const ledger = ledgerExists
    ? (await runner.query(`SELECT name,timestamp FROM ${tableRef(schema, ledgerName)} ORDER BY timestamp,name`)).map((row) => ({ name: row.name, timestamp: Number(row.timestamp) }))
    : []
  const policies = await runner.query(`SELECT p.tablename AS table_name,p.policyname AS policy_name,p.cmd AS command,
      p.permissive,p.roles,p.qual AS using_expression,p.with_check AS check_expression
    FROM pg_policies p WHERE p.schemaname=$1 ORDER BY p.tablename,p.policyname`, [schema])
  return { schemaExists, ledgerExists, ledger, relations, policies }
}

function assertExactSchemaObjects(snapshot, dataSource, schema, ledgerName, ownerRole, manifest) {
  const expectedTables = new Set([
    ledgerName,
    ...dataSource.entityMetadatas
      .filter((metadata) => (metadata.schema || schema) === schema)
      .map((metadata) => metadata.tableName),
  ])
  const tableRelations = snapshot.relations.filter((relation) => ['r', 'p'].includes(relation.kind))
  const actualTables = new Set(tableRelations.map((relation) => relation.name))
  const missing = [...expectedTables].filter((name) => !actualTables.has(name))
  const unexpected = [...actualTables].filter((name) => !expectedTables.has(name))
  const unsupported = snapshot.relations.filter((relation) => ['v', 'm', 'f'].includes(relation.kind))
  const expectedSequences = new Set(manifest.postcondition.expectedSequences)
  const actualSequences = new Set(snapshot.relations.filter((relation) => relation.kind === 'S').map((relation) => relation.name))
  const missingSequences = [...expectedSequences].filter((name) => !actualSequences.has(name))
  const unexpectedSequences = [...actualSequences].filter((name) => !expectedSequences.has(name))
  if (missing.length || unexpected.length || unsupported.length || missingSequences.length || unexpectedSequences.length) {
    throw new Error(`Managed shard schema object inventory drifted (missing=${missing.concat(missingSequences).join(',') || 'none'}, unexpected=${unexpected.concat(unsupported.map((row) => row.name), unexpectedSequences).join(',') || 'none'})`)
  }
  if (snapshot.relations.some((relation) => relation.owner !== ownerRole)) throw new Error('Migration identity must own every managed table and sequence')
  if (snapshot.relations.some((relation) => manifest.postcondition.forbiddenRelations.includes(relation.name))) throw new Error('Managed shard contains an object reserved for a later schema epoch')
}

async function assertNoTypeOrmSchemaDrift(dataSource) {
  const memory = await dataSource.driver.createSchemaBuilder().log()
  if (memory.upQueries.length !== 0 || memory.downQueries.length !== 0) throw new Error('Managed shard TypeORM structural inventory drifted')
}

async function assertExactLegacyPolicies(runner, snapshot, dataSource, schema, rlsTables) {
  const expectedTables = dataSource.entityMetadatas
    .filter((metadata) => (metadata.schema || schema) === schema && rlsTables.has(metadata.tableName) && metadata.columns.some((column) => column.databaseName === 'tenant_id'))
    .map((metadata) => metadata.tableName)
    .sort()
  if (snapshot.policies.length !== expectedTables.length) throw new Error('Managed shard PostgreSQL policy inventory is not exact legacy 0130')
  const expectedExpression = normalizeLegacyPolicy(LEGACY_POLICY_SOURCE)
  for (const table of expectedTables) {
    const relationRows = await runner.query(`SELECT c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname=$2`, [schema, table])
    const policy = snapshot.policies.find((row) => row.table_name === table)
    const policyRoles = Array.isArray(policy?.roles) ? policy.roles : String(policy?.roles || '').replace(/[{}]/g, '').split(',').filter(Boolean)
    if (!relationRows[0]?.relrowsecurity || !relationRows[0]?.relforcerowsecurity || !policy || policy.policy_name !== 'eg_tenant_isolation' || policy.command !== 'ALL' || policy.permissive !== 'PERMISSIVE' || canonicalJson(policyRoles) !== canonicalJson(['public']) || normalizeLegacyPolicy(policy.using_expression) !== expectedExpression || normalizeLegacyPolicy(policy.check_expression) !== expectedExpression) {
      throw new Error(`Managed shard PostgreSQL policy drifted for ${table}`)
    }
  }
}

function project(rows, fields) {
  return rows.map((row) => Object.fromEntries(fields.map((field) => [field, row[field]])))
}

function assertSeedTimestamps(rows, label) {
  if (rows.some((row) => !Number.isSafeInteger(Number(row.createdAt)) || Number(row.createdAt) <= 0 || Number(row.updatedAt) !== Number(row.createdAt))) throw new Error(`Managed shard ${label} seed timestamps drifted`)
}

function assertCreatedTimestamps(rows, label) {
  if (rows.some((row) => !Number.isSafeInteger(Number(row.createdAt)) || Number(row.createdAt) <= 0)) throw new Error(`Managed shard ${label} seed timestamps drifted`)
}

function assertOpaqueIds(rows, label) {
  const ids = rows.map((row) => row.id)
  if (ids.some((id) => typeof id !== 'string' || id.length === 0) || new Set(ids).size !== ids.length) throw new Error(`Managed shard ${label} seed identities drifted`)
}

function canonicalRoleAssignmentKey(assignment) {
  const encode = (value) => `${String(value || '').length}:${value || ''}`
  return [assignment.tenantId, assignment.principalType, assignment.principalId, assignment.roleId, assignment.scopeType, assignment.scopeId, assignment.source, assignment.sourceRef].map(encode).join('|')
}

function exactDefaultEntityProjection(dataSource, entityName, overrides, omittedFields = []) {
  const metadata = dataSource.getMetadata(entityName)
  return Object.fromEntries(metadata.columns
    .filter((column) => !omittedFields.includes(column.propertyName))
    .map((column) => {
      if (Object.prototype.hasOwnProperty.call(overrides, column.propertyName)) return [column.propertyName, overrides[column.propertyName]]
      if (column.default !== undefined) return [column.propertyName, column.default]
      if (column.isNullable) return [column.propertyName, null]
      throw new Error(`Bootstrap cannot derive the signed default for ${entityName}.${column.propertyName}`)
    }))
}

async function assertOrdinaryTablesEmpty(runner, dataSource, schema, manifest) {
  const entityTables = [...new Set(dataSource.entityMetadatas
    .filter((metadata) => (metadata.schema || schema) === schema)
    .map((metadata) => metadata.tableName))].sort()
  const seeded = new Set(manifest.postcondition.seededRelations)
  const missingSeedTables = [...seeded].filter((table) => !entityTables.includes(table))
  if (missingSeedTables.length) throw new Error(`Signed seed relation inventory is not present in the predecessor (${missingSeedTables.join(',')})`)
  for (const table of entityTables.filter((name) => !seeded.has(name))) {
    const rows = await runner.query(`SELECT EXISTS (SELECT 1 FROM ${tableRef(schema, table)} LIMIT 1) AS populated`)
    if (rows[0]?.populated) throw new Error(`Managed shard ordinary business relation is not empty: ${table}`)
  }
}

async function assertExactSeeds(dataSource, manifest, adminEmail, adminPassword, permissionDefinitions, systemRoleDefinitions, verifyPassword) {
  const expected = manifest.postcondition
  const tenants = await dataSource.getRepository('Tenant').find()
  const tenantProjection = project(tenants, ['id', 'name', 'slug', 'status', 'placementKey', 'placementEpoch', 'createdByUserId'])
    .map((tenant) => ({ ...tenant, placementEpoch: Number(tenant.placementEpoch) }))
  if (tenants.length !== 1 || canonicalJson(tenantProjection) !== canonicalJson([expected.defaultTenant])) throw new Error('Managed shard default tenant seed drifted')
  assertSeedTimestamps(tenants, 'default tenant')
  const policies = await dataSource.getRepository('TenantLoginPolicy').find()
  if (policies.length !== 1 || canonicalJson(project(policies, ['id', 'tenantId', 'localPasswordMode', 'providerSelectionMode', 'updatedByUserId'])) !== canonicalJson([expected.loginPolicy])) throw new Error('Managed shard default login policy seed drifted')
  assertSeedTimestamps(policies, 'default login policy')
  const tags = (await dataSource.getRepository('EnvironmentTag').find()).sort((left, right) => left.sortOrder - right.sortOrder)
  const tagFields = ['id', 'name', 'color', 'manualDeployAllowed', 'sortOrder', 'isDefault', 'configKey', 'sourceRef', 'configScopeKey', 'ownershipMode', 'sourceHash', 'lastAppliedAt', 'driftStatus', 'configGeneration']
  const tagProjection = project(tags, tagFields).map((tag) => ({ ...tag, configGeneration: Number(tag.configGeneration) }))
  if (canonicalJson(tagProjection) !== canonicalJson(expected.environmentTags)) throw new Error('Managed shard environment tag seeds drifted')
  assertSeedTimestamps(tags, 'environment tag')
  const providers = (await dataSource.getRepository('GitProvider').find()).sort((left, right) => left.displayOrder - right.displayOrder)
  const providerFields = ['tenantId', 'type', 'name', 'baseUrl', 'apiUrl', 'customBaseUrl', 'customApiUrl', 'oauthClientId', 'oauthClientSecret', 'oauthScopes', 'oauthAuthUrl', 'oauthTokenUrl', 'supportsOAuth', 'supportsPAT', 'isActive', 'displayOrder']
  if (canonicalJson(project(providers, providerFields)) !== canonicalJson(expected.gitProviders)) throw new Error('Managed shard Git provider seeds drifted')
  assertOpaqueIds(providers, 'Git provider')
  assertSeedTimestamps(providers, 'Git provider')
  const groups = await dataSource.getRepository('AuthzGroup').find()
  const groupFields = ['id', 'tenantId', 'key', 'groupKeyIdentity', 'name', 'description', 'source', 'sourceRef', 'ownershipMode', 'sourceHash', 'lastAppliedAt', 'driftStatus', 'isSystem', 'isArchived', 'createdById']
  const groupProjection = project(groups, groupFields).sort((left, right) => left.id.localeCompare(right.id))
  const expectedGroups = expected.platformGroups.map((group) => ({ ...group, groupKeyIdentity: `platform:${group.key}`, ownershipMode: 'manual', sourceHash: null, lastAppliedAt: null, driftStatus: null, createdById: null })).sort((left, right) => left.id.localeCompare(right.id))
  if (canonicalJson(groupProjection) !== canonicalJson(expectedGroups)) throw new Error('Managed shard authorization group seeds drifted')
  assertSeedTimestamps(groups, 'authorization group')
  const groupAssignments = await dataSource.getRepository('RbacRoleAssignment').find()
  const assignmentFields = ['id', 'tenantId', 'principalType', 'principalId', 'assignmentKey', 'roleId', 'scopeType', 'scopeId', 'source', 'sourceRef', 'ownershipMode', 'sourceHash', 'lastAppliedAt', 'driftStatus', 'expiresAt', 'lastSeenAt', 'createdById']
  const assignmentProjection = project(groupAssignments, assignmentFields).sort((left, right) => left.id.localeCompare(right.id))
  const expectedAssignments = expected.platformGroupAssignments.map((assignment) => ({ ...assignment, assignmentKey: canonicalRoleAssignmentKey(assignment) })).sort((left, right) => left.id.localeCompare(right.id))
  if (canonicalJson(assignmentProjection) !== canonicalJson(expectedAssignments)) throw new Error('Managed shard authorization group assignments drifted')
  assertSeedTimestamps(groupAssignments, 'authorization group assignment')
  const users = await dataSource.getRepository('User').find()
  const adminFields = ['authProvider', 'firstName', 'lastName', 'platformRole', 'isActive', 'mustResetPassword', 'failedLoginAttempts', 'lockedUntil', 'isEmailVerified', 'emailVerificationToken', 'emailVerificationTokenExpiry', 'lastLoginAt', 'authSessionVersion', 'createdByUserId']
  const adminProjection = project(users, adminFields).map((user) => ({ ...user, failedLoginAttempts: Number(user.failedLoginAttempts) }))
  if (users.length !== 1 || users[0].email !== adminEmail || !users[0].passwordHash || canonicalJson(adminProjection) !== canonicalJson([expected.bootstrapAdministrator])) throw new Error('Managed shard bootstrap administrator seed drifted')
  assertOpaqueIds(users, 'bootstrap administrator')
  if (!await verifyPassword(adminPassword, users[0].passwordHash)) throw new Error('Managed shard bootstrap administrator credential does not match the supplied password')
  assertSeedTimestamps(users, 'bootstrap administrator')
  const memberships = await dataSource.getRepository('AuthzGroupMembership').find()
  const membershipFields = ['tenantId', 'groupId', 'source', 'sourceRef', 'expiresAt', 'createdById']
  const membershipProjection = project(memberships, membershipFields).sort((left, right) => left.groupId.localeCompare(right.groupId))
  const expectedMemberships = [...expected.bootstrapMemberships].sort((left, right) => left.groupId.localeCompare(right.groupId))
  if (memberships.some((membership) => membership.userId !== users[0].id) || canonicalJson(membershipProjection) !== canonicalJson(expectedMemberships)) throw new Error('Managed shard bootstrap administrator memberships drifted')
  assertOpaqueIds(memberships, 'bootstrap administrator membership')
  assertSeedTimestamps(memberships, 'bootstrap administrator membership')
  const auditRows = await dataSource.getRepository('AuditLog').find()
  assertOpaqueIds(auditRows, 'bootstrap authorization audit')
  if (auditRows.length !== memberships.length) throw new Error('Managed shard bootstrap authorization audit drifted')
  const auditResourceIds = auditRows.map((audit) => audit.resourceId).sort()
  const membershipIds = memberships.map((membership) => membership.id).sort()
  if (canonicalJson(auditResourceIds) !== canonicalJson(membershipIds)) throw new Error('Managed shard bootstrap authorization audit drifted')
  for (const audit of auditRows) {
    const membership = memberships.find((candidate) => candidate.id === audit.resourceId)
    const details = JSON.parse(audit.details)
    if (!membership || audit.tenantId !== null || audit.userId !== null || audit.action !== 'authz.group_membership.authenticate' || audit.resourceType !== 'authz_group_membership' || audit.ipAddress !== null || audit.userAgent !== null || !Number.isSafeInteger(Number(audit.createdAt)) || Number(audit.createdAt) <= 0 || canonicalJson(details) !== canonicalJson({ membershipId: membership.id, groupId: membership.groupId, userId: users[0].id, source: membership.source, sourceRef: membership.sourceRef })) throw new Error('Managed shard bootstrap authorization audit drifted')
  }

  const settings = await dataSource.getRepository('PlatformSettings').find()
  const settingsFields = dataSource.getMetadata('PlatformSettings').columns.filter((column) => column.propertyName !== 'updatedAt').map((column) => column.propertyName)
  const expectedSettings = exactDefaultEntityProjection(dataSource, 'PlatformSettings', { id: 'default' }, ['updatedAt'])
  if (settings.length !== 1 || canonicalJson(project(settings, settingsFields)) !== canonicalJson([expectedSettings]) || !Number.isSafeInteger(Number(settings[0].updatedAt)) || Number(settings[0].updatedAt) <= 0) throw new Error('Managed shard platform settings seed drifted')

  const templates = await dataSource.getRepository('EmailTemplate').find()
  const templateFields = ['id', 'type', 'name', 'subject', 'htmlTemplate', 'textTemplate', 'variables', 'isActive', 'createdByUserId', 'updatedByUserId']
  const templateProjection = project(templates, templateFields).sort((left, right) => left.id.localeCompare(right.id))
  const expectedTemplates = [...EMAIL_TEMPLATE_SEEDS].sort((left, right) => left.id.localeCompare(right.id))
  if (canonicalJson(templateProjection) !== canonicalJson(expectedTemplates)) throw new Error('Managed shard email template catalogue drifted')
  assertSeedTimestamps(templates, 'email template')

  const permissions = await dataSource.getRepository('RbacPermission').find()
  const permissionFields = ['id', 'key', 'scope', 'category', 'label', 'description', 'kind', 'isEditable', 'isArchived', 'createdById']
  const permissionProjection = project(permissions, permissionFields).sort((left, right) => left.id.localeCompare(right.id))
  const expectedPermissions = permissionDefinitions.map((permission) => ({ id: permission.key, key: permission.key, scope: permission.scope, category: permission.category, label: permission.label, description: permission.description, kind: 'system', isEditable: false, isArchived: false, createdById: null })).sort((left, right) => left.id.localeCompare(right.id))
  if (canonicalJson(permissionProjection) !== canonicalJson(expectedPermissions)) throw new Error('Managed shard RBAC permission catalogue drifted')
  assertSeedTimestamps(permissions, 'RBAC permission')

  const roles = await dataSource.getRepository('RbacRole').find()
  const roleFields = ['id', 'tenantId', 'key', 'roleKeyIdentity', 'name', 'description', 'scope', 'kind', 'isEditable', 'isAssignable', 'isArchived', 'source', 'sourceRef', 'ownershipMode', 'sourceHash', 'lastAppliedAt', 'driftStatus', 'createdById']
  const roleProjection = project(roles, roleFields).sort((left, right) => left.id.localeCompare(right.id))
  const expectedRoles = systemRoleDefinitions.map((role) => ({ id: role.id, tenantId: null, key: role.key, roleKeyIdentity: `platform:${role.key}`, name: role.name, description: role.description, scope: role.scope, kind: role.kind, isEditable: role.isEditable, isAssignable: role.isAssignable, isArchived: false, source: 'system', sourceRef: 'rbac-foundation', ownershipMode: 'manual', sourceHash: null, lastAppliedAt: null, driftStatus: null, createdById: null })).sort((left, right) => left.id.localeCompare(right.id))
  if (canonicalJson(roleProjection) !== canonicalJson(expectedRoles)) throw new Error('Managed shard RBAC system role catalogue drifted')
  assertSeedTimestamps(roles, 'RBAC system role')

  const rolePermissions = await dataSource.getRepository('RbacRolePermission').find()
  const rolePermissionFields = ['id', 'roleId', 'permissionId']
  const rolePermissionProjection = project(rolePermissions, rolePermissionFields).sort((left, right) => left.id.localeCompare(right.id))
  const expectedRolePermissions = systemRoleDefinitions.flatMap((role) => role.permissions.map((permissionId) => ({ id: `${role.id}:${permissionId}`, roleId: role.id, permissionId }))).sort((left, right) => left.id.localeCompare(right.id))
  if (canonicalJson(rolePermissionProjection) !== canonicalJson(expectedRolePermissions)) throw new Error('Managed shard RBAC role-permission catalogue drifted')
  assertCreatedTimestamps(rolePermissions, 'RBAC role-permission')

  const projectionStates = await dataSource.getRepository('AuthzMigrationState').find()
  assertOpaqueIds(projectionStates, 'authorization projection state')
  if (projectionStates.length !== 1 || projectionStates[0].key !== 'legacy-local-role-assignment-projection-v1' || !Number.isSafeInteger(Number(projectionStates[0].completedAt)) || Number(projectionStates[0].completedAt) <= 0 || canonicalJson(JSON.parse(projectionStates[0].details)) !== canonicalJson({ scannedProjects: 0, scannedEngines: 0, upserted: 0, removed: 0 })) throw new Error('Managed shard authorization projection state drifted')
}

async function assertExactRoleSafety(runner, schema, ownerRole, runtimeRole) {
  if (!ownerRole || ownerRole === runtimeRole) throw new Error('Managed shard owner and runtime roles must be distinct')
  const roles = await runner.query(`SELECT rolname,rolcanlogin,rolinherit,rolsuper,rolbypassrls,rolcreaterole,rolcreatedb,rolreplication
    FROM pg_roles WHERE rolname=ANY($1::text[]) ORDER BY rolname`, [[ownerRole, runtimeRole]])
  if (roles.length !== 2) throw new Error('Managed shard owner and runtime roles must both exist')
  for (const role of roles) {
    if (!role.rolcanlogin || role.rolinherit || role.rolsuper || role.rolbypassrls || role.rolcreaterole || role.rolcreatedb || role.rolreplication) throw new Error(`Managed shard ${role.rolname === ownerRole ? 'owner' : 'runtime'} role attributes are not restricted`)
  }
  const memberships = await runner.query(`SELECT parent.rolname AS parent_role,member.rolname AS member_role
    FROM pg_auth_members m JOIN pg_roles parent ON parent.oid=m.roleid JOIN pg_roles member ON member.oid=m.member
    WHERE m.roleid=ANY($1::regrole[]) OR m.member=ANY($1::regrole[])
    ORDER BY parent.rolname,member.rolname`, [[ownerRole, runtimeRole]])
  if (memberships.length) throw new Error('Managed shard owner and runtime roles must have no role memberships')
  const database = await runner.query(`SELECT owner.rolname AS owner_role,
      has_database_privilege($1,current_database(),'CREATE') AS runtime_create
    FROM pg_database d JOIN pg_roles owner ON owner.oid=d.datdba WHERE d.datname=current_database()`, [runtimeRole])
  if (database.length !== 1 || database[0].owner_role !== ownerRole) throw new Error('Managed shard owner role must own the target database')
  if (database[0].runtime_create) throw new Error('Managed shard runtime role must not create database objects')
  const namespaces = await runner.query(`SELECT owner.rolname AS owner_role,
      has_schema_privilege($2,n.oid,'CREATE') AS runtime_create
    FROM pg_namespace n JOIN pg_roles owner ON owner.oid=n.nspowner WHERE n.nspname=$1`, [schema, runtimeRole])
  if (namespaces.length && namespaces[0].owner_role !== ownerRole) throw new Error('Managed shard owner role must own the target schema')
  if (namespaces[0]?.runtime_create) throw new Error('Managed shard runtime role must not create schema objects')
  const runtimeObjects = await runner.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=$1 AND c.relowner=$2::regrole LIMIT 1`, [schema, runtimeRole])
  if (runtimeObjects.length) throw new Error('Managed shard runtime role must not own schema objects')
}

async function assertOwnerAndRuntimeGrants(runner, snapshot, schema, ledgerName, ownerRole, runtimeRole) {
  const ownerSchema = await runner.query('SELECT n.nspowner=$2::regrole AS owns_schema FROM pg_namespace n WHERE n.nspname=$1', [schema, ownerRole])
  if (ownerSchema.length !== 1 || !ownerSchema[0].owns_schema) throw new Error('Managed shard owner role is not the schema owner')
  const runtime = await runner.query(`SELECT has_schema_privilege($1,$2,'USAGE') AS usage,
      has_schema_privilege($1,$2,'CREATE') AS create_privilege,
      has_database_privilege($1,current_database(),'CREATE') AS database_create
    FROM pg_roles WHERE rolname=$1`, [runtimeRole, schema])
  if (runtime.length !== 1 || !runtime[0].usage || runtime[0].create_privilege || runtime[0].database_create) throw new Error('Managed shard runtime role is not the exact restricted login')
  const columnGrants = await runner.query(`SELECT c.relname AS relation_name,a.attname AS column_name,
      CASE WHEN acl.grantee=0 THEN 'PUBLIC' ELSE grantee.rolname END AS grantee,
      upper(acl.privilege_type) AS privilege_type,acl.is_grantable
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
    CROSS JOIN LATERAL aclexplode(a.attacl) acl
    LEFT JOIN pg_roles grantee ON grantee.oid=acl.grantee
    WHERE n.nspname=$1 AND a.attacl IS NOT NULL
    ORDER BY c.relname,a.attname,grantee,privilege_type`, [schema])
  if (columnGrants.length) throw new Error('Managed shard direct column privileges are forbidden')
  for (const relation of snapshot.relations) {
    const target = `${schema}.${relation.name}`
    const direct = await runner.query(`SELECT CASE WHEN acl.grantee=0 THEN 'PUBLIC' ELSE grantee.rolname END AS grantee,
      upper(acl.privilege_type) AS privilege_type,acl.is_grantable
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 'S'::"char" ELSE 'r'::"char" END,c.relowner))) acl
      LEFT JOIN pg_roles grantee ON grantee.oid=acl.grantee
      WHERE n.nspname=$1 AND c.relname=$2
      ORDER BY grantee,privilege_type`, [schema, relation.name])
    if (direct.some((grant) => grant.is_grantable)) throw new Error(`Managed shard direct grant option is forbidden for ${relation.name}`)
    const ownerPrivileges = direct.filter((grant) => grant.grantee === ownerRole).map((grant) => grant.privilege_type)
    const runtimePrivileges = direct.filter((grant) => grant.grantee === runtimeRole).map((grant) => grant.privilege_type)
    const unexpectedGrantees = [...new Set(direct.map((grant) => grant.grantee).filter((grantee) => ![ownerRole, runtimeRole].includes(grantee)))]
    if (unexpectedGrantees.length) throw new Error(`Managed shard relation has an unexpected grantee: ${relation.name}`)
    if (['r', 'p'].includes(relation.kind)) {
      const rows = await runner.query(`SELECT has_table_privilege($1,$2,'SELECT') AS select_ok,
        has_table_privilege($1,$2,'INSERT') AS insert_ok,has_table_privilege($1,$2,'UPDATE') AS update_ok,
        has_table_privilege($1,$2,'DELETE') AS delete_ok,has_table_privilege($1,$2,'TRUNCATE,REFERENCES,TRIGGER') AS unsafe`, [runtimeRole, target])
      const row = rows[0]
      const ledger = relation.name === ledgerName
      const expectedPrivileges = ledger ? ['SELECT'] : ['DELETE', 'INSERT', 'SELECT', 'UPDATE']
      const expectedOwnerPrivileges = ['DELETE', 'INSERT', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE']
      if (canonicalJson(ownerPrivileges) !== canonicalJson(expectedOwnerPrivileges) || canonicalJson(runtimePrivileges) !== canonicalJson(expectedPrivileges) || !row?.select_ok || row.unsafe || (ledger ? row.insert_ok || row.update_ok || row.delete_ok : !row.insert_ok || !row.update_ok || !row.delete_ok)) throw new Error(`Managed shard relation grant drifted for ${relation.name}`)
    } else if (relation.kind === 'S') {
      const rows = await runner.query(`SELECT has_sequence_privilege($1,$2,'SELECT') AS select_ok,has_sequence_privilege($1,$2,'USAGE') AS usage_ok,has_sequence_privilege($1,$2,'UPDATE') AS update_ok`, [runtimeRole, target])
      const ledgerSequence = relation.name === `${ledgerName}_id_seq`
      const expectedPrivileges = ledgerSequence ? ['SELECT'] : ['SELECT', 'USAGE']
      const expectedOwnerPrivileges = ['SELECT', 'UPDATE', 'USAGE']
      if (canonicalJson(ownerPrivileges) !== canonicalJson(expectedOwnerPrivileges) || canonicalJson(runtimePrivileges) !== canonicalJson(expectedPrivileges) || !rows[0]?.select_ok || (ledgerSequence ? rows[0].usage_ok || rows[0].update_ok : !rows[0].usage_ok || rows[0].update_ok)) throw new Error(`Managed shard relation grant drifted for ${relation.name}`)
    }
  }
  const defaults = await runner.query(`SELECT owner.rolname AS owner_role,d.defaclobjtype,n.nspname AS schema_name,
      CASE WHEN acl.grantee=0 THEN 'PUBLIC' ELSE grantee.rolname END AS grantee,
      upper(acl.privilege_type) AS privilege_type,acl.is_grantable
    FROM pg_default_acl d
    JOIN pg_roles owner ON owner.oid=d.defaclrole
    LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
    CROSS JOIN LATERAL aclexplode(d.defaclacl) acl
    LEFT JOIN pg_roles grantee ON grantee.oid=acl.grantee
    WHERE d.defaclrole=$1::regrole AND d.defaclobjtype IN ('r','S')
      AND (d.defaclnamespace=0 OR n.nspname=$2)
    ORDER BY d.defaclobjtype,n.nspname,grantee,privilege_type`, [ownerRole, schema])
  const expectedDefaults = [
    { owner_role: ownerRole, defaclobjtype: 'S', schema_name: schema, grantee: runtimeRole, privilege_type: 'SELECT', is_grantable: false },
    { owner_role: ownerRole, defaclobjtype: 'r', schema_name: schema, grantee: runtimeRole, privilege_type: 'SELECT', is_grantable: false },
  ]
  if (canonicalJson(defaults) !== canonicalJson(expectedDefaults)) throw new Error(`Managed shard runtime default privileges drifted (${canonicalJson(defaults)})`)
}

async function relocateGitProvidersToDefaultTenant(dataSource, tenantId) {
  const repo = dataSource.getRepository('GitProvider')
  const providers = await repo.find()
  for (const provider of providers) {
    if (provider.tenantId !== tenantId) await repo.save({ ...provider, tenantId })
  }
}

async function applySignedSchemaPlan(dataSource, runner, manifest, MigrationExecutor) {
  const memory = await dataSource.driver.createSchemaBuilder().log()
  const upQueries = memory.upQueries.map((query) => ({ query: query.query, parameters: query.parameters || [] }))
  const digest = sha256(canonicalJson(upQueries))
  if (digest !== manifest.execution.schemaPlan.sha256) throw new Error(`Exact predecessor TypeORM schema plan differs from the signed bootstrap manifest (${digest})`)
  const supplemental = manifest.execution.schemaPlan.supplementalMigrations.map((name) => {
    const migration = dataSource.migrations.find((candidate) => migrationIdentity(candidate).name === name)
    if (!migration) throw new Error(`Signed supplemental predecessor migration is unavailable: ${name}`)
    return migration
  })
  if (runner.isTransactionActive) throw new Error('Managed-shard schema-plan transaction must own its query runner')
  await runner.startTransaction()
  try {
    for (const query of upQueries) await runner.query(query.query, query.parameters)
    for (const migration of supplemental) await migration.up(runner)
    const executor = new MigrationExecutor(dataSource, runner)
    executor.transaction = manifest.execution.transaction
    executor.fake = true
    await executor.executePendingMigrations()
    await runner.commitTransaction()
  } catch (error) {
    await runner.rollbackTransaction()
    throw error
  }
}

async function main() {
  const manifestPath = process.env.EG_MANAGED_SHARD_BOOTSTRAP_MANIFEST || DEFAULT_MANIFEST
  const sharedRoot = process.env.EG_MANAGED_SHARD_PREDECESSOR_SHARED_ROOT || DEFAULT_SHARED
  const manifestBytes = await readFile(manifestPath)
  const manifest = await loadManagedShardBootstrapManifest(manifestPath)
  assertBootstrapEnabled(process.env, manifest)
  await assertImplementationInventory(manifest, manifestPath)
  if (process.env.ENTERPRISEGLUE_HOST_VERSION !== '0.24.2' || process.env.EG_MANAGED_SHARD_PREDECESSOR_REVISION !== manifest.predecessor.sourceRevision || process.env.EG_MANAGED_SHARD_PREDECESSOR_DIGEST !== manifest.predecessor.backendSubject.split('@')[1]) throw new Error('Running image is not bound to the signed v0.24.2 predecessor artifact')
  const receiptPath = process.env.EG_MANAGED_SHARD_BOOTSTRAP_RECEIPT_PATH
  if (!receiptPath || !path.isAbsolute(receiptPath)) throw new Error('EG_MANAGED_SHARD_BOOTSTRAP_RECEIPT_PATH must be an absolute new file')
  const dataSourceModule = await import(`${sharedRoot}/db/data-source.js`)
  const migrationsModule = await import(`${sharedRoot}/db/run-migrations.js`)
  const bootstrapModule = await import(`${sharedRoot}/db/bootstrap.js`)
  const gitProvidersModule = await import(`${sharedRoot}/db/seed/gitProviders.js`)
  const environmentTagsModule = await import(`${sharedRoot}/services/platform-admin/EnvironmentTagService.js`)
  const permissionsModule = await import(`${sharedRoot}/services/platform-admin/permissions.js`)
  const passwordModule = await import(`${sharedRoot}/utils/password.js`)
  const rlsModule = await import(`${sharedRoot}/db/postgres-tenant-rls.js`)
  const grantsModule = await import(`${sharedRoot}/db/postgres-runtime-grants.js`)
  const predecessorRequire = createRequire(`${sharedRoot}/db/data-source.js`)
  const { MigrationExecutor } = predecessorRequire('typeorm/migration/MigrationExecutor.js')
  const source = await dataSourceModule.getDataSource()
  if (source.options.type !== 'postgres') throw new Error('Managed-shard bootstrap requires the PostgreSQL TypeORM adapter')
  const schema = source.options.schema || 'public'
  const ledgerName = source.options.migrationsTableName || 'migrations'
  const registered = source.migrations.map(migrationIdentity)
  assertMigrationInventory('Published runtime', registered, manifest.predecessor.migrationInventory)
  const runner = source.createQueryRunner()
  await runner.connect()
  let locked = false
  try {
    const roleRows = await runner.query('SELECT current_user AS role')
    const ownerRole = roleRows[0]?.role
    const schemaLockId = Number.parseInt(sha256(`schema:${schema}`).slice(0, 8), 16) | 0
    await runner.query('SELECT pg_advisory_lock($1,$2)', [manifest.execution.advisoryLock.classId, schemaLockId])
    locked = true
    await assertExactRoleSafety(runner, schema, ownerRole, process.env.EG_POSTGRES_RUNTIME_ROLE)
    let snapshot = await readSnapshot(runner, schema, ledgerName)
    const startingState = classifyStartingState(snapshot, manifest)
    if (startingState === 'exact-bootstrap-0130') {
      assertExactSchemaObjects(snapshot, source, schema, ledgerName, ownerRole, manifest)
      await assertNoTypeOrmSchemaDrift(source)
      await assertExactLegacyPolicies(runner, snapshot, source, schema, rlsModule.POSTGRES_TENANT_RLS_TABLES)
      await assertExactSeeds(source, manifest, process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD, permissionsModule.PermissionCatalog, permissionsModule.SystemRoleDefinitions, passwordModule.verifyPassword)
      await assertOrdinaryTablesEmpty(runner, source, schema, manifest)
      await assertExactRoleSafety(runner, schema, ownerRole, process.env.EG_POSTGRES_RUNTIME_ROLE)
      await assertOwnerAndRuntimeGrants(runner, snapshot, schema, ledgerName, ownerRole, process.env.EG_POSTGRES_RUNTIME_ROLE)
    } else {
      if (!snapshot.schemaExists) await runner.createSchema(schema, true)
      await applySignedSchemaPlan(source, runner, manifest, MigrationExecutor)
      const executed = (await runner.query(`SELECT name,timestamp FROM ${tableRef(schema, ledgerName)} ORDER BY timestamp,name`)).map((row) => ({ name: row.name, timestamp: Number(row.timestamp) }))
      assertMigrationInventory('Executed ledger', executed, manifest.predecessor.migrationInventory)
      await migrationsModule.seedInitialData()
      await bootstrapModule.bootstrapAdmin()
      await gitProvidersModule.seedGitProviders()
      await relocateGitProvidersToDefaultTenant(source, manifest.postcondition.defaultTenant.id)
      await environmentTagsModule.environmentTagService.seedDefaults()
      await grantsModule.refreshPostgresRuntimeGrants(runner, process.env.EG_POSTGRES_RUNTIME_ROLE)
      snapshot = await readSnapshot(runner, schema, ledgerName)
      classifyStartingState(snapshot, manifest)
      assertExactSchemaObjects(snapshot, source, schema, ledgerName, ownerRole, manifest)
      await assertNoTypeOrmSchemaDrift(source)
      await assertExactLegacyPolicies(runner, snapshot, source, schema, rlsModule.POSTGRES_TENANT_RLS_TABLES)
      await assertExactSeeds(source, manifest, process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD, permissionsModule.PermissionCatalog, permissionsModule.SystemRoleDefinitions, passwordModule.verifyPassword)
      await assertOrdinaryTablesEmpty(runner, source, schema, manifest)
      await assertExactRoleSafety(runner, schema, ownerRole, process.env.EG_POSTGRES_RUNTIME_ROLE)
      await assertOwnerAndRuntimeGrants(runner, snapshot, schema, ledgerName, ownerRole, process.env.EG_POSTGRES_RUNTIME_ROLE)
    }
    const receipt = createBootstrapReceipt({
      manifest,
      manifestSha256: sha256(manifestBytes),
      shardId: process.env.EG_MANAGED_SHARD_ID,
      action: startingState === 'pristine-schema' ? 'bootstrapped' : 'verified-existing',
      schema,
      role: ownerRole,
      runtimeRole: process.env.EG_POSTGRES_RUNTIME_ROLE,
      relationCount: snapshot.relations.length,
      policyCount: snapshot.policies.length,
    })
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    process.stdout.write(`${JSON.stringify(receipt)}\n`)
  } finally {
    if (locked) await runner.query('SELECT pg_advisory_unlock($1,$2)', [manifest.execution.advisoryLock.classId, Number.parseInt(sha256(`schema:${schema}`).slice(0, 8), 16) | 0])
    await runner.release()
    await dataSourceModule.closeDataSource()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => {
  console.error(`[managed-shard-bootstrap] ${error.message}`)
  process.exitCode = 1
})

export { assertExactRoleSafety, assertExactSchemaObjects, assertExactSeeds, assertNoTypeOrmSchemaDrift, assertOrdinaryTablesEmpty, assertOwnerAndRuntimeGrants, readSnapshot }
