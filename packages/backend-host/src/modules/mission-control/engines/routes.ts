import { Router, Request, Response, type NextFunction } from 'express'
import { existsSync } from 'fs'
import { createHash } from 'node:crypto'
import { generateId } from '@enterpriseglue/shared/utils/id.js'
import { z } from 'zod'
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js'
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js'
import { EngineMember } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineMember.js'
import { EngineTenantMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineTenantMapping.js'
import { EngineSetMaterialization } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineSetMaterialization.js'
import { RbacRoleAssignment } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRoleAssignment.js'
import { RuntimeResource } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResource.js'
import { RuntimeResourceSet } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResourceSet.js'
import { RuntimeResourceSetMaterialization } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResourceSetMaterialization.js'
import { ExternalEngineRegistration } from '@enterpriseglue/shared/infrastructure/persistence/entities/ExternalEngineRegistration.js'
import { ExternalEngineSystem } from '@enterpriseglue/shared/infrastructure/persistence/entities/ExternalEngineSystem.js'
import { ProjectEngineTarget } from '@enterpriseglue/shared/infrastructure/persistence/entities/ProjectEngineTarget.js'
import { EngineBackstopGroupMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineBackstopGroupMapping.js'
import { SavedFilter } from '@enterpriseglue/shared/infrastructure/persistence/entities/SavedFilter.js'
import { EngineHealth } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineHealth.js'
import { In, Not, IsNull, type DataSource, type EntityManager } from 'typeorm'
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js'
import { requireApiClientAction } from '@enterpriseglue/shared/middleware/apiClientAuth.js'
import { requireAction } from '@enterpriseglue/shared/middleware/requireAction.js'
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js'
import { validateBody, validateParams, validateQuery } from '@enterpriseglue/shared/middleware/validate.js'
import { apiLimiter, engineLimiter, engineRegistrationLimiter, reconciliationLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js'
import {
  engineService,
  engineSetService,
  platformSettingsService,
  projectEngineTargetService,
  ApiClientScopes,
} from '@enterpriseglue/shared/services/platform-admin/index.js'
import { engineTenancyProvisioningService } from '@enterpriseglue/shared/services/platform-admin/EngineTenancyProvisioningService.js'
import { engineTenantMappingService } from '@enterpriseglue/shared/services/platform-admin/EngineTenantMappingService.js'
import { engineTenancyTransitionService } from '@enterpriseglue/shared/services/platform-admin/EngineTenancyTransitionService.js'
import { engineMetadataReconciliationService } from '@enterpriseglue/shared/services/platform-admin/EngineMetadataReconciliationService.js'
import { runtimeResourceInventoryService } from '@enterpriseglue/shared/services/platform-admin/RuntimeResourceInventoryService.js'
import { EnginePermissions, ExternalEngineSystemPermissions, PlatformPermissions, permissionService } from '@enterpriseglue/shared/services/platform-admin/permissions.js'
import { ENGINE_OPERATION_CAPABILITIES, getEngineCapabilities, withEngineCapabilities } from '@enterpriseglue/shared/services/bpmn-engine-capabilities.js'
import { describeBpmnEngineTransport, fetchBpmnEngineEndpoint, validateBpmnEngineEndpointUrl } from '@enterpriseglue/shared/services/bpmn-engine-client.js'
import { secretResolver } from '@enterpriseglue/shared/services/platform-admin/SecretResolver.js'
import { configBundleApplyService } from '@enterpriseglue/shared/services/platform-admin/ConfigBundleApplyService.js'
import { configBundleDiffService } from '@enterpriseglue/shared/services/platform-admin/ConfigBundleDiffService.js'
import { configBundlePreviewService } from '@enterpriseglue/shared/services/platform-admin/ConfigBundlePreviewService.js'
import { config } from '@enterpriseglue/shared/config/index.js'
import { isEngineVisibleInTenancyContext } from '@enterpriseglue/shared/engine-tenancy/visibility.js'
import { normalizeTenantIdForPersistence, OSS_DEFAULT_TENANT_ID } from '@enterpriseglue/shared/authz/tenant-scope.js'
import { logAudit } from '@enterpriseglue/shared/services/audit.js'
import { logger } from '@enterpriseglue/shared/utils/logger.js'
import {
  AccessibleEngineSummarySchema,
  CreateEngineRequestSchema,
  EngineConnectionHealthResponseSchema,
  EngineInventoryQuerySchema,
  EngineTenancyClassificationReportSchema,
  EngineTenancyTransitionApplyRequestSchema,
  EngineTenancyTransitionApplyResponseSchema,
  EngineTenancyTransitionPreviewRequestSchema,
  EngineTenancyTransitionPreviewResponseSchema,
  EndpointAuthenticationPolicyMessages,
  EngineRuntimeQueryCapabilitiesSchema,
  EngineTenantMappingSchema,
  ExternalEngineDecommissionRequestSchema,
  ExternalEngineTenantMappingsUpsertRequestSchema,
  ExternalEngineRegistrationRequestSchema,
  UpdateEngineRequestSchema,
} from '@enterpriseglue/shared/schemas/mission-control/engine.js'
import {
  SavedFilterCreateRequestSchema,
  SavedFilterResponseSchema,
  SavedFilterUpdateRequestSchema,
} from '@enterpriseglue/shared/schemas/mission-control/saved-filter.js'
import { engineRegistrationJsonPayloadLimit } from '@enterpriseglue/shared/middleware/requestSizeLimit.js'
import { EngineMetadataReconciliationResultSchema } from '@enterpriseglue/shared/schemas/platform-admin/deployment-receipt.js'
import { ProjectEngineTargetDiagnosticsSchema, ProjectEngineTargetSchema, RuntimeResourceSchema } from '@enterpriseglue/shared/schemas/platform-admin/authz.js'
import { CamundaNativeAuthorizationExportSchema, CamundaNativeGrantClassificationSchema, CamundaNativeGrantImportRunHistorySchema } from '@enterpriseglue/shared/schemas/platform-admin/camunda-native-grants.js'
import { camundaNativeGrantInventoryService, classifyCamundaNativeGrant } from '@enterpriseglue/shared/services/platform-admin/CamundaNativeGrantInventoryService.js'
import { assertCamundaNativeGrantMigrationContext, camundaNativeGrantMigrationCommitments, CamundaNativeGrantEvidenceLimitError, camundaNativeGrantImportRunService } from '@enterpriseglue/shared/services/platform-admin/CamundaNativeGrantImportRunService.js'
import { camundaNativeGrantDraftService, camundaNativeGrantExternalEngineKey } from '@enterpriseglue/shared/services/platform-admin/CamundaNativeGrantDraftService.js'
import { EngineBackstopGroupMappingWriteRequestSchema, EngineBackstopGroupMappingWriteResponseSchema, EngineBackstopSyncApplyRequestSchema, EngineBackstopSyncRollbackRequestSchema, EngineBackstopSyncRunHistorySchema, EngineBackstopSyncRunSummarySchema } from '@enterpriseglue/shared/schemas/platform-admin/engine-backstop.js'
import { engineBackstopGroupMappingService } from '@enterpriseglue/shared/services/platform-admin/EngineBackstopGroupMappingService.js'
import { EngineBackstopEvidenceLimitError, engineBackstopSyncRunService } from '@enterpriseglue/shared/services/platform-admin/EngineBackstopSyncRunService.js'
import { engineBackstopSyncService } from '@enterpriseglue/shared/services/platform-admin/EngineBackstopSyncService.js'

type RequestWithAuthorizedEngineIds = Request & { authorizedEngineIds?: string[] }

// Validation schemas
const engineIdParamSchema = z.object({ id: z.string().min(1) })
const externalEngineIdParamSchema = z.object({ externalId: z.string().min(1).max(255) })
const runtimeResourceInventoryQuerySchema = z.object({
  resourceKind: z.enum(['process_definition', 'decision_definition']).optional(),
  includeInactive: z.enum(['true', 'false']).optional(),
})
const nativeGrantImportRunIdParamSchema = z.object({ id: z.string().min(1), runId: z.string().min(1) })
const nativeGrantPreviewBodySchema = z.object({
  sourceKind: z.enum(['live_api', 'customer_export']),
  customerExport: CamundaNativeAuthorizationExportSchema.optional(),
}).strict().superRefine((value, ctx) => {
  if (value.sourceKind === 'customer_export' && !value.customerExport) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['customerExport'], message: 'customerExport is required for a customer_export preview' })
  if (value.sourceKind === 'live_api' && value.customerExport) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['customerExport'], message: 'customerExport is allowed only for a customer_export preview' })
})
const nativeGrantDraftBodySchema = z.object({
  base: z.object({ bundle: z.unknown(), files: z.record(z.string(), z.unknown()) }).strict(),
  groupMappings: z.array(z.union([
    z.object({ nativeGroupId: z.string().min(1).max(255), target: z.object({ mode: z.literal('existing'), key: z.string().min(3).max(160) }).strict() }).strict(),
    z.object({ nativeGroupId: z.string().min(1).max(255), target: z.object({ mode: z.literal('new'), key: z.string().min(3).max(160), name: z.string().min(1).max(255), description: z.string().max(2000).optional() }).strict() }).strict(),
  ])).max(5_000),
}).strict()
const nativeGrantApplyBodySchema = z.object({
  expectedDraftHash: z.string().regex(/^[a-f0-9]{64}$/),
  acknowledgements: z.array(z.string().min(1).max(500)).max(100).optional(),
}).strict()
const nativeGrantRollbackPreviewBodySchema = z.object({}).strict()
const nativeGrantRollbackBodySchema = z.object({
  expectedRollbackHash: z.string().regex(/^[a-f0-9]{64}$/),
  acknowledgements: z.array(z.string().min(1).max(500)).max(100),
}).strict()
const backstopPreviewBodySchema = z.object({}).strict()
const backstopSyncRunIdParamSchema = z.object({ id: z.string().min(1), runId: z.string().min(1) })

/**
 * Native-grant imports deliberately start from an empty, dedicated additive
 * bundle. That makes rollback precise: an authoritative empty version of the
 * same bundle can retire only records created by this import sourceRef.
 */
function assertDedicatedNativeGrantMigrationBase(base: unknown): void {
  if (!base || typeof base !== 'object' || Array.isArray(base)) throw Errors.validation('Native-grant migration base must be an object')
  const value = base as { bundle?: unknown; files?: unknown }
  if (!value.bundle || typeof value.bundle !== 'object' || Array.isArray(value.bundle) || !value.files || typeof value.files !== 'object' || Array.isArray(value.files)) {
    throw Errors.validation('Native-grant migration base must contain bundle and files objects')
  }
  const bundle = value.bundle as { metadata?: { key?: unknown }; mode?: unknown; imports?: unknown }
  const files = value.files as Record<string, unknown>
  const imports = bundle.imports
  if (
    bundle.mode !== 'additive'
    || typeof bundle.metadata?.key !== 'string'
    || !/^migration\.camunda-native-[a-z0-9][a-z0-9.-]*$/.test(bundle.metadata.key)
    || !Array.isArray(imports)
    || imports.length !== 1
    || imports[0] !== './groups.json'
    || Object.keys(files).length !== 1
    || !files['./groups.json']
    || typeof files['./groups.json'] !== 'object'
    || Array.isArray(files['./groups.json'])
    || !Array.isArray((files['./groups.json'] as { groups?: unknown }).groups)
    || (files['./groups.json'] as { groups: unknown[] }).groups.length !== 0
  ) {
    throw Errors.validation('Native-grant migration requires a new empty additive migration bundle with only ./groups.json')
  }
}

const requireDedicatedCamundaNativeGrantEngine = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const tenantId = normalizeTenantIdForPersistence(req.tenant?.tenantId) || OSS_DEFAULT_TENANT_ID
  const engine = await (await getDataSource()).getRepository(Engine).findOne({ where: { id: String(req.params.id) } })
  if (!engine || !isEngineVisibleInTenancyContext(engine, tenantId)) throw Errors.notFound('Engine')
  if (engine.type !== 'camunda7') throw Errors.validation('Camunda native-grant migration is available only for Camunda 7 engines')
  if (engine.tenancyMode !== 'dedicated' || !tenantId || engine.tenantId !== tenantId) {
    throw Errors.validation('Camunda native-grant migration is available only for a dedicated engine in its owning tenant')
  }
  next()
})

function nativeGrantRollbackConfiguration(draft: { bundle: unknown; files: Record<string, unknown> }): { bundle: unknown; files: Record<string, unknown> } {
  if (!draft.bundle || typeof draft.bundle !== 'object' || Array.isArray(draft.bundle)) throw Errors.validation('Reviewed native-grant draft is invalid')
  const bundle = structuredClone(draft.bundle) as { imports?: unknown; mode?: unknown }
  const imports = bundle.imports
  const properties: Record<string, string> = {
    './groups.json': 'groups',
    './roles.json': 'roles',
    './runtime-resource-sets.json': 'runtimeResourceSets',
    './assignments.json': 'assignments',
  }
  if (!Array.isArray(imports) || imports.length !== 4 || imports.some((path) => typeof path !== 'string' || !properties[path])) {
    throw Errors.validation('Reviewed native-grant draft has an unsafe rollback shape')
  }
  bundle.mode = 'authoritative'
  return {
    bundle,
    files: Object.fromEntries((imports as string[]).map((path) => [path, { [properties[path]]: [] }])),
  }
}
const engineManagementModeSchema = z.enum(['external_managed', 'hybrid'])
const engineLifecycleStatusSchema = z.enum(['active', 'disabled', 'stale', 'decommissioned'])
const engineFieldOwnerSchema = z.enum(['manual', 'external'])
const externalEngineCapabilitiesSchema = z.object({
  operations: z.array(z.enum(ENGINE_OPERATION_CAPABILITIES)).optional(),
  queryCapabilities: EngineRuntimeQueryCapabilitiesSchema.optional(),
  supportLevel: z.string().max(128).nullable().optional(),
  compatibilityProfile: z.string().max(128).nullable().optional(),
}).passthrough()
type EngineFieldOwner = z.infer<typeof engineFieldOwnerSchema>
type EngineFieldOwnership = Record<string, EngineFieldOwner>
type EngineLifecycleStatus = z.infer<typeof engineLifecycleStatusSchema>
type ExternalEngineCapabilities = z.infer<typeof externalEngineCapabilitiesSchema>

const isLocalOrPrivate = (raw: string): boolean => {
  try {
    const host = new URL(raw).hostname
    // Private IPs, localhost, IPv6 loopback
    if (/^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|\[::1\])$/.test(host)) return true
    // Docker-internal: service names (no dots), host.docker.internal, *.local
    if (!host.includes('.') || host === 'host.docker.internal' || host.endsWith('.local')) return true
    return false
  } catch { return false }
}

const isLoopbackHost = (raw: string): boolean => {
  try {
    const host = new URL(raw).hostname
    return /^(localhost|127\.\d+\.\d+\.\d+|::1|\[::1\])$/.test(host)
  } catch {
    return false
  }
}

const isDockerRuntime = (): boolean => {
  if (process.env.EG_RUNTIME_MODE === 'docker') return true
  return existsSync('/.dockerenv')
}

const getDockerHostSuggestion = (raw: string): string => {
  try {
    const rewritten = new URL(raw)
    rewritten.hostname = 'host.docker.internal'
    return rewritten.toString()
  } catch {
    return 'http://host.docker.internal:8080/engine-rest'
  }
}

const getDockerLoopbackEngineError = (raw?: string): string | null => {
  if (!raw || !isDockerRuntime() || !isLoopbackHost(raw)) return null
  const suggested = getDockerHostSuggestion(raw)
  return `This EnterpriseGlue instance is running in Docker. Engine URLs using localhost or 127.0.0.1 point to the container itself. Use ${suggested} instead.`
}

function parseIpv4(host: string): number[] | null {
  const parts = host.split('.')
  if (parts.length !== 4) return null
  const octets = parts.map((part) => Number(part))
  if (octets.some((octet, index) => !/^\d+$/.test(parts[index]) || octet < 0 || octet > 255)) return null
  return octets
}

function isBlockedIpv4Literal(host: string): boolean {
  const octets = parseIpv4(host)
  if (!octets) return false
  const [first, second] = octets
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    first >= 224
  )
}

function isBlockedIpv6Literal(host: string): boolean {
  const normalized = host.replace(/^\[|\]$/g, '').toLowerCase()
  return (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fe80:') ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('ff') ||
    normalized.startsWith('::ffff:127.') ||
    normalized.startsWith('::ffff:10.') ||
    normalized.startsWith('::ffff:169.254.') ||
    normalized.startsWith('::ffff:192.168.')
  )
}

function getExternalRegistrationUrlError(raw: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return 'Engine URL must be a valid URL'
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return 'External engine URLs must use HTTP or HTTPS'
  }
  if (parsed.username || parsed.password) {
    return 'External engine URLs must not include embedded credentials'
  }

  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (
    host === 'localhost' ||
    host === 'host.docker.internal' ||
    host === 'metadata.google.internal' ||
    host === 'metadata' ||
    host.endsWith('.local') ||
    !host.includes('.')
  ) {
    return 'External engine URL host is not allowed'
  }
  if (isBlockedIpv4Literal(host) || isBlockedIpv6Literal(host)) {
    return 'External engine URL host resolves to a blocked local, private, link-local, or reserved address literal'
  }

  return null
}

const baseUrlSchema = z.string().min(1).url().refine(
  (url) => config.nodeEnv !== 'production'
    || url.startsWith('https://')
    || isLocalOrPrivate(url)
    || process.env.EG_ALLOW_INSECURE_ENGINE_HTTP === 'true',
  { message: 'Engine base URL must use HTTPS in production unless insecure HTTP is explicitly enabled for a reviewed endpoint' }
)

const externalRegistrationUrlSchema = baseUrlSchema.superRefine((url, ctx) => {
  const error = getExternalRegistrationUrlError(url)
  if (error) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: error })
  }
})

const createEngineBodySchema = CreateEngineRequestSchema.extend({
  baseUrl: baseUrlSchema,
})

const updateEngineBodySchema = UpdateEngineRequestSchema.extend({
  baseUrl: baseUrlSchema.optional(),
})

function assertEngineEndpointPolicy(baseUrl: string, oauthTokenUrl?: string | null): void {
  validateBpmnEngineEndpointUrl(baseUrl, 'Engine base URL')
  if (oauthTokenUrl) validateBpmnEngineEndpointUrl(oauthTokenUrl, 'OAuth2 token URL')
}

const DEFAULT_EXTERNAL_ENGINE_FIELD_OWNERSHIP: EngineFieldOwnership = {
  identity: 'external',
  connection: 'external',
  metadata: 'external',
  labels: 'external',
  auth: 'external',
  version: 'external',
  tenancy: 'external',
  display: 'manual',
  environment: 'manual',
}

const ENGINE_UPDATE_FIELD_GROUPS: Record<string, string> = {
  name: 'display',
  baseUrl: 'connection',
  connectionMode: 'connection',
  type: 'metadata',
  externalId: 'identity',
  labels: 'labels',
  authType: 'auth',
  username: 'auth',
  passwordEnc: 'auth',
  oauthTokenUrl: 'auth',
  oauthScopes: 'auth',
  oauthAudience: 'auth',
  version: 'version',
  environmentTagId: 'environment',
  runtimeAccessScope: 'metadata',
  deploymentIntegration: 'metadata',
  metadataDiscoveryEnabled: 'metadata',
  deploymentDiscoveryEnabled: 'metadata',
  reconciliationIntervalSeconds: 'metadata',
  pipelineReceiptEnabled: 'metadata',
  tenancy: 'tenancy',
}

const EXTERNAL_PAYLOAD_FIELD_BY_REQUEST_FIELD: Record<string, string> = {
  name: 'name',
  baseUrl: 'baseUrl',
  connectionMode: 'connectionMode',
  type: 'type',
  externalId: 'externalId',
  labels: 'labelsJson',
  authType: 'authType',
  username: 'username',
  passwordEnc: 'passwordEnc',
  oauthTokenUrl: 'oauthTokenUrl',
  oauthScopes: 'oauthScopes',
  oauthAudience: 'oauthAudience',
  version: 'version',
  environmentTagId: 'environmentTagId',
  runtimeAccessScope: 'runtimeAccessScope',
  deploymentIntegration: 'deploymentIntegration',
  metadataDiscoveryEnabled: 'metadataDiscoveryEnabled',
  deploymentDiscoveryEnabled: 'deploymentDiscoveryEnabled',
  reconciliationIntervalSeconds: 'reconciliationIntervalSeconds',
  pipelineReceiptEnabled: 'pipelineReceiptEnabled',
}

const ENGINE_SECRET_UPDATE_FIELDS = [
  'authType',
  'username',
  'passwordEnc',
  'oauthTokenUrl',
  'oauthScopes',
  'oauthAudience',
] as const

function engineTenantReferenceResolver(req: Request) {
  return req.app.locals.engineTenantReferenceResolver || null
}

const externalRegisterEngineBodySchema = ExternalEngineRegistrationRequestSchema.extend({
  baseUrl: externalRegistrationUrlSchema,
  oauthTokenUrl: externalRegistrationUrlSchema.nullable().optional(),
  capabilities: externalEngineCapabilitiesSchema.optional(),
})
const externalTenantMappingsBodySchema = ExternalEngineTenantMappingsUpsertRequestSchema.extend({
  externalSystemId: z.string().min(1).nullable().optional(),
})

const externalProjectEngineTargetModeFlagsSchema = z.object({
  allowManualDeploy: z.boolean().optional(),
  allowCiDeploy: z.boolean().optional(),
  allowApiDeploy: z.boolean().optional(),
  allowImport: z.boolean().optional(),
})

const externalProjectEngineTargetBaseObjectSchema = externalProjectEngineTargetModeFlagsSchema.extend({
  externalSystemId: z.string().min(1),
  projectId: z.string().min(1),
  engineId: z.string().min(1).optional(),
  externalEngineId: z.string().min(1).max(255).optional(),
  externalProjectId: z.string().min(1).max(255).optional(),
  externalTargetId: z.string().min(1).max(255).optional(),
  approvalStatus: z.enum(['not_required', 'pending', 'approved', 'rejected']).optional(),
  policyTags: z.array(z.string().min(1).max(128)).optional(),
  diagnostics: ProjectEngineTargetDiagnosticsSchema.nullable().optional(),
})

const externalProjectEngineTargetUpsertBodySchema = externalProjectEngineTargetBaseObjectSchema.extend({
  status: z.enum(['active', 'disabled']).optional(),
}).refine((value) => Boolean(value.engineId || value.externalEngineId), {
  message: 'engineId or externalEngineId is required',
  path: ['engineId'],
})

const externalProjectEngineTargetDecommissionBodySchema = externalProjectEngineTargetBaseObjectSchema.pick({
  externalSystemId: true,
  projectId: true,
  engineId: true,
  externalEngineId: true,
  externalProjectId: true,
  externalTargetId: true,
}).refine((value) => Boolean(value.engineId || value.externalEngineId), {
  message: 'engineId or externalEngineId is required',
  path: ['engineId'],
})

const createSavedFilterBodySchema = SavedFilterCreateRequestSchema
const updateSavedFilterBodySchema = SavedFilterUpdateRequestSchema

const r = Router()

function serializeSavedFilter(row: Pick<SavedFilter, 'id' | 'name' | 'engineId' | 'defKeys' | 'active' | 'incidents' | 'completed' | 'canceled' | 'createdAt'> & { version: number | string | null }) {
  return SavedFilterResponseSchema.parse({
    id: row.id,
    name: row.name,
    engineId: row.engineId,
    defKeys: JSON.parse(row.defKeys || '[]'),
    version: row.version ?? null,
    active: Boolean(row.active),
    incidents: Boolean(row.incidents),
    completed: Boolean(row.completed),
    canceled: Boolean(row.canceled),
    createdAt: Number(row.createdAt),
  })
}

async function canViewEngine(req: Request, engineId: string): Promise<boolean> {
  return permissionService.hasPermission(EnginePermissions.INSTANCE_VIEW, {
    userId: req.user!.userId,
    tenantId: req.tenant?.tenantId || null,
    resourceType: 'engine',
    resourceId: engineId,
  })
}

async function canEditEngine(req: Request, engineId: string): Promise<boolean> {
  return permissionService.hasPermission(EnginePermissions.ENGINE_EDIT, {
    userId: req.user!.userId,
    tenantId: req.tenant?.tenantId || null,
    resourceType: 'engine',
    resourceId: engineId,
  })
}

async function canViewEngineSecrets(req: Request, engineId: string): Promise<boolean> {
  return permissionService.hasPermission(EnginePermissions.SECRETS_VIEW, {
    userId: req.user!.userId,
    tenantId: req.tenant?.tenantId || null,
    resourceType: 'engine',
    resourceId: engineId,
  })
}

async function canManageEngineSecrets(req: Request, engineId: string): Promise<boolean> {
  return permissionService.hasPermission(EnginePermissions.SECRETS_MANAGE, {
    userId: req.user!.userId,
    tenantId: req.tenant?.tenantId || null,
    resourceType: 'engine',
    resourceId: engineId,
  })
}

function requestContainsAnyField(req: Request, fields: readonly string[]): boolean {
  return fields.some((field) => req.body[field] !== undefined)
}

async function getEngineOnboardingMode(): Promise<'manual_allowed' | 'external_only' | 'hybrid'> {
  return (await platformSettingsService.get()).engineOnboardingMode
}

function assertEndpointAuthenticationPolicy(
  connectionMode: 'direct' | 'customer_sidecar',
  authType: string,
  credentiallessCustomerSidecarsEnabled: boolean,
): void {
  if (authType !== 'none') return
  if (connectionMode !== 'customer_sidecar') {
    throw Errors.validation(EndpointAuthenticationPolicyMessages[0])
  }
  if (!credentiallessCustomerSidecarsEnabled) {
    throw Errors.validation(EndpointAuthenticationPolicyMessages[1])
  }
}

const requireEngineInventoryReadById = requireAction('engine.inventory.read', {
  resourceResolver: 'engine.byId',
  resourceIdFrom: 'params',
  resourceIdKey: 'id',
})
const requirePlatformSettingsRead = requireAction('platform.settings.read', { resourceResolver: 'platform.self' })

function requireEngineInventoryReadOrEnvHealth(req: Request, res: Response, next: NextFunction) {
  if (String(req.params.id) === '__env__') return requirePlatformSettingsRead(req, res, next)
  return requireEngineInventoryReadById(req, res, next)
}

function redactEngineSecrets<T extends { username?: string | null; passwordEnc?: string | null }>(engine: T): T {
  if (!engine) return engine
  return {
    ...engine,
    username: null,
    passwordEnc: null,
  }
}

function normalizeEngineLabels(labels: Record<string, string> | undefined): Record<string, string> {
  if (!labels) return {}
  return Object.fromEntries(
    Object.entries(labels)
      .map(([key, value]) => [key.trim(), value.trim()])
      .filter(([key, value]) => key.length > 0 && value.length > 0)
      .sort(([left], [right]) => left.localeCompare(right))
  )
}

function labelsToJson(labels: Record<string, string> | undefined): string | null {
  const normalized = normalizeEngineLabels(labels)
  return Object.keys(normalized).length > 0 ? JSON.stringify(normalized) : null
}

function parseEngineLabels(labelsJson: string | null | undefined): Record<string, string> {
  if (!labelsJson) return {}
  try {
    const parsed = JSON.parse(labelsJson)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed)
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    )
  } catch {
    return {}
  }
}

function normalizeEngineFieldOwnership(ownership: EngineFieldOwnership | undefined): EngineFieldOwnership {
  if (!ownership) return {}
  return Object.fromEntries(
    Object.entries(ownership)
      .filter((entry): entry is [string, EngineFieldOwner] => entry[1] === 'manual' || entry[1] === 'external')
      .sort(([left], [right]) => left.localeCompare(right))
  )
}

function fieldOwnershipToJson(ownership: EngineFieldOwnership | undefined): string | null {
  const normalized = normalizeEngineFieldOwnership(ownership)
  return Object.keys(normalized).length > 0 ? JSON.stringify(normalized) : null
}

function normalizeExternalEngineCapabilities(capabilities: ExternalEngineCapabilities | undefined): ExternalEngineCapabilities | null {
  if (!capabilities) return null
  const operations = Array.from(new Set(capabilities.operations || [])).sort()
  return {
    ...capabilities,
    operations,
    queryCapabilities: capabilities.queryCapabilities,
    supportLevel: capabilities.supportLevel ?? null,
    compatibilityProfile: capabilities.compatibilityProfile ?? null,
  }
}

function capabilitiesToJson(capabilities: ExternalEngineCapabilities | null): string | null {
  return capabilities ? JSON.stringify(capabilities) : null
}

function parseExternalEngineCapabilities(value: string | null | undefined): ExternalEngineCapabilities | null {
  if (!value) return null
  try {
    const parsed = externalEngineCapabilitiesSchema.safeParse(JSON.parse(value))
    return parsed.success ? normalizeExternalEngineCapabilities(parsed.data) : null
  } catch {
    return null
  }
}

function getCapabilityStatus(type: unknown, capabilities: ExternalEngineCapabilities | null): 'unknown' | 'in_sync' | 'mismatch' {
  return getCapabilityDiagnostics(type, capabilities).status
}

function getCapabilityDiagnostics(type: unknown, capabilities: ExternalEngineCapabilities | null) {
  const expected = getEngineCapabilities(type)
  const expectedOperations = [...expected.operations].sort()
  const expectedQueryCapabilities = expected.queryCapabilities
  const reportedQueryCapabilities = capabilities?.queryCapabilities || null
  const mismatchedQueryCapabilities = Object.entries(expectedQueryCapabilities)
    .filter(([capability, expectedValue]) => reportedQueryCapabilities?.[capability as keyof typeof expectedQueryCapabilities] !== expectedValue)
    .map(([capability]) => capability)
  if (!capabilities || !Array.isArray(capabilities.operations) || capabilities.operations.length === 0) {
    return {
      status: 'unknown' as const,
      expectedOperations,
      reportedOperations: [] as string[],
      missingOperations: expectedOperations,
      extraOperations: [] as string[],
      expectedQueryCapabilities,
      reportedQueryCapabilities,
      mismatchedQueryCapabilities: Object.keys(expectedQueryCapabilities),
      expectedSupportLevel: expected.supportLevel,
      reportedSupportLevel: null,
      expectedCompatibilityProfile: expected.compatibilityProfile,
      reportedCompatibilityProfile: null,
      issues: ['No operation capabilities were reported by the external system.'],
      recommendation: 'Update the external registration payload to report supported operations, then run reconcile again.',
    }
  }
  const reportedOperations = Array.from(new Set(capabilities.operations)).sort()
  const reported = new Set(reportedOperations)
  const expectedSet = new Set(expectedOperations)
  const missingOperations = expectedOperations.filter((operation) => !reported.has(operation))
  const extraOperations = reportedOperations.filter((operation) => !expectedSet.has(operation))
  const status = missingOperations.length > 0 || mismatchedQueryCapabilities.length > 0 ? 'mismatch' as const : 'in_sync' as const
  const issues = [
    missingOperations.length > 0 ? `Missing expected operations: ${missingOperations.join(', ')}.` : '',
    extraOperations.length > 0 ? `Reported unsupported operations: ${extraOperations.join(', ')}.` : '',
    mismatchedQueryCapabilities.length > 0 ? `Missing or incompatible query capabilities: ${mismatchedQueryCapabilities.join(', ')}.` : '',
  ].filter(Boolean)

  return {
    status,
    expectedOperations,
    reportedOperations,
    missingOperations,
    extraOperations,
    expectedQueryCapabilities,
    reportedQueryCapabilities,
    mismatchedQueryCapabilities,
    expectedSupportLevel: expected.supportLevel,
    reportedSupportLevel: capabilities.supportLevel ?? null,
    expectedCompatibilityProfile: expected.compatibilityProfile,
    reportedCompatibilityProfile: capabilities.compatibilityProfile ?? null,
    issues,
    recommendation: status === 'in_sync'
      ? 'No capability action required.'
      : 'Update the external registration payload to report the missing operations and query capabilities, then run reconcile again.',
  }
}

function parseEngineFieldOwnership(fieldOwnershipJson: string | null | undefined): EngineFieldOwnership {
  if (!fieldOwnershipJson) return {}
  try {
    const parsed = JSON.parse(fieldOwnershipJson)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return normalizeEngineFieldOwnership(parsed as EngineFieldOwnership)
  } catch {
    return {}
  }
}

function mergeFieldOwnership(ownership: EngineFieldOwnership | undefined): EngineFieldOwnership {
  return {
    ...DEFAULT_EXTERNAL_ENGINE_FIELD_OWNERSHIP,
    ...normalizeEngineFieldOwnership(ownership),
  }
}

function getExternalOwnedUpdateFields(engine: Engine, body: Record<string, unknown>): string[] {
  const registrationSource = engine.registrationSource || ''
  if (registrationSource !== 'external_api') return []
  const managementMode = engine.managementMode || (registrationSource === 'external_api' ? 'external_managed' : 'manual')

  const ownership = mergeFieldOwnership(parseEngineFieldOwnership(engine.fieldOwnershipJson))
  return Object.keys(ENGINE_UPDATE_FIELD_GROUPS).filter((field) => {
    if (body[field] === undefined) return false
    const group = ENGINE_UPDATE_FIELD_GROUPS[field]
    const owner = ownership[field] || ownership[group] || DEFAULT_EXTERNAL_ENGINE_FIELD_OWNERSHIP[group] || 'external'
    return owner === 'external'
  })
}

function getConfigLockedUpdateFields(engine: Engine, body: Record<string, unknown>): string[] {
  if (engine.registrationSource !== 'config' || engine.ownershipMode !== 'config_locked') return []
  return Object.keys(ENGINE_UPDATE_FIELD_GROUPS).filter((field) => body[field] !== undefined)
}

function isConfigWarnUpdate(engine: Engine, body: Record<string, unknown>): boolean {
  return engine.registrationSource === 'config'
    && engine.ownershipMode === 'config_warn'
    && Object.keys(ENGINE_UPDATE_FIELD_GROUPS).some((field) => body[field] !== undefined)
}

function getFieldOwner(ownership: EngineFieldOwnership, field: string): EngineFieldOwner {
  const group = ENGINE_UPDATE_FIELD_GROUPS[field]
  return ownership[field] || ownership[group] || DEFAULT_EXTERNAL_ENGINE_FIELD_OWNERSHIP[group] || 'external'
}

function comparableValue(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function applyExternalFieldOwnership(
  existing: Engine,
  payload: Record<string, unknown>,
  requestBody: Record<string, unknown>,
  ownership: EngineFieldOwnership,
): { payload: Record<string, unknown>; driftStatus: string } {
  const next = { ...payload }
  let hasManualOwnedDifference = false

  for (const [requestField, payloadField] of Object.entries(EXTERNAL_PAYLOAD_FIELD_BY_REQUEST_FIELD)) {
    if (requestBody[requestField] === undefined || getFieldOwner(ownership, requestField) !== 'manual') {
      continue
    }

    const currentValue = (existing as unknown as Record<string, unknown>)[payloadField]
    const externalValue = payload[payloadField]
    if (comparableValue(currentValue) !== comparableValue(externalValue)) {
      hasManualOwnedDifference = true
    }
    delete next[payloadField]
  }

  return {
    payload: next,
    driftStatus: hasManualOwnedDifference ? 'manual_override' : 'in_sync',
  }
}

function serializeEngine<T extends { labelsJson?: string | null; fieldOwnershipJson?: string | null; capabilitiesJson?: string | null; passwordEnc?: string | null; type?: unknown }>(
  engine: T
): Omit<T, 'labelsJson' | 'fieldOwnershipJson' | 'capabilitiesJson' | 'passwordEnc'> & {
  passwordEnc: null
  hasCredential: boolean
  labels: Record<string, string>
  fieldOwnership: EngineFieldOwnership
  reportedCapabilities: ExternalEngineCapabilities | null
  capabilityDiagnostics: ReturnType<typeof getCapabilityDiagnostics>
} {
  const { labelsJson, fieldOwnershipJson, capabilitiesJson, passwordEnc, ...rest } = engine
  const reportedCapabilities = parseExternalEngineCapabilities(capabilitiesJson)
  // PostgreSQL represents bigint columns as strings. Normalize API timestamps
  // before the authorization-filtered response is validated against its
  // numeric contract; otherwise a permitted inventory read becomes a 400.
  const timestamps = rest as Record<string, unknown>
  return {
    ...rest,
    ...('createdAt' in timestamps && timestamps.createdAt != null ? { createdAt: Number(timestamps.createdAt) } : {}),
    ...('updatedAt' in timestamps && timestamps.updatedAt != null ? { updatedAt: Number(timestamps.updatedAt) } : {}),
    ...('lastAppliedAt' in timestamps && timestamps.lastAppliedAt != null ? { lastAppliedAt: Number(timestamps.lastAppliedAt) } : {}),
    ...('lastExternalSyncAt' in timestamps && timestamps.lastExternalSyncAt != null ? { lastExternalSyncAt: Number(timestamps.lastExternalSyncAt) } : {}),
    ...('lastTenantReconciledAt' in timestamps && timestamps.lastTenantReconciledAt != null ? { lastTenantReconciledAt: Number(timestamps.lastTenantReconciledAt) } : {}),
    ...('lastMetadataReconciledAt' in timestamps && timestamps.lastMetadataReconciledAt != null ? { lastMetadataReconciledAt: Number(timestamps.lastMetadataReconciledAt) } : {}),
    ...('externalUpdatedAt' in timestamps && timestamps.externalUpdatedAt != null ? { externalUpdatedAt: Number(timestamps.externalUpdatedAt) } : {}),
    // Credentials are write-only. A caller can manage a replacement without
    // receiving ciphertext, legacy data, or an external secret reference.
    passwordEnc: null,
    hasCredential: Boolean(passwordEnc),
    labels: parseEngineLabels(labelsJson),
    fieldOwnership: parseEngineFieldOwnership(fieldOwnershipJson),
    reportedCapabilities,
    capabilityDiagnostics: getCapabilityDiagnostics(rest.type, reportedCapabilities),
  }
}

async function resolveExternalEngineSystem(
  dataSource: DataSource | EntityManager,
  externalSystemId: string | null | undefined,
  tenantId: string | null,
): Promise<ExternalEngineSystem | null> {
  if (!externalSystemId) return null
  const tenantWhere = tenantId === null ? IsNull() : tenantId
  const system = await dataSource.getRepository(ExternalEngineSystem).findOne({
    where: [
      { id: externalSystemId, tenantId: tenantWhere },
      { id: externalSystemId, tenantId: IsNull() },
    ],
  })
  if (!system || !system.isActive) {
    throw Errors.validation('External engine system does not exist or is disabled')
  }
  return system
}

function externalProjectEngineTargetSourceRef(externalSystemId: string, projectId: string, engineId: string, externalTargetId?: string | null): string {
  const targetKey = externalTargetId?.trim() || `${projectId}:${engineId}`
  return `external_engine_system:${externalSystemId}:project_engine_target:${targetKey}`
}

async function resolveExternalProjectEngineTargetEngine(
  dataSource: DataSource,
  input: { engineId?: string; externalEngineId?: string; externalSystemId: string },
  tenantId: string | null,
): Promise<Engine> {
  const engineRepo = dataSource.getRepository(Engine)
  const registrationRepo = dataSource.getRepository(ExternalEngineRegistration)
  const registration = input.engineId
    ? await registrationRepo.findOne({
      where: {
        engineId: input.engineId,
        externalSystemId: input.externalSystemId,
        registrationSource: 'external_api',
        lifecycleStatus: 'active',
      },
    })
    : input.externalEngineId
      ? await registrationRepo.findOne({
        where: {
          activeExternalIdIdentity: activeExternalIdIdentity(input.externalEngineId),
          externalSystemId: input.externalSystemId,
          registrationSource: 'external_api',
          lifecycleStatus: 'active',
        },
      })
      : null
  if (
    !registration
    || registration.externalSystemId !== input.externalSystemId
    || registration.registrationSource !== 'external_api'
    || registration.lifecycleStatus !== 'active'
    || (input.engineId && registration.engineId !== input.engineId)
    || (input.externalEngineId && registration.externalId !== input.externalEngineId)
  ) {
    throw Errors.notFound('Engine')
  }

  const engine = await engineRepo.findOneBy({ id: registration.engineId })
  if (
    !engine
    || engine.registrationSource !== 'external_api'
    || engine.externalSystemId !== input.externalSystemId
    || engine.externalId !== registration.externalId
    || (input.engineId && engine.id !== input.engineId)
    || (input.externalEngineId && engine.externalId !== input.externalEngineId)
    || engine.lifecycleStatus !== 'active'
    || !isEngineVisibleInTenancyContext(engine, tenantId)
  ) {
    throw Errors.notFound('Engine')
  }
  return engine
}

async function assertExternalProjectEngineTargetCanBeOwnedBySystem(
  projectId: string,
  engineId: string,
  tenantId: string | null,
  sourceRef: string,
): Promise<{ existingId: string | null; created: boolean }> {
  const existingTargets = await projectEngineTargetService.listTargets({
    tenantId,
    projectId,
    engineId,
    status: 'all',
  })
  const existing = existingTargets[0] || null
  if (!existing) return { existingId: null, created: true }
  if (existing.source === 'external' && existing.sourceRef === sourceRef) {
    return { existingId: existing.id, created: false }
  }
  throw Errors.conflict('Project-engine target is already managed by another source')
}

function externalRegistrationHash(domain: string, ...values: string[]): string {
  return createHash('sha256').update([domain, ...values].join('\u0000')).digest('hex')
}

function externalRegistrationOwnerRef(input: {
  engineId: string
  registrationSource: string
  apiClientId: string | null
  externalSystemId: string | null
}): string {
  if (input.externalSystemId) return `external-system:${input.externalSystemId}`
  if (input.registrationSource === 'external_api' && input.apiClientId) return `api-client:${input.apiClientId}`
  return `${input.registrationSource || 'unknown'}:${input.engineId}`
}

function externalRegistrationSourceIdentity(input: {
  engineId: string
  externalId: string
  registrationSource: string
  apiClientId: string | null
  externalSystemId: string | null
}): string {
  return externalRegistrationHash('external-engine-source-v1', externalRegistrationOwnerRef(input), input.externalId)
}

function activeExternalIdIdentity(externalId: string): string {
  return externalRegistrationHash('external-engine-active-v1', externalId)
}

function retiredExternalRegistrationIdentity(domain: 'source' | 'active', registrationId: string): string {
  return externalRegistrationHash(`external-engine-retired-${domain}-v1`, registrationId)
}

function assertExternalRegistrationOwnership(
  engine: Engine,
  registration: ExternalEngineRegistration | null,
  input: { apiClientId: string; externalSystemId: string | null },
): void {
  if (engine.registrationSource !== 'external_api') {
    throw Errors.conflict('The externalId is owned by a manually or configuration-managed engine')
  }
  const registeredSystemId = registration?.externalSystemId || engine.externalSystemId || null
  if (input.externalSystemId) {
    if (registeredSystemId !== input.externalSystemId) {
      throw Errors.conflict('The externalId is owned by another external engine system')
    }
    return
  }
  if (registeredSystemId || !registration || registration.apiClientId !== input.apiClientId) {
    throw Errors.conflict('The externalId is owned by another registration source')
  }
}

async function syncExternalEngineRegistration(
  dataSource: DataSource | EntityManager,
  input: {
    engineId: string
    externalId: string | null
    labelsJson: string | null
    registrationSource: string
    apiClientId: string | null
    externalSystemId: string | null
    managementMode: string | null
    fieldOwnershipJson: string | null
    driftStatus: string | null
    lifecycleStatus: string | null
    lastExternalSyncAt: number | null
    capabilitiesJson: string | null
    capabilityStatus: string | null
    lastRegisteredAt: number | null
    now: number
  }
): Promise<void> {
  const registrationRepo = dataSource.getRepository(ExternalEngineRegistration)

  if (!input.externalId) {
    await registrationRepo.delete({ engineId: input.engineId })
    return
  }

  const sourceIdentityForInput = externalRegistrationSourceIdentity({ ...input, externalId: input.externalId })
  const activeIdentityForInput = activeExternalIdIdentity(input.externalId)
  const existingForEngine = await registrationRepo.findOne({ where: { engineId: input.engineId } })
  const existingForExternalId = await registrationRepo.findOne({
    where: [
      { activeExternalIdIdentity: activeIdentityForInput },
      { externalId: input.externalId, lifecycleStatus: Not('decommissioned') },
    ],
  })
  if (existingForExternalId && existingForExternalId.engineId !== input.engineId) {
    throw Errors.conflict('An engine with this externalId already exists')
  }

  const isRetired = input.lifecycleStatus === 'decommissioned'
  const sourceIdentity = isRetired
    ? retiredExternalRegistrationIdentity('source', existingForEngine?.id || input.engineId)
    : sourceIdentityForInput
  const activeIdentity = isRetired
    ? retiredExternalRegistrationIdentity('active', existingForEngine?.id || input.engineId)
    : activeIdentityForInput
  const payload = {
    engineId: input.engineId,
    externalId: input.externalId,
    sourceIdentity,
    activeExternalIdIdentity: activeIdentity,
    labelsJson: input.labelsJson,
    registrationSource: input.registrationSource,
    apiClientId: input.apiClientId,
    externalSystemId: input.externalSystemId,
    managementMode: input.managementMode,
    fieldOwnershipJson: input.fieldOwnershipJson,
    driftStatus: input.driftStatus,
    lifecycleStatus: input.lifecycleStatus,
    lastExternalSyncAt: input.lastExternalSyncAt,
    capabilitiesJson: input.capabilitiesJson,
    capabilityStatus: input.capabilityStatus,
    lastRegisteredAt: input.lastRegisteredAt,
    updatedAt: input.now,
  }

  const existing = existingForEngine || existingForExternalId
  if (existing) {
    await registrationRepo.update({ id: existing.id }, payload)
    return
  }

  await registrationRepo.insert({
    id: generateId(),
    ...payload,
    createdAt: input.now,
  })
}

async function refreshEngineSetMaterializationsForEngine(engineId: string, tenantId?: string | null): Promise<void> {
  try {
    await engineSetService.materializeEngineSetsForEngine(engineId, tenantId)
  } catch (error) {
    logger.warn('Failed to refresh Engine Set materializations', { engineId, error })
  }
}

/** Engine label and registration changes can affect resource-set membership metadata. */
async function refreshRuntimeResourceSetMaterializationsForEngine(engineId: string, tenantId?: string | null): Promise<void> {
  try {
    await runtimeResourceInventoryService.materializeForEngine(engineId, tenantId)
  } catch (error) {
    logger.warn('Failed to refresh Runtime Resource Set materializations', { engineId, error })
  }
}

function scheduleRuntimeInventoryReconciliation(
  engineId: string,
  tenantId: string | null | undefined,
  options: { runtimeAccessScope?: string | null; metadataDiscoveryEnabled?: boolean | null; deploymentDiscoveryEnabled: boolean },
): void {
  void engineMetadataReconciliationService.reconcileEngine(engineId, tenantId, {
    runtimeMetadataDiscoveryEnabled: options.runtimeAccessScope === 'resource_aware' && options.metadataDiscoveryEnabled !== false,
    deploymentDiscoveryEnabled: options.deploymentDiscoveryEnabled,
  })
    .catch((error: unknown) => logger.warn('Failed to reconcile engine metadata after engine change', { engineId, error }))
}

/**
 * A resource-aware engine cannot become engine-wide while assignments still
 * target its individual runtime resources or resource sets. Keeping those
 * assignments would make their scope ambiguous to operators and evaluators.
 */
async function assertEngineCanUseEngineWideAccess(dataSource: DataSource | EntityManager, engineId: string): Promise<void> {
  const assignments = dataSource.getRepository(RbacRoleAssignment)
  const directResourceAssignmentCount = await assignments.createQueryBuilder('assignment')
    .innerJoin(RuntimeResource, 'runtimeResource', 'runtimeResource.id = assignment.scopeId')
    .where('assignment.scopeType = :scopeType', { scopeType: 'engine_runtime_resource' })
    .andWhere('runtimeResource.engineId = :engineId', { engineId })
    .getCount()
  const resourceSetAssignmentCount = await assignments.createQueryBuilder('assignment')
    .innerJoin(RuntimeResourceSet, 'runtimeResourceSet', 'runtimeResourceSet.id = assignment.scopeId')
    .where('assignment.scopeType = :scopeType', { scopeType: 'engine_runtime_resource_set' })
    .andWhere('runtimeResourceSet.engineId = :engineId', { engineId })
    .getCount()

  if (directResourceAssignmentCount + resourceSetAssignmentCount > 0) {
    throw Errors.validation('Remove or move runtime-resource role assignments before changing this engine to engine-wide access')
  }
}

async function testEngineConnectionAndRecord(
  dataSource: Awaited<ReturnType<typeof getDataSource>>,
  eng: Pick<Engine, 'id' | 'baseUrl' | 'connectionMode' | 'authType' | 'username' | 'passwordEnc' | 'oauthTokenUrl' | 'oauthScopes' | 'oauthAudience'>
) {
  const engineRepo = dataSource.getRepository(Engine)
  const healthRepo = dataSource.getRepository(EngineHealth)
  const started = Date.now()
  let status: 'connected'|'disconnected'|'unknown' = 'unknown'
  let version: string | null = null
  let message: string | null = null

  try {
    const { response, diagnostics } = await fetchBpmnEngineEndpoint(eng, { engineId: eng.id, method: 'GET', path: '/version' })
    const latencyMs = Date.now() - started
    if (response.ok) {
      status = 'connected'
      try {
        const data: any = await response.json()
        version = typeof data?.version === 'string'
          && data.version.length <= 255
          && !/[\r\n\0]/.test(data.version)
          ? data.version.trim() || null
          : null
      } catch {
        version = null
      }
      await engineRepo.update({ id: eng.id }, { version: version || null, updatedAt: Date.now() })
      const rec = { id: generateId(), engineId: eng.id, status, latencyMs, message: null, checkedAt: Date.now() }
      await healthRepo.insert(rec)
      return { ...rec, version, transport: diagnostics }
    }

    status = 'disconnected'
    message = `Engine endpoint returned HTTP ${response.status}`
    const rec = { id: generateId(), engineId: eng.id, status, latencyMs, message, checkedAt: Date.now() }
    await healthRepo.insert(rec)
    return { ...rec, version: null, transport: diagnostics }
  } catch {
    const latencyMs = Date.now() - started
    status = 'disconnected'
    message = eng.connectionMode === 'customer_sidecar'
      ? 'Failed to connect to EnterpriseGlue -> customer sidecar endpoint'
      : 'Failed to connect to EnterpriseGlue -> engine endpoint'
    const rec = { id: generateId(), engineId: eng.id, status, latencyMs, message, checkedAt: Date.now() }
    await healthRepo.insert(rec)
    return {
      ...rec,
      version: null,
      transport: describeBpmnEngineTransport(eng),
    }
  }
}

r.get('/engines-api/engines', engineLimiter, requireAuth, validateQuery(EngineInventoryQuerySchema), requireAction('engine.inventory.read', { resourceResolver: 'engine.visibleCollection' }), asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant?.tenantId

  // Filter engines by tenant context (including null tenantId for legacy data)
  const authorizedEngineIds = new Set((req as RequestWithAuthorizedEngineIds).authorizedEngineIds || [])
  const dataSource = await getDataSource()
  const authorizedEngines = authorizedEngineIds.size > 0
    ? await dataSource.getRepository(Engine).find({ where: { id: In(Array.from(authorizedEngineIds)) } })
    : []
  const rows = await Promise.all(authorizedEngines.map(async (engine) => {
    // Legacy roles remain useful display metadata. Runtime-resource-only users
    // intentionally have no synthetic engine-wide role.
    const role = await engineService.getEngineRole(req.user!.userId, String(engine.id), tenantId)
    const out = withEngineCapabilities({
      ...serializeEngine(engine),
      // Retain the historical top-level ids for API compatibility, but expose
      // accountable contacts under a distinct governance object so callers do
      // not mistake them for evaluator-backed access grants.
      governance: {
        accountableOwnerId: engine.ownerId ?? null,
        delegateId: engine.delegateId ?? null,
      },
      myRole: role,
    })
    if (!(await canViewEngineSecrets(req, String(engine.id)))) {
      return redactEngineSecrets(out)
    }
    return out
  }))
  res.json(AccessibleEngineSummarySchema.array().parse(rows))
}))

r.post('/engines-api/engines', engineLimiter, requireAuth, engineRegistrationLimiter, requireAction('engine.inventory.create', { resourceResolver: 'platform.self' }), engineRegistrationJsonPayloadLimit, validateBody(createEngineBodySchema), asyncHandler(async (req: Request, res: Response) => {
  if ((await getEngineOnboardingMode()) === 'external_only') {
    throw Errors.forbidden('Manual engine registration is disabled by the current onboarding policy')
  }
  const dataSource = await getDataSource()
  const engineRepo = dataSource.getRepository(Engine)
  const settings = await platformSettingsService.get()
  const authType = req.body.authType || 'basic'
  assertEndpointAuthenticationPolicy(req.body.connectionMode, authType, settings.credentiallessCustomerSidecarsEnabled ?? false)
  assertEngineEndpointPolicy(req.body.baseUrl, req.body.oauthTokenUrl)
  const now = Date.now()
  const id = generateId()
  const dockerLoopbackError = getDockerLoopbackEngineError(req.body.baseUrl)
  if (dockerLoopbackError) {
    return res.status(400).json({ error: dockerLoopbackError, field: 'baseUrl' })
  }
  const resolvedTenancy = await engineTenancyProvisioningService.resolveForCreate({
    tenancy: req.body.tenancy,
    runtimeAccessScope: req.body.runtimeAccessScope || 'engine_wide',
    requestTenantId: req.tenant?.tenantId || null,
    principalType: 'user',
    principalId: req.user!.userId,
    resolver: engineTenantReferenceResolver(req),
  })
  const tenantId = resolvedTenancy.tenantId
  const externalId = req.body.externalId?.trim() || null
  if (externalId) {
    const existingExternal = await engineRepo.findOne({ where: { externalId }, select: ['id'] })
    if (existingExternal) {
      throw Errors.conflict('An engine with this externalId already exists')
    }
  }
  const payload = {
    id,
    name: req.body.name,
    baseUrl: req.body.baseUrl,
    type: req.body.type,
    externalId,
    labelsJson: labelsToJson(req.body.labels),
    registrationSource: 'user',
    externalSystemId: null,
    managementMode: 'manual',
    fieldOwnershipJson: null,
    driftStatus: null,
    lifecycleStatus: 'active',
    lastExternalSyncAt: null,
    capabilitiesJson: null,
    capabilityStatus: null,
    externalUpdatedAt: null,
    authType,
    connectionMode: req.body.connectionMode,
    username: req.body.username ?? null,
    passwordEnc: secretResolver.normalizeForStorage(req.body.passwordEnc),
    oauthTokenUrl: req.body.oauthTokenUrl ?? null,
    oauthScopes: req.body.oauthScopes ?? null,
    oauthAudience: req.body.oauthAudience ?? null,
    ownerId: req.user!.userId,
    delegateId: null,
    version: req.body.version ?? null,
    environmentTagId: req.body.environmentTagId || null,
    environmentLocked: false,
    runtimeAccessScope: req.body.runtimeAccessScope || 'engine_wide',
    tenancyMode: resolvedTenancy.tenancyMode,
    tenantMappingStrategy: resolvedTenancy.tenantMappingStrategy,
    tenantMappingVersion: resolvedTenancy.tenantMappingVersion,
    tenantResolutionStatus: resolvedTenancy.tenantResolutionStatus,
    lastTenantReconciledAt: null,
    deploymentIntegration: req.body.deploymentIntegration || 'enterpriseglue_proxy',
    metadataDiscoveryEnabled: req.body.metadataDiscoveryEnabled ?? true,
    deploymentDiscoveryEnabled: req.body.deploymentDiscoveryEnabled ?? true,
    reconciliationIntervalSeconds: req.body.reconciliationIntervalSeconds ?? 300,
    lastMetadataReconciledAt: null,
    lastMetadataReconciliationStatus: null,
    pipelineReceiptEnabled: req.body.pipelineReceiptEnabled ?? true,
    tenantId,
    createdAt: now,
    updatedAt: now,
  }
  if (externalId) {
    await dataSource.transaction(async (manager) => {
      await engineService.createEngineWithGovernanceAssignments(payload, manager)
      await syncExternalEngineRegistration(manager, {
        engineId: id,
        externalId,
        labelsJson: payload.labelsJson,
        registrationSource: 'user',
        apiClientId: null,
        externalSystemId: null,
        managementMode: 'manual',
        fieldOwnershipJson: null,
        driftStatus: null,
        lifecycleStatus: 'active',
        lastExternalSyncAt: null,
        capabilitiesJson: null,
        capabilityStatus: null,
        lastRegisteredAt: null,
        now,
      })
    })
  } else {
    await engineService.createEngineWithGovernanceAssignments(payload, dataSource)
  }
  await refreshEngineSetMaterializationsForEngine(id, tenantId)
  await refreshRuntimeResourceSetMaterializationsForEngine(id, tenantId)
  scheduleRuntimeInventoryReconciliation(id, tenantId, {
    runtimeAccessScope: payload.runtimeAccessScope,
    metadataDiscoveryEnabled: payload.metadataDiscoveryEnabled,
    deploymentDiscoveryEnabled: payload.deploymentDiscoveryEnabled,
  })
  res.status(201).json(withEngineCapabilities(serializeEngine(payload)))
}))

r.post('/engines-api/external/engines', engineLimiter, requireApiClientAction(ApiClientScopes.ENGINE_REGISTER, 'engine.external-registration.upsert', {
  permissionId: ExternalEngineSystemPermissions.ENGINE_REGISTRATION_MANAGE,
  resourceType: 'external_engine_system',
  resourceIdFrom: 'body',
  resourceIdKey: 'externalSystemId',
}), engineRegistrationLimiter, engineRegistrationJsonPayloadLimit, validateBody(externalRegisterEngineBodySchema), asyncHandler(async (req: Request, res: Response) => {
  const dataSource = await getDataSource()
  const settings = await platformSettingsService.get()
  const authType = req.body.authType || 'basic'
  assertEndpointAuthenticationPolicy(req.body.connectionMode, authType, settings.credentiallessCustomerSidecarsEnabled ?? false)
  assertEngineEndpointPolicy(req.body.baseUrl, req.body.oauthTokenUrl)
  const now = Date.now()
  const dockerLoopbackError = getDockerLoopbackEngineError(req.body.baseUrl)
  if (dockerLoopbackError) {
    return res.status(400).json({ error: dockerLoopbackError, field: 'baseUrl' })
  }

  const requestTenantId = normalizeTenantIdForPersistence(req.tenant?.tenantId) || OSS_DEFAULT_TENANT_ID
  const externalId = req.body.externalId.trim()
  const apiClientId = req.apiClient?.id || null
  if (!apiClientId) throw Errors.unauthorized('API client identity is required')
  const requestedExternalSystemId = req.body.externalSystemId?.trim() || null
  const lifecycleStatus: EngineLifecycleStatus = req.body.lifecycleStatus || 'active'
  const reportedCapabilities = normalizeExternalEngineCapabilities(req.body.capabilities)
  const capabilitiesJson = capabilitiesToJson(reportedCapabilities)
  const capabilityStatus = getCapabilityStatus(req.body.type, reportedCapabilities)

  type RegistrationResult = {
    created: boolean
    engine: Engine
    tenantId: string | null
    runtimeAccessScope: string
    metadataDiscoveryEnabled: boolean | null | undefined
    deploymentDiscoveryEnabled: boolean
    externalSystemId: string | null
    managementMode: string
    fieldOwnership: EngineFieldOwnership
    driftStatus: string
    capabilityStatus: string
    capabilities: ExternalEngineCapabilities | null
    tenancyMode: string
    tenantMappingStrategy: string | null
  }

  const registerOnce = () => dataSource.transaction(async (manager): Promise<RegistrationResult> => {
    const engineRepo = manager.getRepository(Engine)
    const registrationRepo = manager.getRepository(ExternalEngineRegistration)
    const externalSystem = await resolveExternalEngineSystem(manager, requestedExternalSystemId, requestTenantId)
    const externalSystemManagementMode = engineManagementModeSchema.safeParse(externalSystem?.defaultManagementMode).success
      ? externalSystem?.defaultManagementMode
      : undefined
    const managementMode = req.body.managementMode || externalSystemManagementMode || 'external_managed'
    const fieldOwnership = mergeFieldOwnership(req.body.fieldOwnership || parseEngineFieldOwnership(externalSystem?.defaultFieldOwnershipJson))
    const fieldOwnershipJson = fieldOwnershipToJson(fieldOwnership)
    const activeIdentity = activeExternalIdIdentity(externalId)
    const registration = await registrationRepo.findOne({
      where: [
        { activeExternalIdIdentity: activeIdentity },
        { externalId, lifecycleStatus: Not('decommissioned') },
      ],
    })
    const registeredEngine = registration ? await engineRepo.findOneBy({ id: registration.engineId }) : null
    const engineForExternalId = await engineRepo.findOne({ where: { externalId, lifecycleStatus: Not('decommissioned') } })
    if (registeredEngine && engineForExternalId && registeredEngine.id !== engineForExternalId.id) {
      throw Errors.conflict('The externalId is associated with conflicting engine registrations')
    }
    const existing = registeredEngine || engineForExternalId
    if (existing) {
      if (!isEngineVisibleInTenancyContext(existing, requestTenantId)) throw Errors.notFound('Engine')
      assertExternalRegistrationOwnership(existing, registration, { apiClientId, externalSystemId: externalSystem?.id || null })
    }

    const resolvedTenancy = existing
      ? await engineTenancyProvisioningService.validateUpdate(existing, {
        tenancy: req.body.tenancy,
        runtimeAccessScope: req.body.runtimeAccessScope || existing.runtimeAccessScope || 'engine_wide',
        requestTenantId,
        principalType: 'api_client',
        principalId: apiClientId,
        resolver: engineTenantReferenceResolver(req),
      })
      : await engineTenancyProvisioningService.resolveForCreate({
        tenancy: req.body.tenancy,
        runtimeAccessScope: req.body.runtimeAccessScope || 'engine_wide',
        requestTenantId,
        principalType: 'api_client',
        principalId: apiClientId,
        resolver: engineTenantReferenceResolver(req),
      })
    if (!resolvedTenancy) throw Errors.internal('External engine tenancy resolution returned no decision')
    if (existing && req.body.runtimeAccessScope === 'engine_wide' && existing.runtimeAccessScope === 'resource_aware') {
      await assertEngineCanUseEngineWideAccess(manager, String(existing.id))
    }

    const payload = {
      name: req.body.name,
      baseUrl: req.body.baseUrl,
      type: req.body.type,
      externalId,
      labelsJson: labelsToJson(req.body.labels),
      registrationSource: 'external_api',
      externalSystemId: externalSystem?.id || null,
      managementMode,
      fieldOwnershipJson,
      driftStatus: 'in_sync',
      lifecycleStatus,
      lastExternalSyncAt: now,
      capabilitiesJson,
      capabilityStatus,
      externalUpdatedAt: now,
      authType,
      connectionMode: req.body.connectionMode,
      username: req.body.username ?? null,
      passwordEnc: secretResolver.normalizeForStorage(req.body.passwordEnc),
      oauthTokenUrl: req.body.oauthTokenUrl ?? null,
      oauthScopes: req.body.oauthScopes ?? null,
      oauthAudience: req.body.oauthAudience ?? null,
      version: req.body.version ?? null,
      environmentTagId: req.body.environmentTagId || null,
      runtimeAccessScope: req.body.runtimeAccessScope,
      deploymentIntegration: req.body.deploymentIntegration,
      metadataDiscoveryEnabled: req.body.metadataDiscoveryEnabled,
      deploymentDiscoveryEnabled: req.body.deploymentDiscoveryEnabled,
      reconciliationIntervalSeconds: req.body.reconciliationIntervalSeconds,
      pipelineReceiptEnabled: req.body.pipelineReceiptEnabled,
      updatedAt: now,
    }

    if (existing) {
      const nextCapabilitiesJson = req.body.capabilities === undefined ? existing.capabilitiesJson || null : capabilitiesJson
      const nextCapabilityStatus = req.body.capabilities === undefined
        ? existing.capabilityStatus || getCapabilityStatus(existing.type || req.body.type, parseExternalEngineCapabilities(existing.capabilitiesJson))
        : capabilityStatus
      const ownedUpdate = applyExternalFieldOwnership(existing, payload, req.body, fieldOwnership)
      const updatePayload: Partial<Engine> = {
        ...(ownedUpdate.payload as Partial<Engine>),
        driftStatus: ownedUpdate.driftStatus,
        lifecycleStatus,
        lastExternalSyncAt: now,
        capabilitiesJson: nextCapabilitiesJson,
        capabilityStatus: nextCapabilityStatus,
        externalUpdatedAt: now,
        tenancyMode: resolvedTenancy.tenancyMode,
        tenantId: resolvedTenancy.tenantId,
        tenantMappingStrategy: resolvedTenancy.tenantMappingStrategy,
        tenantMappingVersion: resolvedTenancy.tenantMappingVersion,
        tenantResolutionStatus: resolvedTenancy.tenantResolutionStatus,
        updatedAt: now,
      }
      await engineRepo.update({ id: existing.id }, updatePayload)
      await syncExternalEngineRegistration(manager, {
        engineId: String(existing.id), externalId,
        labelsJson: (updatePayload.labelsJson as string | null | undefined) ?? existing.labelsJson,
        registrationSource: 'external_api', apiClientId, externalSystemId: payload.externalSystemId,
        managementMode, fieldOwnershipJson, driftStatus: ownedUpdate.driftStatus, lifecycleStatus,
        lastExternalSyncAt: now, capabilitiesJson: nextCapabilitiesJson, capabilityStatus: nextCapabilityStatus,
        lastRegisteredAt: now, now,
      })
      const updated = await engineRepo.findOneBy({ id: existing.id })
      if (!updated) throw Errors.notFound('Engine')
      return {
        created: false, engine: updated, tenantId: resolvedTenancy.tenantId ?? existing.tenantId,
        runtimeAccessScope: (updatePayload.runtimeAccessScope as string | undefined) ?? existing.runtimeAccessScope,
        metadataDiscoveryEnabled: (updatePayload.metadataDiscoveryEnabled as boolean | undefined) ?? existing.metadataDiscoveryEnabled,
        deploymentDiscoveryEnabled: (updatePayload.deploymentDiscoveryEnabled as boolean | undefined) ?? (existing.deploymentDiscoveryEnabled !== false),
        externalSystemId: payload.externalSystemId, managementMode, fieldOwnership,
        driftStatus: ownedUpdate.driftStatus, capabilityStatus: nextCapabilityStatus,
        capabilities: req.body.capabilities === undefined ? parseExternalEngineCapabilities(existing.capabilitiesJson) : reportedCapabilities,
        tenancyMode: resolvedTenancy.tenancyMode, tenantMappingStrategy: resolvedTenancy.tenantMappingStrategy,
      }
    }

    const id = generateId()
    const created = {
      id, ...payload, ownerId: req.apiClient?.createdById || null, delegateId: null,
      environmentLocked: false, tenantId: resolvedTenancy.tenantId, tenancyMode: resolvedTenancy.tenancyMode,
      tenantMappingStrategy: resolvedTenancy.tenantMappingStrategy, tenantMappingVersion: resolvedTenancy.tenantMappingVersion,
      tenantResolutionStatus: resolvedTenancy.tenantResolutionStatus, lastTenantReconciledAt: null, createdAt: now,
    } as Engine
    await engineService.createEngineWithGovernanceAssignments(created, manager, true)
    await syncExternalEngineRegistration(manager, {
      engineId: id, externalId, labelsJson: payload.labelsJson, registrationSource: 'external_api', apiClientId,
      externalSystemId: payload.externalSystemId, managementMode, fieldOwnershipJson, driftStatus: payload.driftStatus,
      lifecycleStatus, lastExternalSyncAt: now, capabilitiesJson, capabilityStatus, lastRegisteredAt: now, now,
    })
    return {
      created: true, engine: created, tenantId: resolvedTenancy.tenantId,
      runtimeAccessScope: payload.runtimeAccessScope || 'engine_wide',
      metadataDiscoveryEnabled: payload.metadataDiscoveryEnabled,
      deploymentDiscoveryEnabled: payload.deploymentDiscoveryEnabled !== false,
      externalSystemId: payload.externalSystemId, managementMode, fieldOwnership,
      driftStatus: payload.driftStatus, capabilityStatus, capabilities: reportedCapabilities,
      tenancyMode: resolvedTenancy.tenancyMode, tenantMappingStrategy: resolvedTenancy.tenantMappingStrategy,
    }
  })

  let registrationResult: RegistrationResult
  try {
    registrationResult = await registerOnce()
  } catch (error) {
    const converged = await dataSource.getRepository(ExternalEngineRegistration).findOne({
      where: { activeExternalIdIdentity: activeExternalIdIdentity(externalId) },
    })
    const sameSource = converged && (requestedExternalSystemId
      ? converged.externalSystemId === requestedExternalSystemId
      : !converged.externalSystemId && converged.apiClientId === apiClientId)
    if (!sameSource) throw error
    registrationResult = await registerOnce()
  }

  await refreshEngineSetMaterializationsForEngine(registrationResult.engine.id, registrationResult.tenantId)
  await refreshRuntimeResourceSetMaterializationsForEngine(registrationResult.engine.id, registrationResult.tenantId)
  scheduleRuntimeInventoryReconciliation(registrationResult.engine.id, registrationResult.tenantId, {
    runtimeAccessScope: registrationResult.runtimeAccessScope,
    metadataDiscoveryEnabled: registrationResult.metadataDiscoveryEnabled,
    deploymentDiscoveryEnabled: registrationResult.deploymentDiscoveryEnabled,
  })
  const health = req.body.testConnection ? await testEngineConnectionAndRecord(dataSource, registrationResult.engine) : null
  await logAudit({
    tenantId: registrationResult.tenantId || undefined,
    userId: req.apiClient?.createdById || undefined,
    action: registrationResult.created ? 'engine.external_registration.create' : 'engine.external_registration.update',
    resourceType: 'engine',
    resourceId: registrationResult.engine.id,
    details: {
      apiClientId,
      externalSystemId: registrationResult.externalSystemId,
      managementMode: registrationResult.managementMode,
      fieldOwnership: registrationResult.fieldOwnership,
      driftStatus: registrationResult.driftStatus,
      lifecycleStatus,
      capabilityStatus: registrationResult.capabilityStatus,
      capabilities: registrationResult.capabilities,
      externalId,
      labels: normalizeEngineLabels(req.body.labels),
      tenancy: {
        mode: registrationResult.tenancyMode,
        tenantId: registrationResult.tenantId,
        mappingStrategy: registrationResult.tenantMappingStrategy,
      },
      connectionTest: health ? { status: health.status, latencyMs: health.latencyMs, version: health.version ?? null } : undefined,
    },
  })
  const responseEngine = health?.version ? { ...registrationResult.engine, version: health.version } : registrationResult.engine
  return res.status(registrationResult.created ? 201 : 200).json({
    created: registrationResult.created,
    engine: withEngineCapabilities(serializeEngine(responseEngine)),
    health,
  })
}))

r.put('/engines-api/external/engines/:externalId/tenant-mappings', engineLimiter, requireApiClientAction(ApiClientScopes.ENGINE_REGISTER, 'engine.external-registration.upsert', {
  permissionId: ExternalEngineSystemPermissions.ENGINE_REGISTRATION_MANAGE,
  resourceType: 'external_engine_system',
  resourceIdFrom: 'body',
  resourceIdKey: 'externalSystemId',
}), engineRegistrationLimiter, validateParams(externalEngineIdParamSchema), engineRegistrationJsonPayloadLimit, validateBody(externalTenantMappingsBodySchema), asyncHandler(async (req: Request, res: Response) => {
  const dataSource = await getDataSource()
  const externalId = String(req.params.externalId)
  const engine = await dataSource.getRepository(Engine).findOne({
    where: {
      externalId,
      lifecycleStatus: Not('decommissioned'),
    },
  })
  if (!engine) throw Errors.notFound('Engine')
  const requestTenantId = normalizeTenantIdForPersistence(req.tenant?.tenantId) || OSS_DEFAULT_TENANT_ID
  if (!isEngineVisibleInTenancyContext(engine, requestTenantId)) throw Errors.notFound('Engine')
  const apiClientId = req.apiClient?.id || null
  if (!apiClientId) throw Errors.unauthorized('API client identity is required')
  const registration = await dataSource.getRepository(ExternalEngineRegistration).findOne({ where: { engineId: engine.id } })
  assertExternalRegistrationOwnership(engine, registration, {
    apiClientId,
    externalSystemId: req.body.externalSystemId?.trim() || null,
  })
  const { externalSystemId: _externalSystemId, ...mappingRequest } = req.body
  const result = await engineTenantMappingService.upsert({
    engineId: String(engine.id),
    request: mappingRequest,
    requestTenantId,
    principalType: 'api_client',
    principalId: req.apiClient?.id || null,
    source: 'external',
    ownershipMode: 'external_managed',
    resolver: engineTenantReferenceResolver(req),
  })
  await logAudit({
    tenantId: req.tenant?.tenantId || undefined,
    userId: req.apiClient?.createdById || undefined,
    action: req.body.dryRun ? 'engine.tenant_mappings.preview' : 'engine.tenant_mappings.upsert',
    resourceType: 'engine',
    resourceId: String(engine.id),
    details: {
      apiClientId: req.apiClient?.id,
      externalId,
      externalSystemId: engine.externalSystemId,
      dryRun: result.dryRun,
      mappingVersion: result.mappingVersion,
      created: result.created,
      updated: result.updated,
      deactivated: result.deactivated,
      unchanged: result.unchanged,
    },
  })
  res.json(result)
}))

r.post('/engines-api/external/engines/decommission', engineLimiter, requireApiClientAction(ApiClientScopes.ENGINE_REGISTER, 'engine.external-registration.decommission', {
  permissionId: ExternalEngineSystemPermissions.ENGINE_REGISTRATION_MANAGE,
  resourceType: 'external_engine_system',
  resourceIdFrom: 'body',
  resourceIdKey: 'externalSystemId',
}), validateBody(ExternalEngineDecommissionRequestSchema), asyncHandler(async (req: Request, res: Response) => {
  const dataSource = await getDataSource()
  const now = Date.now()
  const externalId = req.body.externalId.trim()
  const tenantId = normalizeTenantIdForPersistence(req.tenant?.tenantId) || OSS_DEFAULT_TENANT_ID
  const requestedSystemId = req.body.externalSystemId?.trim() || null
  const apiClientId = req.apiClient?.id || null
  if (!apiClientId) throw Errors.unauthorized('API client identity is required')
  const lifecycleStatus = 'decommissioned'
  const decommissioned = await dataSource.transaction(async (manager) => {
    const engineRepo = manager.getRepository(Engine)
    const registrationRepo = manager.getRepository(ExternalEngineRegistration)
    const registration = await registrationRepo.findOne({
      where: [
        { activeExternalIdIdentity: activeExternalIdIdentity(externalId) },
        { externalId, lifecycleStatus: Not('decommissioned') },
      ],
    })
    const engine = registration
      ? await engineRepo.findOneBy({ id: registration.engineId })
      : await engineRepo.findOne({ where: { externalId, lifecycleStatus: Not('decommissioned') } })
    if (!engine) throw Errors.notFound('Engine')
    if (!isEngineVisibleInTenancyContext(engine, tenantId)) throw Errors.notFound('Engine')
    assertExternalRegistrationOwnership(engine, registration, { apiClientId, externalSystemId: requestedSystemId })
    const registeredSystemId = registration?.externalSystemId || engine.externalSystemId || null
    await engineService.decommissionEngine(engine.id, {}, manager)
    if (registration) {
      await manager.getRepository(ExternalEngineRegistration).update({ id: registration.id }, {
        sourceIdentity: retiredExternalRegistrationIdentity('source', registration.id),
        activeExternalIdIdentity: retiredExternalRegistrationIdentity('active', registration.id),
        apiClientId: registeredSystemId ? apiClientId : registration.apiClientId,
        lifecycleStatus,
        driftStatus: 'decommissioned',
        lastExternalSyncAt: now,
        lastRegisteredAt: now,
        updatedAt: now,
      })
    }
    await manager.getRepository(Engine).update({ id: engine.id }, {
      lifecycleStatus, driftStatus: 'decommissioned', externalUpdatedAt: now, lastExternalSyncAt: now, updatedAt: now,
    })
    return { engineId: engine.id, registeredSystemId }
  })
  await logAudit({
    tenantId: tenantId || undefined,
    userId: req.apiClient?.createdById || undefined,
    action: 'engine.external_registration.decommission',
    resourceType: 'engine',
    resourceId: decommissioned.engineId,
    details: {
      apiClientId: req.apiClient?.id,
      externalId,
      externalSystemId: decommissioned.registeredSystemId,
      reason: req.body.reason || null,
    },
  })

  res.json({
    decommissioned: true,
    engineId: decommissioned.engineId,
    externalId,
    lifecycleStatus,
  })
}))

r.post('/engines-api/external/project-engine-targets', engineLimiter, requireApiClientAction(ApiClientScopes.ENGINE_REGISTER, 'project-engine-target.external-registration.upsert', {
  permissionId: ExternalEngineSystemPermissions.PROJECT_TARGETS_MANAGE,
  resourceType: 'external_engine_system',
  resourceIdFrom: 'body',
  resourceIdKey: 'externalSystemId',
  allowActionPermissionFallback: false,
}), validateBody(externalProjectEngineTargetUpsertBodySchema), asyncHandler(async (req: Request, res: Response) => {
  const dataSource = await getDataSource()
  const tenantId = normalizeTenantIdForPersistence(req.tenant?.tenantId) || OSS_DEFAULT_TENANT_ID
  const externalSystem = await resolveExternalEngineSystem(dataSource, req.body.externalSystemId, tenantId)
  if (!externalSystem) throw Errors.validation('externalSystemId is required')

  const engine = await resolveExternalProjectEngineTargetEngine(dataSource, {
    engineId: req.body.engineId,
    externalEngineId: req.body.externalEngineId,
    externalSystemId: externalSystem.id,
  }, tenantId)
  const projectId = String(req.body.projectId)
  const engineId = String(engine.id)
  const externalEngineId = req.body.externalEngineId || engine.externalId || null
  const sourceRef = externalProjectEngineTargetSourceRef(externalSystem.id, projectId, engineId, req.body.externalTargetId)
  const ownership = await assertExternalProjectEngineTargetCanBeOwnedBySystem(projectId, engineId, tenantId, sourceRef)

  const result = await projectEngineTargetService.createTarget({
    tenantId,
    projectId,
    engineId,
    status: req.body.status || 'active',
    source: 'external',
    sourceRef,
    externalSystemId: externalSystem.id,
    externalProjectId: req.body.externalProjectId || null,
    externalEngineId,
    externalTargetId: req.body.externalTargetId || null,
    allowManualDeploy: req.body.allowManualDeploy ?? true,
    allowCiDeploy: req.body.allowCiDeploy ?? false,
    allowApiDeploy: req.body.allowApiDeploy ?? false,
    allowImport: req.body.allowImport ?? true,
    createdById: req.apiClient?.createdById || null,
    approvedById: req.apiClient?.createdById || null,
    approvalStatus: req.body.approvalStatus || 'approved',
    policyTags: req.body.policyTags,
    diagnostics: req.body.diagnostics ?? {
      source: 'external_registration_api',
      externalSystemId: externalSystem.id,
      externalProjectId: req.body.externalProjectId || null,
      externalEngineId,
      externalTargetId: req.body.externalTargetId || null,
    },
    allowSourceOwnedMutation: true,
  })
  const target = await projectEngineTargetService.getTarget(result.id, tenantId)
  if (!target) throw Errors.notFound('Project Engine Target')

  await logAudit({
    tenantId: tenantId || undefined,
    userId: req.apiClient?.createdById || undefined,
    action: ownership.created ? 'project_engine_target.external_registration.create' : 'project_engine_target.external_registration.update',
    resourceType: 'project_engine_target',
    resourceId: result.id,
    details: {
      apiClientId: req.apiClient?.id,
      externalSystemId: externalSystem.id,
      externalProjectId: req.body.externalProjectId || null,
      externalTargetId: req.body.externalTargetId || null,
      projectId,
      engineId,
      externalEngineId,
      sourceRef,
      status: target.status,
      approvalStatus: target.approvalStatus,
      policyTags: target.policyTags,
      allowManualDeploy: target.allowManualDeploy,
      allowCiDeploy: target.allowCiDeploy,
      allowApiDeploy: target.allowApiDeploy,
      allowImport: target.allowImport,
    },
  })

  res.status(ownership.created ? 201 : 200).json({
    created: ownership.created,
    target,
  })
}))

r.post('/engines-api/external/project-engine-targets/decommission', engineLimiter, requireApiClientAction(ApiClientScopes.ENGINE_REGISTER, 'project-engine-target.external-registration.decommission', {
  permissionId: ExternalEngineSystemPermissions.PROJECT_TARGETS_MANAGE,
  resourceType: 'external_engine_system',
  resourceIdFrom: 'body',
  resourceIdKey: 'externalSystemId',
  allowActionPermissionFallback: false,
}), validateBody(externalProjectEngineTargetDecommissionBodySchema), asyncHandler(async (req: Request, res: Response) => {
  const dataSource = await getDataSource()
  const tenantId = normalizeTenantIdForPersistence(req.tenant?.tenantId) || OSS_DEFAULT_TENANT_ID
  const externalSystem = await resolveExternalEngineSystem(dataSource, req.body.externalSystemId, tenantId)
  if (!externalSystem) throw Errors.validation('externalSystemId is required')

  const engine = await resolveExternalProjectEngineTargetEngine(dataSource, {
    engineId: req.body.engineId,
    externalEngineId: req.body.externalEngineId,
    externalSystemId: externalSystem.id,
  }, tenantId)
  const projectId = String(req.body.projectId)
  const engineId = String(engine.id)
  const externalEngineId = req.body.externalEngineId || engine.externalId || null
  const sourceRef = externalProjectEngineTargetSourceRef(externalSystem.id, projectId, engineId, req.body.externalTargetId)
  const targets = await projectEngineTargetService.listTargets({
    tenantId,
    projectId,
    engineId,
    status: 'all',
  })
  const target = targets[0] || null
  if (!target) {
    return res.json({ archived: false, targetId: null, reason: 'Project-engine target was not found' })
  }
  if (target.source !== 'external' || target.sourceRef !== sourceRef) {
    throw Errors.conflict('Project-engine target is not managed by this external system')
  }

  await projectEngineTargetService.archiveTarget(target.id, tenantId, true)
  await logAudit({
    tenantId: tenantId || undefined,
    userId: req.apiClient?.createdById || undefined,
    action: 'project_engine_target.external_registration.decommission',
    resourceType: 'project_engine_target',
    resourceId: target.id,
    details: {
      apiClientId: req.apiClient?.id,
      externalSystemId: externalSystem.id,
      externalProjectId: req.body.externalProjectId || null,
      externalTargetId: req.body.externalTargetId || null,
      projectId,
      engineId,
      externalEngineId,
      sourceRef,
    },
  })

  res.json({ archived: true, targetId: target.id })
}))

r.get('/engines-api/engines/:id', engineLimiter, requireAuth, requireEngineInventoryReadById, asyncHandler(async (req: Request, res: Response) => {
  const dataSource = await getDataSource()
  const engineRepo = dataSource.getRepository(Engine)
  const engineId = String(req.params.id)
  const engine = await engineRepo.findOneBy({ id: engineId })
  if (!engine) throw Errors.notFound('Engine')

  if (!(await canViewEngineSecrets(req, String(engine.id)))) {
    return res.json(redactEngineSecrets(withEngineCapabilities(serializeEngine(engine))))
  }

  res.json(withEngineCapabilities(serializeEngine(engine)))
}))

r.get('/engines-api/engines/:id/runtime-resources', engineLimiter, requireAuth, validateParams(engineIdParamSchema), validateQuery(runtimeResourceInventoryQuerySchema), requireEngineInventoryReadById, asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant?.tenantId || null
  const resources = await (await getDataSource()).getRepository(RuntimeResource).find({
    where: {
      engineId: String(req.params.id),
      ...(req.query.resourceKind ? { resourceKind: String(req.query.resourceKind) } : {}),
      ...(req.query.includeInactive === 'true' ? {} : { isActive: true }),
    },
    order: { resourceKind: 'ASC', resourceKey: 'ASC', id: 'ASC' },
  })
  res.json(RuntimeResourceSchema.array().parse(resources.filter((resource) => (resource.tenantId || null) === tenantId)))
}))

r.post('/engines-api/engines/:id/runtime-resources/reconcile', engineLimiter, requireAuth, reconciliationLimiter, validateParams(engineIdParamSchema), requireAction('engine.inventory.update', { resourceResolver: 'engine.byId', resourceIdFrom: 'params', resourceIdKey: 'id' }), asyncHandler(async (req: Request, res: Response) => {
  const engineId = String(req.params.id)
  const tenantId = req.tenant?.tenantId || null
  res.json(EngineMetadataReconciliationResultSchema.parse(await engineMetadataReconciliationService.reconcileEngine(engineId, tenantId)))
}))

r.post('/engines-api/engines/:id/camunda-native-grants/imports/preview', engineLimiter, requireAuth, engineRegistrationLimiter, validateParams(engineIdParamSchema), requireAction('platform.camunda-native-grants.preview', { resourceResolver: 'platform.self' }), requireDedicatedCamundaNativeGrantEngine, engineRegistrationJsonPayloadLimit, validateBody(nativeGrantPreviewBodySchema), asyncHandler(async (req: Request, res: Response) => {
  const dataSource = await getDataSource()
  const engineId = String(req.params.id)
  const engine = await dataSource.getRepository(Engine).findOne({ where: { id: engineId } })
  if (!engine) throw Errors.notFound('Engine')
  if (!isEngineVisibleInTenancyContext(engine, req.tenant?.tenantId || null)) throw Errors.notFound('Engine')
  if (engine.type !== 'camunda7') throw Errors.validation('Camunda native-grant migration is available only for Camunda 7 engines')
  const inventory = req.body.sourceKind === 'live_api'
    ? await camundaNativeGrantInventoryService.listLive(engineId)
    : camundaNativeGrantInventoryService.fromCustomerExport(req.body.customerExport)
  if (inventory.truncated) throw Errors.validation('The native-grant inventory exceeded the safe preview limit; narrow the export before continuing')
  const runtimeResources = await dataSource.getRepository(RuntimeResource).find({ where: { engineId, isActive: true } })
  const classifications = inventory.authorizations.map((authorization) => classifyCamundaNativeGrant(authorization, {
    runtimeResources: runtimeResources.map((resource) => ({
      resourceKind: resource.resourceKind as 'process_definition' | 'decision_definition',
      resourceKey: resource.resourceKey,
      runtimeTenantId: resource.runtimeTenantId || null,
      isActive: resource.isActive,
      tenantResolutionStatus: resource.tenantResolutionStatus as 'resolved' | 'unmapped' | 'conflict',
    })),
    requireResolvedTenant: engine.tenancyMode === 'shared',
  }))
  let run
  try {
    run = await camundaNativeGrantImportRunService.createPreview({
      engineId,
      tenantId: req.tenant?.tenantId || null,
      sourceKind: req.body.sourceKind,
      inputHash: inventory.inventoryHash,
      mappingCatalogVersion: 'camunda7-v1-read-only',
      inventoryTruncated: false,
      classifications,
      detailedSnapshot: {
        version: 1,
        authorizations: inventory.authorizations,
        classifications,
        contextCommitments: camundaNativeGrantMigrationCommitments(engine, runtimeResources),
      },
      actorId: req.user!.userId,
    })
  } catch (error) {
    if (error instanceof CamundaNativeGrantEvidenceLimitError) throw Errors.validation(error.message)
    throw error
  }
  await logAudit({ tenantId: req.tenant?.tenantId || undefined, userId: req.user!.userId, action: 'engine.camunda_native_grants.preview', resourceType: 'engine', resourceId: engineId, details: { importRunId: run.id, sourceKind: run.sourceKind, inputHash: run.inputHash, normalizedCounts: run.normalizedCounts } })
  res.status(201).json({ run })
}))

r.get('/engines-api/engines/:id/camunda-native-grants/imports', engineLimiter, requireAuth, validateParams(engineIdParamSchema), requireAction('platform.camunda-native-grants.history.read', { resourceResolver: 'platform.self' }), requireDedicatedCamundaNativeGrantEngine, asyncHandler(async (req: Request, res: Response) => {
  const engineId = String(req.params.id)
  const engine = await (await getDataSource()).getRepository(Engine).findOne({ where: { id: engineId } })
  if (!engine || !isEngineVisibleInTenancyContext(engine, req.tenant?.tenantId || null)) throw Errors.notFound('Engine')
  if (engine.type !== 'camunda7') throw Errors.validation('Camunda native-grant migration is available only for Camunda 7 engines')
  const runs = await camundaNativeGrantImportRunService.listForEngine({ engineId, tenantId: req.tenant?.tenantId || null })
  res.json(CamundaNativeGrantImportRunHistorySchema.parse({ runs }))
}))

r.get('/engines-api/engines/:id/camunda-native-grants/imports/:runId', engineLimiter, requireAuth, validateParams(nativeGrantImportRunIdParamSchema), requireAction('platform.camunda-native-grants.history.read', { resourceResolver: 'platform.self' }), requireDedicatedCamundaNativeGrantEngine, asyncHandler(async (req: Request, res: Response) => {
  const run = await camundaNativeGrantImportRunService.getSummary(String(req.params.runId))
  if (!run || run.engineId !== String(req.params.id) || (run.tenantId || null) !== (req.tenant?.tenantId || null)) throw Errors.notFound('Camunda native-grant import run')
  res.json({ run })
}))

r.get('/engines-api/engines/:id/camunda-native-grants/imports/:runId/detail', engineLimiter, requireAuth, validateParams(nativeGrantImportRunIdParamSchema), requireAction('platform.camunda-native-grants.sensitive.read', { resourceResolver: 'platform.self' }), requireDedicatedCamundaNativeGrantEngine, asyncHandler(async (req: Request, res: Response) => {
  const run = await camundaNativeGrantImportRunService.getSummary(String(req.params.runId))
  if (!run || run.engineId !== String(req.params.id) || (run.tenantId || null) !== (req.tenant?.tenantId || null)) throw Errors.notFound('Camunda native-grant import run')
  const detail = await camundaNativeGrantImportRunService.getDetailedSnapshot(run.id)
  if (!detail) throw Errors.notFound('Camunda native-grant import detail')
  res.json({ run, detail })
}))

r.get('/engines-api/engines/:id/backstop/status', engineLimiter, requireAuth, validateParams(engineIdParamSchema), requireAction('platform.engine-backstop.read', { resourceResolver: 'platform.self' }), asyncHandler(async (req: Request, res: Response) => {
  const engineId = String(req.params.id)
  const tenantId = req.tenant?.tenantId || null
  const engine = await (await getDataSource()).getRepository(Engine).findOne({ where: { id: engineId } })
  if (!engine || !isEngineVisibleInTenancyContext(engine, tenantId)) throw Errors.notFound('Engine')
  const [mappings, runs] = await Promise.all([
    engineBackstopGroupMappingService.list(engineId, tenantId!),
    engineBackstopSyncRunService.listForEngine({ engineId, tenantId }),
  ])
  res.json({ mappings, latestRun: runs[0] || null })
}))

r.get('/engines-api/engines/:id/backstop/mappings', engineLimiter, requireAuth, validateParams(engineIdParamSchema), requireAction('platform.engine-backstop.read', { resourceResolver: 'platform.self' }), asyncHandler(async (req: Request, res: Response) => {
  const engineId = String(req.params.id)
  const engine = await (await getDataSource()).getRepository(Engine).findOne({ where: { id: engineId } })
  if (!engine || !isEngineVisibleInTenancyContext(engine, req.tenant?.tenantId || null)) throw Errors.notFound('Engine')
  res.json({ mappings: await engineBackstopGroupMappingService.list(engineId, req.tenant?.tenantId || '') })
}))

r.post('/engines-api/engines/:id/backstop/mappings', engineLimiter, requireAuth, engineRegistrationLimiter, validateParams(engineIdParamSchema), requireAction('platform.engine-backstop.manage', { resourceResolver: 'platform.self' }), engineRegistrationJsonPayloadLimit, validateBody(EngineBackstopGroupMappingWriteRequestSchema), asyncHandler(async (req: Request, res: Response) => {
  const engineId = String(req.params.id)
  const engine = await (await getDataSource()).getRepository(Engine).findOne({ where: { id: engineId } })
  if (!engine || !isEngineVisibleInTenancyContext(engine, req.tenant?.tenantId || null)) throw Errors.notFound('Engine')
  const result = await engineBackstopGroupMappingService.write({ engineId, tenantId: req.tenant?.tenantId || '', request: req.body, actorId: req.user!.userId })
  await logAudit({ tenantId: req.tenant?.tenantId || undefined, userId: req.user!.userId, action: 'engine.backstop.mapping.write', resourceType: 'engine', resourceId: engineId, details: { mappingCount: result.mappings.length } })
  res.status(200).json(EngineBackstopGroupMappingWriteResponseSchema.parse(result))
}))

r.post('/engines-api/engines/:id/backstop/sync/preview', engineLimiter, requireAuth, engineRegistrationLimiter, validateParams(engineIdParamSchema), requireAction('platform.engine-backstop.preview', { resourceResolver: 'platform.self' }), engineRegistrationJsonPayloadLimit, validateBody(backstopPreviewBodySchema), asyncHandler(async (req: Request, res: Response) => {
  const engineId = String(req.params.id)
  const tenantId = req.tenant?.tenantId || null
  const engine = await (await getDataSource()).getRepository(Engine).findOne({ where: { id: engineId } })
  if (!engine || !isEngineVisibleInTenancyContext(engine, tenantId)) throw Errors.notFound('Engine')
  try {
    const run = await engineBackstopSyncService.preview({ engineId, tenantId, actorId: req.user!.userId })
    await logAudit({ tenantId: tenantId || undefined, userId: req.user!.userId, action: 'engine.backstop.preview', resourceType: 'engine', resourceId: engineId, details: { runId: run.id, desiredHash: run.desiredHash, counts: run.counts } })
    res.status(201).json({ run })
  } catch (error) {
    if (error instanceof EngineBackstopEvidenceLimitError) throw Errors.validation(error.message)
    throw error
  }
}))

r.get('/engines-api/engines/:id/backstop/sync', engineLimiter, requireAuth, validateParams(engineIdParamSchema), requireAction('platform.engine-backstop.read', { resourceResolver: 'platform.self' }), asyncHandler(async (req: Request, res: Response) => {
  const engineId = String(req.params.id)
  const tenantId = req.tenant?.tenantId || null
  const engine = await (await getDataSource()).getRepository(Engine).findOne({ where: { id: engineId } })
  if (!engine || !isEngineVisibleInTenancyContext(engine, tenantId)) throw Errors.notFound('Engine')
  res.json(EngineBackstopSyncRunHistorySchema.parse({ runs: await engineBackstopSyncRunService.listForEngine({ engineId, tenantId }) }))
}))

r.get('/engines-api/engines/:id/backstop/sync/:runId', engineLimiter, requireAuth, validateParams(backstopSyncRunIdParamSchema), requireAction('platform.engine-backstop.read', { resourceResolver: 'platform.self' }), asyncHandler(async (req: Request, res: Response) => {
  const run = await engineBackstopSyncRunService.getSummary(String(req.params.runId))
  if (!run || run.engineId !== String(req.params.id) || (run.tenantId || null) !== (req.tenant?.tenantId || null)) throw Errors.notFound('Backstop sync run')
  res.json({ run: EngineBackstopSyncRunSummarySchema.parse(run) })
}))

r.get('/engines-api/engines/:id/backstop/sync/:runId/detail', engineLimiter, requireAuth, validateParams(backstopSyncRunIdParamSchema), requireAction('platform.engine-backstop.sensitive.read', { resourceResolver: 'platform.self' }), asyncHandler(async (req: Request, res: Response) => {
  const run = await engineBackstopSyncRunService.getSummary(String(req.params.runId))
  if (!run || run.engineId !== String(req.params.id) || (run.tenantId || null) !== (req.tenant?.tenantId || null)) throw Errors.notFound('Backstop sync run')
  const detail = await engineBackstopSyncRunService.getDetailedSnapshot(run.id)
  if (!detail) throw Errors.notFound('Backstop sync detail')
  res.json({ run, detail })
}))

r.post('/engines-api/engines/:id/backstop/sync/:runId/apply', engineLimiter, requireAuth, engineRegistrationLimiter, validateParams(backstopSyncRunIdParamSchema), requireAction('platform.engine-backstop.apply', { resourceResolver: 'platform.self' }), requireAction('platform.engine-backstop.sensitive.read', { resourceResolver: 'platform.self' }), engineRegistrationJsonPayloadLimit, validateBody(EngineBackstopSyncApplyRequestSchema), asyncHandler(async (req: Request, res: Response) => {
  const engineId = String(req.params.id)
  const tenantId = req.tenant?.tenantId || null
  const engine = await (await getDataSource()).getRepository(Engine).findOne({ where: { id: engineId } })
  if (!engine || !isEngineVisibleInTenancyContext(engine, tenantId)) throw Errors.notFound('Engine')
  const result = await engineBackstopSyncService.apply({ engineId, tenantId, runId: String(req.params.runId), request: req.body, actorId: req.user!.userId })
  await logAudit({ tenantId: tenantId || undefined, userId: req.user!.userId, action: 'engine.backstop.apply', resourceType: 'engine', resourceId: engineId, details: { runId: result.run.id, status: result.run.status, desiredHash: result.run.desiredHash, taskStatus: result.task?.status || null } })
  res.json(result)
}))

r.post('/engines-api/engines/:id/backstop/sync/:runId/rollback', engineLimiter, requireAuth, engineRegistrationLimiter, validateParams(backstopSyncRunIdParamSchema), requireAction('platform.engine-backstop.apply', { resourceResolver: 'platform.self' }), requireAction('platform.engine-backstop.sensitive.read', { resourceResolver: 'platform.self' }), engineRegistrationJsonPayloadLimit, validateBody(EngineBackstopSyncRollbackRequestSchema), asyncHandler(async (req: Request, res: Response) => {
  const engineId = String(req.params.id)
  const tenantId = req.tenant?.tenantId || null
  const engine = await (await getDataSource()).getRepository(Engine).findOne({ where: { id: engineId } })
  if (!engine || !isEngineVisibleInTenancyContext(engine, tenantId)) throw Errors.notFound('Engine')
  const result = await engineBackstopSyncService.rollback({ engineId, tenantId, runId: String(req.params.runId), request: req.body, actorId: req.user!.userId })
  await logAudit({ tenantId: tenantId || undefined, userId: req.user!.userId, action: 'engine.backstop.rollback', resourceType: 'engine', resourceId: engineId, details: { runId: result.run.id, rollbackOfRunId: result.run.rollbackOfRunId, status: result.run.status, taskStatus: result.task?.status || null } })
  res.json(result)
}))

r.post('/engines-api/engines/:id/backstop/sync/:runId/drift-check', engineLimiter, requireAuth, engineRegistrationLimiter, validateParams(backstopSyncRunIdParamSchema), requireAction('platform.engine-backstop.drift-check', { resourceResolver: 'platform.self' }), engineRegistrationJsonPayloadLimit, validateBody(backstopPreviewBodySchema), asyncHandler(async (req: Request, res: Response) => {
  const engineId = String(req.params.id)
  const tenantId = req.tenant?.tenantId || null
  const engine = await (await getDataSource()).getRepository(Engine).findOne({ where: { id: engineId } })
  if (!engine || !isEngineVisibleInTenancyContext(engine, tenantId)) throw Errors.notFound('Engine')
  const result = await engineBackstopSyncService.driftCheck({ engineId, tenantId, runId: String(req.params.runId), actorId: req.user!.userId })
  await logAudit({ tenantId: tenantId || undefined, userId: req.user!.userId, action: 'engine.backstop.drift_check', resourceType: 'engine', resourceId: engineId, details: { runId: result.run.id, observedOfRunId: result.run.observedOfRunId, status: result.run.status, taskStatus: result.task?.status || null } })
  res.json(result)
}))

r.post('/engines-api/engines/:id/camunda-native-grants/imports/:runId/draft', engineLimiter, requireAuth, engineRegistrationLimiter, validateParams(nativeGrantImportRunIdParamSchema), requireAction('platform.camunda-native-grants.draft', { resourceResolver: 'platform.self' }), requireAction('platform.camunda-native-grants.sensitive.read', { resourceResolver: 'platform.self' }), requireDedicatedCamundaNativeGrantEngine, engineRegistrationJsonPayloadLimit, validateBody(nativeGrantDraftBodySchema), asyncHandler(async (req: Request, res: Response) => {
  const run = await camundaNativeGrantImportRunService.getSummary(String(req.params.runId))
  if (!run || run.engineId !== String(req.params.id) || (run.tenantId || null) !== (req.tenant?.tenantId || null)) throw Errors.notFound('Camunda native-grant import run')
  const detail = await camundaNativeGrantImportRunService.getDetailedSnapshot(run.id)
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) throw Errors.notFound('Camunda native-grant import detail')
  const classifications = CamundaNativeGrantClassificationSchema.array().parse((detail as Record<string, unknown>).classifications)
  assertDedicatedNativeGrantMigrationBase(req.body.base)
  if (req.body.groupMappings.some((mapping: { target: { mode: string } }) => mapping.target.mode !== 'new')) {
    throw Errors.validation('Initial native-grant migration drafts create new EnterpriseGlue groups; map existing groups through a separately reviewed configuration bundle')
  }
  const dataSource = await getDataSource()
  const engine = await dataSource.getRepository(Engine).findOne({ where: { id: run.engineId } })
  if (!engine || !isEngineVisibleInTenancyContext(engine, req.tenant?.tenantId || null)) throw Errors.notFound('Engine')
  const runtimeResources = await dataSource.getRepository(RuntimeResource).find({ where: { engineId: run.engineId, isActive: true } })
  try {
    assertCamundaNativeGrantMigrationContext(detail, engine, runtimeResources)
  } catch (error) {
    throw Errors.validation(error instanceof Error ? error.message : 'Native-grant migration context changed')
  }
  // A native-grant migration never changes connection/topology ownership, even
  // when the engine also appears in another configuration bundle. Always use
  // the narrowly scoped existing-engine reference rather than requiring a
  // customer to reconstruct or re-add the engine configuration.
  const engineReferenceMode = 'existing_registered' as const
  const engineKey = camundaNativeGrantExternalEngineKey(engine.id)
  const draft = camundaNativeGrantDraftService.generate({
    base: req.body.base,
    engineKey,
    engineReferenceMode,
    classifications,
    groupMappings: req.body.groupMappings,
  })
  let updatedRun
  try {
    updatedRun = await camundaNativeGrantImportRunService.setDraft({
      id: run.id,
      draftHash: draft.canonicalHash,
      approverId: req.user!.userId,
      draft: {
        ...draft,
        engineReference: { key: engineKey, engineId: engine.id, mode: engineReferenceMode },
      },
    })
  } catch (error) {
    if (error instanceof CamundaNativeGrantEvidenceLimitError) throw Errors.validation(error.message)
    throw error
  }
  if (!updatedRun) throw Errors.notFound('Camunda native-grant import run')
  await logAudit({ tenantId: req.tenant?.tenantId || undefined, userId: req.user!.userId, action: 'engine.camunda_native_grants.draft', resourceType: 'engine', resourceId: run.engineId, details: { importRunId: run.id, draftHash: draft.canonicalHash, generated: draft.generated, manualWorkCount: draft.manualWorkAuthorizationIds.length } })
  res.json({ run: updatedRun, draft })
}))

r.post('/engines-api/engines/:id/camunda-native-grants/imports/:runId/apply', engineLimiter, requireAuth, engineRegistrationLimiter, validateParams(nativeGrantImportRunIdParamSchema), requireAction('platform.camunda-native-grants.draft', { resourceResolver: 'platform.self' }), requireAction('platform.camunda-native-grants.sensitive.read', { resourceResolver: 'platform.self' }), requireAction('platform.config-bundles.apply', { resourceResolver: 'platform.self' }), requireDedicatedCamundaNativeGrantEngine, engineRegistrationJsonPayloadLimit, validateBody(nativeGrantApplyBodySchema), asyncHandler(async (req: Request, res: Response) => {
  const run = await camundaNativeGrantImportRunService.getSummary(String(req.params.runId))
  if (!run || run.engineId !== String(req.params.id) || (run.tenantId || null) !== (req.tenant?.tenantId || null)) throw Errors.notFound('Camunda native-grant import run')
  if (!['draft_generated', 'applied'].includes(run.status) || !run.draftHash || run.draftHash !== req.body.expectedDraftHash) {
    throw Errors.validation('The submitted draft hash does not match an approved native-grant migration draft')
  }
  const draft = await camundaNativeGrantImportRunService.getGeneratedDraft(run.id)
  if (!draft || draft.canonicalHash !== run.draftHash || draft.canonicalHash !== req.body.expectedDraftHash) {
    throw Errors.validation('The reviewed native-grant draft is unavailable or no longer matches its import receipt')
  }
  const dataSource = await getDataSource()
  const engine = await dataSource.getRepository(Engine).findOne({ where: { id: run.engineId } })
  if (!engine || !isEngineVisibleInTenancyContext(engine, req.tenant?.tenantId || null) || engine.type !== 'camunda7') throw Errors.notFound('Engine')
  if (draft.engineReference.engineId !== engine.id) throw Errors.validation('The reviewed migration draft is bound to a different engine')
  const [detail, runtimeResources] = await Promise.all([
    camundaNativeGrantImportRunService.getDetailedSnapshot(run.id),
    dataSource.getRepository(RuntimeResource).find({ where: { engineId: run.engineId, isActive: true } }),
  ])
  try {
    assertCamundaNativeGrantMigrationContext(detail, engine, runtimeResources)
  } catch (error) {
    throw Errors.validation(error instanceof Error ? error.message : 'Native-grant migration context changed')
  }

  const settings = await platformSettingsService.get()
  const policy = {
    ...settings,
    tenantReferenceResolver: engineTenantReferenceResolver(req),
    tenantReferencePrincipalType: 'user' as const,
    tenantReferencePrincipalId: req.user!.userId,
    ...(draft.engineReference.mode === 'existing_registered'
      ? { externalEngineReferences: [{ key: draft.engineReference.key, engineId: engine.id }] }
      : {}),
  }
  const result = await configBundleApplyService.apply({
    bundle: draft.bundle,
    files: draft.files,
    expectedPreviewHash: run.draftHash,
    expectedTenantScope: req.tenant?.tenantId || 'platform',
    acknowledgements: req.body.acknowledgements || [],
    idempotencyKey: `camunda-native-grant:${run.id}:${run.draftHash}`,
    identityReconciliationMode: 'none',
    tenantId: req.tenant?.tenantId || null,
    actorId: req.user!.userId,
  }, policy)
  if (!result.applyRunId) throw Errors.validation('Configuration apply did not create an auditable apply run')
  const updatedRun = await camundaNativeGrantImportRunService.markApplied({ id: run.id, configBundleApplyRunId: result.applyRunId })
  if (!updatedRun) throw Errors.notFound('Camunda native-grant import run')
  await logAudit({
    tenantId: req.tenant?.tenantId || undefined,
    userId: req.user!.userId,
    action: 'engine.camunda_native_grants.apply',
    resourceType: 'engine',
    resourceId: engine.id,
    details: {
      importRunId: run.id,
      draftHash: run.draftHash,
      configBundleApplyRunId: result.applyRunId,
      created: result.created,
      updated: result.updated,
      archived: result.archived,
      reconciliation: result.reconciliation,
    },
  })
  res.json({ run: updatedRun, result })
}))

r.post('/engines-api/engines/:id/camunda-native-grants/imports/:runId/rollback/preview', engineLimiter, requireAuth, engineRegistrationLimiter, validateParams(nativeGrantImportRunIdParamSchema), requireAction('platform.camunda-native-grants.draft', { resourceResolver: 'platform.self' }), requireAction('platform.camunda-native-grants.sensitive.read', { resourceResolver: 'platform.self' }), requireAction('platform.config-bundles.preview', { resourceResolver: 'platform.self' }), requireDedicatedCamundaNativeGrantEngine, engineRegistrationJsonPayloadLimit, validateBody(nativeGrantRollbackPreviewBodySchema), asyncHandler(async (req: Request, res: Response) => {
  const run = await camundaNativeGrantImportRunService.getSummary(String(req.params.runId))
  if (!run || run.engineId !== String(req.params.id) || (run.tenantId || null) !== (req.tenant?.tenantId || null)) throw Errors.notFound('Camunda native-grant import run')
  if (run.status !== 'applied') throw Errors.validation('Only an applied native-grant migration can be rolled back')
  const draft = await camundaNativeGrantImportRunService.getGeneratedDraft(run.id)
  if (!draft || !run.draftHash || draft.canonicalHash !== run.draftHash) throw Errors.validation('The reviewed native-grant draft is unavailable for rollback')
  const engine = await (await getDataSource()).getRepository(Engine).findOne({ where: { id: run.engineId } })
  if (!engine || !isEngineVisibleInTenancyContext(engine, req.tenant?.tenantId || null)) throw Errors.notFound('Engine')
  if (draft.engineReference.engineId !== engine.id) throw Errors.validation('The reviewed migration draft is bound to a different engine')
  const rollback = nativeGrantRollbackConfiguration(draft)
  const settings = await platformSettingsService.get()
  const policy = {
    ...settings,
    tenantReferenceResolver: engineTenantReferenceResolver(req),
    tenantReferencePrincipalType: 'user' as const,
    tenantReferencePrincipalId: req.user!.userId,
    ...(draft.engineReference.mode === 'existing_registered'
      ? { externalEngineReferences: [{ key: draft.engineReference.key, engineId: engine.id }] }
      : {}),
  }
  const compilation = configBundlePreviewService.compile(rollback, policy)
  if (!compilation.preview.valid || !compilation.preview.canonicalHash) throw Errors.validation('Generated native-grant rollback configuration is invalid')
  const diff = await configBundleDiffService.diff(rollback, req.tenant?.tenantId || null, policy)
  if (!diff.valid) throw Errors.validation('Generated native-grant rollback diff is invalid')
  await logAudit({ tenantId: req.tenant?.tenantId || undefined, userId: req.user!.userId, action: 'engine.camunda_native_grants.rollback.preview', resourceType: 'engine', resourceId: engine.id, details: { importRunId: run.id, rollbackHash: compilation.preview.canonicalHash, requiredAcknowledgementCount: diff.requiredAcknowledgements.length, changeCount: diff.changes.length } })
  res.json({ rollback: { canonicalHash: compilation.preview.canonicalHash, requiredAcknowledgements: diff.requiredAcknowledgements, changes: diff.changes, warnings: diff.warnings } })
}))

r.post('/engines-api/engines/:id/camunda-native-grants/imports/:runId/rollback', engineLimiter, requireAuth, engineRegistrationLimiter, validateParams(nativeGrantImportRunIdParamSchema), requireAction('platform.camunda-native-grants.draft', { resourceResolver: 'platform.self' }), requireAction('platform.camunda-native-grants.sensitive.read', { resourceResolver: 'platform.self' }), requireAction('platform.config-bundles.apply', { resourceResolver: 'platform.self' }), requireDedicatedCamundaNativeGrantEngine, engineRegistrationJsonPayloadLimit, validateBody(nativeGrantRollbackBodySchema), asyncHandler(async (req: Request, res: Response) => {
  const run = await camundaNativeGrantImportRunService.getSummary(String(req.params.runId))
  if (!run || run.engineId !== String(req.params.id) || (run.tenantId || null) !== (req.tenant?.tenantId || null)) throw Errors.notFound('Camunda native-grant import run')
  if (run.status !== 'applied') throw Errors.validation('Only an applied native-grant migration can be rolled back')
  const draft = await camundaNativeGrantImportRunService.getGeneratedDraft(run.id)
  if (!draft || !run.draftHash || draft.canonicalHash !== run.draftHash) throw Errors.validation('The reviewed native-grant draft is unavailable for rollback')
  const engine = await (await getDataSource()).getRepository(Engine).findOne({ where: { id: run.engineId } })
  if (!engine || !isEngineVisibleInTenancyContext(engine, req.tenant?.tenantId || null)) throw Errors.notFound('Engine')
  if (draft.engineReference.engineId !== engine.id) throw Errors.validation('The reviewed migration draft is bound to a different engine')
  const rollback = nativeGrantRollbackConfiguration(draft)
  const settings = await platformSettingsService.get()
  const policy = {
    ...settings,
    tenantReferenceResolver: engineTenantReferenceResolver(req),
    tenantReferencePrincipalType: 'user' as const,
    tenantReferencePrincipalId: req.user!.userId,
    ...(draft.engineReference.mode === 'existing_registered'
      ? { externalEngineReferences: [{ key: draft.engineReference.key, engineId: engine.id }] }
      : {}),
  }
  const compilation = configBundlePreviewService.compile(rollback, policy)
  if (!compilation.preview.valid || !compilation.preview.canonicalHash || compilation.preview.canonicalHash !== req.body.expectedRollbackHash) {
    throw Errors.validation('The submitted rollback hash does not match the reviewed native-grant rollback configuration')
  }
  const result = await configBundleApplyService.apply({
    bundle: rollback.bundle,
    files: rollback.files,
    expectedPreviewHash: compilation.preview.canonicalHash,
    expectedTenantScope: req.tenant?.tenantId || 'platform',
    acknowledgements: req.body.acknowledgements,
    idempotencyKey: `camunda-native-grant-rollback:${run.id}:${compilation.preview.canonicalHash}`,
    identityReconciliationMode: 'none',
    tenantId: req.tenant?.tenantId || null,
    actorId: req.user!.userId,
  }, policy)
  if (!result.applyRunId) throw Errors.validation('Configuration rollback did not create an auditable apply run')
  const updatedRun = await camundaNativeGrantImportRunService.markRolledBack({ id: run.id, configBundleApplyRunId: result.applyRunId })
  if (!updatedRun) throw Errors.notFound('Camunda native-grant import run')
  await logAudit({ tenantId: req.tenant?.tenantId || undefined, userId: req.user!.userId, action: 'engine.camunda_native_grants.rollback.apply', resourceType: 'engine', resourceId: engine.id, details: { importRunId: run.id, rollbackHash: compilation.preview.canonicalHash, configBundleApplyRunId: result.applyRunId, created: result.created, updated: result.updated, archived: result.archived } })
  res.json({ run: updatedRun, result })
}))

r.get('/engines-api/engines/:id/project-targets', engineLimiter, requireAuth, validateParams(engineIdParamSchema), requireAction('engine.project-access.requests.read', { resourceResolver: 'engine.byId', resourceIdFrom: 'params', resourceIdKey: 'id', acceptedPermissions: [EnginePermissions.PROJECT_ACCESS_VIEW, EnginePermissions.MEMBERS_MANAGE] }), asyncHandler(async (req: Request, res: Response) => {
  const targets = await projectEngineTargetService.listTargets({
    engineId: String(req.params.id),
    status: 'all',
    tenantId: req.tenant?.tenantId || null,
  })
  res.json(ProjectEngineTargetSchema.array().parse(targets))
}))

r.get('/engines-api/engines/tenancy/classification-report', engineLimiter, requireAuth, requireAction('engine.tenancy.classification.read', { resourceResolver: 'platform.self' }), asyncHandler(async (_req: Request, res: Response) => {
  res.json(EngineTenancyClassificationReportSchema.parse(
    await engineTenancyTransitionService.classificationReport(),
  ))
}))

r.get('/engines-api/engines/:id/tenancy/diagnostics', engineLimiter, requireAuth, validateParams(engineIdParamSchema), requireAction('engine.inventory.read', { resourceResolver: 'engine.byId', resourceIdFrom: 'params', resourceIdKey: 'id' }), asyncHandler(async (req: Request, res: Response) => {
  res.json(await engineTenantMappingService.getDiagnostics(String(req.params.id)))
}))

r.post('/engines-api/engines/:id/tenancy/preview', engineLimiter, requireAuth, engineRegistrationLimiter, validateParams(engineIdParamSchema), requireAction('engine.inventory.update', { resourceResolver: 'engine.byId', resourceIdFrom: 'params', resourceIdKey: 'id', acceptedPermissions: [EnginePermissions.ENGINE_EDIT], unownedEngineMigrationPermission: PlatformPermissions.ENGINE_REGISTRATION_MANAGE }), engineRegistrationJsonPayloadLimit, validateBody(EngineTenancyTransitionPreviewRequestSchema), asyncHandler(async (req: Request, res: Response) => {
  const engineId = String(req.params.id)
  const engine = await (await getDataSource()).getRepository(Engine).findOne({ where: { id: engineId } })
  if (!engine) throw Errors.notFound('Engine')
  const externallyOwned = getExternalOwnedUpdateFields(engine, { tenancy: req.body.tenancy })
  if (externallyOwned.length > 0) {
    throw Errors.validation('Externally managed engine topology can only be changed by its owning source')
  }
  const configLocked = getConfigLockedUpdateFields(engine, { tenancy: req.body.tenancy })
  if (configLocked.length > 0) {
    throw Errors.forbidden('Configuration-managed engine topology can only be changed by its owning bundle')
  }
  const result = await engineTenancyTransitionService.preview(engineId, req.body, {
    requestTenantId: req.tenant?.tenantId || null,
    principalType: 'user',
    principalId: req.user!.userId,
    resolver: engineTenantReferenceResolver(req),
  })
  await logAudit({
    tenantId: req.tenant?.tenantId || undefined,
    userId: req.user!.userId,
    action: 'engine.tenancy.transition.preview',
    resourceType: 'engine',
    resourceId: engineId,
    details: {
      kind: result.kind,
      previewHash: result.previewHash,
      previewExpiresAt: result.previewExpiresAt,
      requiredAcknowledgements: result.requiredAcknowledgements,
      current: result.current,
      proposed: result.proposed,
      effects: result.effects,
    },
  })
  res.json(EngineTenancyTransitionPreviewResponseSchema.parse(result))
}))

r.post('/engines-api/engines/:id/tenancy/apply', engineLimiter, requireAuth, engineRegistrationLimiter, validateParams(engineIdParamSchema), requireAction('engine.inventory.update', { resourceResolver: 'engine.byId', resourceIdFrom: 'params', resourceIdKey: 'id', acceptedPermissions: [EnginePermissions.ENGINE_EDIT], unownedEngineMigrationPermission: PlatformPermissions.ENGINE_REGISTRATION_MANAGE }), engineRegistrationJsonPayloadLimit, validateBody(EngineTenancyTransitionApplyRequestSchema), asyncHandler(async (req: Request, res: Response) => {
  const engineId = String(req.params.id)
  const engine = await (await getDataSource()).getRepository(Engine).findOne({ where: { id: engineId } })
  if (!engine) throw Errors.notFound('Engine')
  const externallyOwned = getExternalOwnedUpdateFields(engine, { tenancy: req.body.tenancy })
  if (externallyOwned.length > 0) {
    throw Errors.validation('Externally managed engine topology can only be changed by its owning source')
  }
  const configLocked = getConfigLockedUpdateFields(engine, { tenancy: req.body.tenancy })
  if (configLocked.length > 0) {
    throw Errors.forbidden('Configuration-managed engine topology can only be changed by its owning bundle')
  }
  const result = await engineTenancyTransitionService.apply(engineId, req.body, {
    requestTenantId: req.tenant?.tenantId || null,
    principalType: 'user',
    principalId: req.user!.userId,
    resolver: engineTenantReferenceResolver(req),
  })
  await refreshEngineSetMaterializationsForEngine(engineId, result.transition.proposed.tenantId)
  if (result.transition.proposed.mode === 'dedicated') {
    await refreshRuntimeResourceSetMaterializationsForEngine(engineId, result.transition.proposed.tenantId)
  }
  scheduleRuntimeInventoryReconciliation(engineId, result.transition.proposed.tenantId, {
    runtimeAccessScope: result.transition.proposed.runtimeAccessScope,
    metadataDiscoveryEnabled: engine.metadataDiscoveryEnabled,
    deploymentDiscoveryEnabled: engine.deploymentDiscoveryEnabled !== false,
  })
  await logAudit({
    tenantId: req.tenant?.tenantId || undefined,
    userId: req.user!.userId,
    action: 'engine.tenancy.transition.apply',
    resourceType: 'engine',
    resourceId: engineId,
    details: {
      kind: result.transition.kind,
      previewHash: result.previewHash,
      acknowledgements: req.body.acknowledgements,
      current: result.transition.current,
      proposed: result.transition.proposed,
      effects: result.transition.effects,
    },
  })
  res.json(EngineTenancyTransitionApplyResponseSchema.parse(result))
}))

r.get('/engines-api/engines/:id/tenant-mappings', engineLimiter, requireAuth, validateParams(engineIdParamSchema), requireAction('engine.inventory.update', { resourceResolver: 'engine.byId', resourceIdFrom: 'params', resourceIdKey: 'id', acceptedPermissions: [EnginePermissions.ENGINE_EDIT] }), asyncHandler(async (req: Request, res: Response) => {
  const rows = await engineTenantMappingService.list(String(req.params.id))
  res.json(EngineTenantMappingSchema.array().parse(rows.map((row: EngineTenantMapping) => {
    const { tenantReferenceJson: _tenantReferenceJson, ...publicRow } = row
    return {
      ...publicRow,
      createdAt: Number(row.createdAt),
      updatedAt: Number(row.updatedAt),
      lastAppliedAt: row.lastAppliedAt == null ? null : Number(row.lastAppliedAt),
    }
  })))
}))

r.put('/engines-api/engines/:id/tenant-mappings', engineLimiter, requireAuth, engineRegistrationLimiter, validateParams(engineIdParamSchema), requireAction('engine.inventory.update', { resourceResolver: 'engine.byId', resourceIdFrom: 'params', resourceIdKey: 'id', acceptedPermissions: [EnginePermissions.ENGINE_EDIT] }), engineRegistrationJsonPayloadLimit, validateBody(ExternalEngineTenantMappingsUpsertRequestSchema), asyncHandler(async (req: Request, res: Response) => {
  const result = await engineTenantMappingService.upsert({
    engineId: String(req.params.id),
    request: req.body,
    requestTenantId: req.tenant?.tenantId || null,
    principalType: 'user',
    principalId: req.user!.userId,
    source: 'manual',
    ownershipMode: 'manual',
    resolver: engineTenantReferenceResolver(req),
  })
  await logAudit({
    tenantId: req.tenant?.tenantId || undefined,
    userId: req.user!.userId,
    action: req.body.dryRun ? 'engine.tenant_mappings.preview' : 'engine.tenant_mappings.upsert',
    resourceType: 'engine',
    resourceId: String(req.params.id),
    details: {
      dryRun: result.dryRun,
      mappingVersion: result.mappingVersion,
      created: result.created,
      updated: result.updated,
      deactivated: result.deactivated,
      unchanged: result.unchanged,
    },
  })
  res.json(result)
}))

r.put('/engines-api/engines/:id', engineLimiter, requireAuth, engineRegistrationLimiter, validateParams(engineIdParamSchema), requireAction('engine.inventory.update', { resourceResolver: 'engine.byId', resourceIdFrom: 'params', resourceIdKey: 'id', acceptedPermissions: [EnginePermissions.ENGINE_EDIT, EnginePermissions.SECRETS_MANAGE] }), engineRegistrationJsonPayloadLimit, validateBody(updateEngineBodySchema), asyncHandler(async (req: Request, res: Response) => {
  const dataSource = await getDataSource()
  const engineRepo = dataSource.getRepository(Engine)
  const engineId = String(req.params.id)
  const existing = await engineRepo.findOneBy({ id: engineId })
  if (!existing) throw Errors.notFound('Engine')
  if ((await getEngineOnboardingMode()) === 'external_only' && existing.registrationSource !== 'external_api') {
    throw Errors.forbidden('Manual engine updates are disabled by the current onboarding policy')
  }
  const containsSecretUpdate = requestContainsAnyField(req, ENGINE_SECRET_UPDATE_FIELDS)
  const containsInventoryUpdate = Object.keys(req.body).some((field) => !ENGINE_SECRET_UPDATE_FIELDS.includes(field as typeof ENGINE_SECRET_UPDATE_FIELDS[number]))
  if (containsSecretUpdate && !(await canManageEngineSecrets(req, engineId))) {
    throw Errors.forbidden('Engine secret management permission is required to update authentication fields')
  }
  if (containsInventoryUpdate && !(await canEditEngine(req, engineId))) {
    throw Errors.forbidden('Engine edit permission is required to update inventory fields')
  }
  const externallyOwnedUpdateFields = getExternalOwnedUpdateFields(existing, req.body)
  if (externallyOwnedUpdateFields.length > 0) {
    throw Errors.validation(`Externally managed engine fields are read-only: ${externallyOwnedUpdateFields.join(', ')}`)
  }
  const configLockedUpdateFields = getConfigLockedUpdateFields(existing, req.body)
  if (configLockedUpdateFields.length > 0) {
    throw Errors.forbidden(`Configuration-managed engine fields are read-only: ${configLockedUpdateFields.join(', ')}`)
  }
  if (req.body.runtimeAccessScope === 'engine_wide' && existing.runtimeAccessScope === 'resource_aware') {
    await assertEngineCanUseEngineWideAccess(dataSource, engineId)
  }
  const resolvedTenancy = await engineTenancyProvisioningService.validateUpdate(existing, {
    tenancy: req.body.tenancy,
    runtimeAccessScope: req.body.runtimeAccessScope || existing.runtimeAccessScope || 'engine_wide',
    requestTenantId: req.tenant?.tenantId || null,
    principalType: 'user',
    principalId: req.user!.userId,
    resolver: engineTenantReferenceResolver(req),
  })
  const nextConnectionMode = req.body.connectionMode || existing.connectionMode || 'direct'
  const nextAuthType = req.body.authType || existing.authType || 'basic'
  const settings = await platformSettingsService.get()
  assertEndpointAuthenticationPolicy(nextConnectionMode, nextAuthType, settings.credentiallessCustomerSidecarsEnabled ?? false)
  if (req.body.baseUrl !== undefined) {
    assertEngineEndpointPolicy(req.body.baseUrl)
  }
  if (req.body.oauthTokenUrl) {
    validateBpmnEngineEndpointUrl(req.body.oauthTokenUrl, 'OAuth2 token URL')
  }
  const dockerLoopbackError = getDockerLoopbackEngineError(req.body.baseUrl)
  if (dockerLoopbackError) {
    return res.status(400).json({ error: dockerLoopbackError, field: 'baseUrl' })
  }

  const now = Date.now()
  const updates: any = {
    name: req.body.name,
    baseUrl: req.body.baseUrl,
    connectionMode: req.body.connectionMode,
    type: req.body.type,
    externalId: req.body.externalId === undefined ? undefined : req.body.externalId?.trim() || null,
    labelsJson: req.body.labels === undefined ? undefined : labelsToJson(req.body.labels),
    authType: req.body.authType,
    username: req.body.username,
    passwordEnc: req.body.passwordEnc === undefined ? undefined : secretResolver.normalizeForStorage(req.body.passwordEnc),
    oauthTokenUrl: req.body.oauthTokenUrl,
    oauthScopes: req.body.oauthScopes,
    oauthAudience: req.body.oauthAudience,
    version: req.body.version,
    environmentTagId: req.body.environmentTagId === undefined ? undefined : req.body.environmentTagId || null,
    runtimeAccessScope: req.body.runtimeAccessScope,
    deploymentIntegration: req.body.deploymentIntegration,
    metadataDiscoveryEnabled: req.body.metadataDiscoveryEnabled,
    deploymentDiscoveryEnabled: req.body.deploymentDiscoveryEnabled,
    reconciliationIntervalSeconds: req.body.reconciliationIntervalSeconds,
    pipelineReceiptEnabled: req.body.pipelineReceiptEnabled,
    tenancyMode: resolvedTenancy?.tenancyMode,
    tenantId: resolvedTenancy?.tenantId,
    tenantMappingStrategy: resolvedTenancy?.tenantMappingStrategy,
    tenantMappingVersion: resolvedTenancy?.tenantMappingVersion,
    tenantResolutionStatus: resolvedTenancy?.tenantResolutionStatus,
    driftStatus: isConfigWarnUpdate(existing, req.body) ? 'manual_override' : undefined,
    updatedAt: now,
  }
  if (req.body.externalId !== undefined || req.body.labels !== undefined) {
    const nextExternalId = updates.externalId === undefined ? existing.externalId : updates.externalId
    const nextLabelsJson = updates.labelsJson === undefined ? existing.labelsJson : updates.labelsJson
    await dataSource.transaction(async (manager) => {
      await manager.getRepository(Engine).update({ id: engineId }, updates)
      await syncExternalEngineRegistration(manager, {
        engineId,
        externalId: nextExternalId,
        labelsJson: nextLabelsJson,
        registrationSource: existing.registrationSource || 'user',
        apiClientId: null,
        externalSystemId: existing.externalSystemId || null,
        managementMode: existing.managementMode || (existing.registrationSource === 'external_api' ? 'external_managed' : 'manual'),
        fieldOwnershipJson: existing.fieldOwnershipJson || null,
        driftStatus: existing.driftStatus || null,
        lifecycleStatus: existing.lifecycleStatus || 'active',
        lastExternalSyncAt: existing.lastExternalSyncAt || null,
        capabilitiesJson: existing.capabilitiesJson || null,
        capabilityStatus: existing.capabilityStatus || null,
        lastRegisteredAt: existing.externalUpdatedAt,
        now,
      })
    })
  } else {
    await engineRepo.update({ id: engineId }, updates)
  }
  if (req.body.externalId !== undefined || req.body.labels !== undefined) {
    await refreshEngineSetMaterializationsForEngine(engineId, existing.tenantId)
    await refreshRuntimeResourceSetMaterializationsForEngine(engineId, existing.tenantId)
    scheduleRuntimeInventoryReconciliation(engineId, existing.tenantId, {
      runtimeAccessScope: updates.runtimeAccessScope ?? existing.runtimeAccessScope,
      metadataDiscoveryEnabled: updates.metadataDiscoveryEnabled ?? existing.metadataDiscoveryEnabled,
      deploymentDiscoveryEnabled: updates.deploymentDiscoveryEnabled ?? (existing.deploymentDiscoveryEnabled !== false),
    })
  }
  if (req.body.runtimeAccessScope === 'resource_aware' && existing.runtimeAccessScope !== 'resource_aware') {
    scheduleRuntimeInventoryReconciliation(engineId, existing.tenantId, {
      runtimeAccessScope: updates.runtimeAccessScope ?? existing.runtimeAccessScope,
      metadataDiscoveryEnabled: updates.metadataDiscoveryEnabled ?? existing.metadataDiscoveryEnabled,
      deploymentDiscoveryEnabled: updates.deploymentDiscoveryEnabled ?? (existing.deploymentDiscoveryEnabled !== false),
    })
  }
  const updated = await engineRepo.findOneBy({ id: engineId })
  if (!updated) throw Errors.notFound('Engine')
  const responseEngine = withEngineCapabilities(serializeEngine(updated))
  res.json((await canViewEngineSecrets(req, engineId)) ? responseEngine : redactEngineSecrets(responseEngine))
}))

r.delete('/engines-api/engines/:id', engineLimiter, requireAuth, requireAction('engine.inventory.delete', { resourceResolver: 'engine.byId', resourceIdFrom: 'params', resourceIdKey: 'id' }), asyncHandler(async (req: Request, res: Response) => {
  const dataSource = await getDataSource()
  const engineId = String(req.params.id)
  if ((await getEngineOnboardingMode()) === 'external_only') {
    throw Errors.forbidden('Manual engine deletion is disabled by the current onboarding policy')
  }
  await dataSource.transaction(async (manager) => {
    const engineRepo = manager.getRepository(Engine)
    const engineClaim = await engineRepo.update({ id: engineId }, { id: engineId })
    if (engineClaim.affected !== 1) throw Errors.notFound('Engine')
    const existing = await engineRepo.findOne({ where: { id: engineId } })
    if (!existing) throw Errors.notFound('Engine')
    if (existing.registrationSource === 'external_api') {
      throw Errors.conflict('Externally registered engines cannot be deleted through manual engine deletion; decommission them from Access Control or the owning external system')
    }
    if (existing.lifecycleStatus === 'decommissioned') {
      throw Errors.conflict('Decommissioned engines cannot be deleted through manual engine deletion; reactivate or manage them through the external registration lifecycle')
    }
    await engineService.assertBackstopRetirementComplete(engineId, manager)
    if (await engineService.hasBackstopHistory(engineId, manager)) {
      throw Errors.conflict('Engines with mirrored-backstop history cannot be physically deleted; retire any native grants, then decommission the engine so ownership evidence remains linked')
    }

    const runtimeResourceRepo = manager.getRepository(RuntimeResource)
    const runtimeResourceSetRepo = manager.getRepository(RuntimeResourceSet)
    const runtimeMaterializationRepo = manager.getRepository(RuntimeResourceSetMaterialization)
    const assignmentRepo = manager.getRepository(RbacRoleAssignment)
    const runtimeResources = await runtimeResourceRepo.find({ where: { engineId }, select: ['id'] })
    const runtimeResourceSets = await runtimeResourceSetRepo.find({ where: { engineId }, select: ['id'] })
    const runtimeResourceIds = runtimeResources.map((resource) => resource.id)
    const runtimeResourceSetIds = runtimeResourceSets.map((resourceSet) => resourceSet.id)
    if (runtimeResourceIds.length > 0) {
      await runtimeMaterializationRepo.delete({ runtimeResourceId: In(runtimeResourceIds) })
      await assignmentRepo.delete({ scopeType: 'engine_runtime_resource', scopeId: In(runtimeResourceIds) })
    }
    if (runtimeResourceSetIds.length > 0) {
      await runtimeMaterializationRepo.delete({ runtimeResourceSetId: In(runtimeResourceSetIds) })
      await assignmentRepo.delete({ scopeType: 'engine_runtime_resource_set', scopeId: In(runtimeResourceSetIds) })
    }
    await manager.getRepository(ProjectEngineTarget).delete({ engineId })
    await runtimeResourceRepo.delete({ engineId })
    await runtimeResourceSetRepo.delete({ engineId })
    await manager.getRepository(EngineTenantMapping).delete({ engineId })
    await manager.getRepository(ExternalEngineRegistration).delete({ engineId })
    await manager.getRepository(EngineSetMaterialization).delete({ engineId })
    await manager.getRepository(EngineBackstopGroupMapping).delete({ engineId })
    await manager.getRepository(EngineHealth).delete({ engineId })
    await manager.getRepository(EngineMember).delete({ engineId })
    await assignmentRepo.delete({ scopeType: 'engine', scopeId: engineId })
    await engineRepo.delete({ id: engineId })
  })
  res.status(204).end()
}))

// Test connection and record health
r.post('/engines-api/engines/:id/test', engineLimiter, requireAuth, requireAction('engine.inventory.update', { resourceResolver: 'engine.byId', resourceIdFrom: 'params', resourceIdKey: 'id' }), asyncHandler(async (req: Request, res: Response) => {
  const dataSource = await getDataSource()
  const engineRepo = dataSource.getRepository(Engine)
  const engineId = String(req.params.id)
  const eng = await engineRepo.findOneBy({ id: engineId })
  if (!eng) throw Errors.notFound('Engine')
  if (eng.lifecycleStatus === 'decommissioned') {
    throw Errors.validation('Cannot test a decommissioned engine; reactivate it from Access Control before testing the connection')
  }
  if (eng.lifecycleStatus === 'disabled') {
    throw Errors.validation('Cannot test a disabled engine; reactivate it from Access Control before testing the connection')
  }

  return res.json(EngineConnectionHealthResponseSchema.parse(await testEngineConnectionAndRecord(dataSource, eng)))
}))

// Get last health entry
r.get('/engines-api/engines/:id/health', engineLimiter, requireAuth, requireEngineInventoryReadOrEnvHealth, asyncHandler(async (req: Request, res: Response) => {
  const dataSource = await getDataSource()
  const engineRepo = dataSource.getRepository(Engine)
  const healthRepo = dataSource.getRepository(EngineHealth)
  // Authorization is enforced before this handler, except __env__ which is authenticated environment health.
  const engineId = String(req.params.id)
  if (engineId === '__env__') {
    const baseUrl = process.env.CAMUNDA_BASE_URL || 'http://localhost:8080/engine-rest'
    const started = Date.now()
    try {
      const { response: r } = await fetchBpmnEngineEndpoint(
        { baseUrl, connectionMode: 'direct', authType: 'none' },
        { engineId: '__env__', method: 'GET', path: '/version', retry: 'never' },
        { headers: { 'Content-Type': 'application/json' } },
      )
      const latencyMs = Date.now() - started
      if (r.ok) {
        let version: string | null = null
        try {
          const data: any = await r.json()
          version = typeof data?.version === 'string'
            && data.version.length <= 255
            && !/[\r\n\0]/.test(data.version)
            ? data.version.trim() || null
            : null
        } catch {}
        return res.json(EngineConnectionHealthResponseSchema.parse({ id: 'env-health', engineId: '__env__', status: 'connected', latencyMs, message: null, checkedAt: Date.now(), version }))
      } else {
        return res.json(EngineConnectionHealthResponseSchema.parse({ id: 'env-health', engineId: '__env__', status: 'disconnected', latencyMs, message: `Engine endpoint returned HTTP ${r.status}`, checkedAt: Date.now(), version: null }))
      }
    } catch (e: any) {
      const latencyMs = Date.now() - started
      return res.json(EngineConnectionHealthResponseSchema.parse({ id: 'env-health', engineId: '__env__', status: 'disconnected', latencyMs, message: 'Engine health check failed', checkedAt: Date.now(), version: null }))
    }
  }
  // Select all then sort in memory
  const rows = await healthRepo.find({ where: { engineId } })
  if (rows.length === 0) {
    // Auto-ping once if no health yet
    const eng = await engineRepo.findOneBy({ id: engineId })
    if (eng) {
      return res.json(EngineConnectionHealthResponseSchema.parse(await testEngineConnectionAndRecord(dataSource, eng)))
    }
  }
  const last = rows.sort((a: any, b: any) => (b.checkedAt as number) - (a.checkedAt as number))[0]
  res.json(EngineConnectionHealthResponseSchema.nullable().parse(last || null))
}))

r.get('/engines-api/saved-filters', apiLimiter, requireAuth, requireAction('engine.saved-filters.read', { resourceResolver: 'engine.visibleCollection' }), asyncHandler(async (req: Request, res: Response) => {
  const dataSource = await getDataSource()
  const filterRepo = dataSource.getRepository(SavedFilter)
  const engineIds = (req as RequestWithAuthorizedEngineIds).authorizedEngineIds || []
  if (engineIds.length === 0) {
    return res.json([])
  }
  const rows = await filterRepo.find({ where: { engineId: In(engineIds) } })

  res.json(rows.map((row) => serializeSavedFilter(row)))
}))

r.post('/engines-api/saved-filters', apiLimiter, requireAuth, validateBody(createSavedFilterBodySchema), requireAction('engine.saved-filters.manage', { resourceResolver: 'engine.byId', resourceIdFrom: 'body', resourceIdKey: 'engineId' }), asyncHandler(async (req: Request, res: Response) => {
  const dataSource = await getDataSource()
  const filterRepo = dataSource.getRepository(SavedFilter)
  const now = Date.now()
  const id = generateId()
  const { engineId, name, defKeys, version, active, incidents, completed, canceled } = req.body

  const payload = {
    id,
    name,
    engineId,
    defKeys: JSON.stringify(defKeys),
    version: version ?? null,
    active,
    incidents,
    completed,
    canceled,
    createdAt: now,
  }
  await filterRepo.insert(payload)
  res.status(201).json(serializeSavedFilter(payload))
}))

r.get('/engines-api/saved-filters/:id', apiLimiter, requireAuth, requireAction('engine.saved-filters.read', { resourceResolver: 'engine.bySavedFilterId', resourceIdFrom: 'params', resourceIdKey: 'id' }), asyncHandler(async (req: Request, res: Response) => {
  const dataSource = await getDataSource()
  const filterRepo = dataSource.getRepository(SavedFilter)
  const filterId = String(req.params.id)
  const filter = await filterRepo.findOneBy({ id: filterId })
  if (!filter) throw Errors.notFound('Saved filter')

  res.json(serializeSavedFilter(filter))
}))

r.put('/engines-api/saved-filters/:id', apiLimiter, requireAuth, validateParams(engineIdParamSchema), requireAction('engine.saved-filters.manage', { resourceResolver: 'engine.bySavedFilterId', resourceIdFrom: 'params', resourceIdKey: 'id' }), validateBody(updateSavedFilterBodySchema), asyncHandler(async (req: Request, res: Response) => {
  const dataSource = await getDataSource()
  const filterRepo = dataSource.getRepository(SavedFilter)
  const filterId = String(req.params.id)
  const existing = await filterRepo.findOneBy({ id: filterId })
  if (!existing) throw Errors.notFound('Saved filter')

  const newEngineId = req.body.engineId || null
  if (newEngineId && !(await canViewEngine(req, newEngineId))) throw Errors.forbidden()

  const updates: any = {
    name: req.body.name,
    engineId: newEngineId || undefined,
    defKeys: req.body.defKeys ? JSON.stringify(req.body.defKeys) : undefined,
    version: req.body.version,
    active: req.body.active,
    incidents: req.body.incidents,
    completed: req.body.completed,
    canceled: req.body.canceled,
  }
  await filterRepo.update({ id: filterId }, updates)
  const updated = await filterRepo.findOneBy({ id: filterId })
  if (!updated) throw Errors.notFound('Saved filter')
  res.json(serializeSavedFilter(updated))
}))

r.delete('/engines-api/saved-filters/:id', apiLimiter, requireAuth, requireAction('engine.saved-filters.manage', { resourceResolver: 'engine.bySavedFilterId', resourceIdFrom: 'params', resourceIdKey: 'id' }), asyncHandler(async (req: Request, res: Response) => {
  const dataSource = await getDataSource()
  const filterRepo = dataSource.getRepository(SavedFilter)
  const filterId = String(req.params.id)
  const existing = await filterRepo.findOneBy({ id: filterId })
  if (!existing) throw Errors.notFound('Saved filter')
  await filterRepo.delete({ id: filterId })
  res.status(204).end()
}))

export default r
