import { Router, Request, Response, type NextFunction } from 'express'
import { existsSync } from 'fs'
import { generateId } from '@enterpriseglue/shared/utils/id.js'
import { z } from 'zod'
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js'
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js'
import { EngineTenantMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineTenantMapping.js'
import { EngineSetMaterialization } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineSetMaterialization.js'
import { RbacRoleAssignment } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRoleAssignment.js'
import { RuntimeResource } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResource.js'
import { RuntimeResourceSet } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResourceSet.js'
import { ExternalEngineRegistration } from '@enterpriseglue/shared/infrastructure/persistence/entities/ExternalEngineRegistration.js'
import { ExternalEngineSystem } from '@enterpriseglue/shared/infrastructure/persistence/entities/ExternalEngineSystem.js'
import { SavedFilter } from '@enterpriseglue/shared/infrastructure/persistence/entities/SavedFilter.js'
import { EngineHealth } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineHealth.js'
import { In, Not, IsNull, type DataSource } from 'typeorm'
import { fetch } from 'undici'
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
import { EnginePermissions, ExternalEngineSystemPermissions, permissionService } from '@enterpriseglue/shared/services/platform-admin/permissions.js'
import { ENGINE_OPERATION_CAPABILITIES, getEngineCapabilities, withEngineCapabilities } from '@enterpriseglue/shared/services/bpmn-engine-capabilities.js'
import { describeBpmnEngineTransport, fetchBpmnEngineEndpoint, resolveBpmnEngineRequestUrl, validateBpmnEngineEndpointUrl } from '@enterpriseglue/shared/services/bpmn-engine-client.js'
import { secretResolver } from '@enterpriseglue/shared/services/platform-admin/SecretResolver.js'
import { config } from '@enterpriseglue/shared/config/index.js'
import { logAudit } from '@enterpriseglue/shared/services/audit.js'
import { logger } from '@enterpriseglue/shared/utils/logger.js'
import {
  AccessibleEngineSummarySchema,
  CreateEngineRequestSchema,
  EngineConnectionHealthResponseSchema,
  EngineTenancyClassificationReportSchema,
  EngineTenancyTransitionApplyRequestSchema,
  EngineTenancyTransitionApplyResponseSchema,
  EngineTenancyTransitionPreviewRequestSchema,
  EngineTenancyTransitionPreviewResponseSchema,
  EndpointAuthenticationPolicyMessages,
  EngineRuntimeQueryCapabilitiesSchema,
  EngineTenantMappingSchema,
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
import { ProjectEngineTargetSchema, RuntimeResourceSchema } from '@enterpriseglue/shared/schemas/platform-admin/authz.js'

type RequestWithAuthorizedEngineIds = Request & { authorizedEngineIds?: string[] }

// Validation schemas
const engineIdParamSchema = z.object({ id: z.string().min(1) })
const externalEngineIdParamSchema = z.object({ externalId: z.string().min(1).max(255) })
const runtimeResourceInventoryQuerySchema = z.object({
  resourceKind: z.enum(['process_definition', 'decision_definition']).optional(),
  includeInactive: z.enum(['true', 'false']).optional(),
})
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
  (url) => config.nodeEnv !== 'production' || url.startsWith('https://') || isLocalOrPrivate(url),
  { message: 'Engine base URL must use HTTPS in production (HTTP allowed for localhost/private networks)' }
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

const EXTERNAL_TENANCY_COMPATIBILITY_WARNING = 'ENGINE_TENANCY_DEFAULTED_TO_DEDICATED'

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

const decommissionExternalEngineBodySchema = z.object({
  externalId: z.string().min(1).max(255),
  externalSystemId: z.string().min(1).nullable().optional(),
  reason: z.string().max(2000).nullable().optional(),
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
  diagnostics: z.record(z.string(), z.unknown()).nullable().optional(),
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

function requireEngineInventoryReadOrEnvHealth(req: Request, res: Response, next: NextFunction) {
  if (String(req.params.id) === '__env__') return next()
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
  const managementMode = engine.managementMode || (registrationSource === 'external_api' ? 'external_managed' : 'manual')
  if (managementMode === 'manual' && registrationSource !== 'external_api') return []

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
  dataSource: DataSource,
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
  let engine: Engine | null = null
  let registeredSystemId: string | null = null

  if (input.engineId) {
    engine = await engineRepo.findOneBy({ id: input.engineId })
    registeredSystemId = engine?.externalSystemId || null
  } else if (input.externalEngineId) {
    const registration = await dataSource.getRepository(ExternalEngineRegistration).findOne({
      where: { externalId: input.externalEngineId },
    })
    registeredSystemId = registration?.externalSystemId || null
    engine = registration
      ? await engineRepo.findOneBy({ id: registration.engineId })
      : await engineRepo.findOne({ where: { externalId: input.externalEngineId } })
    registeredSystemId = registeredSystemId || engine?.externalSystemId || null
  }

  if (!engine) throw Errors.notFound('Engine')
  if (tenantId && engine.tenantId && engine.tenantId !== tenantId) {
    throw Errors.notFound('Engine')
  }
  if (registeredSystemId !== input.externalSystemId) {
    throw Errors.validation('External engine system does not match the registered engine')
  }
  if (engine.lifecycleStatus === 'decommissioned') {
    throw Errors.validation('Cannot register deployment targets for a decommissioned engine')
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

async function syncExternalEngineRegistration(
  dataSource: DataSource,
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

  const existingForEngine = await registrationRepo.findOne({ where: { engineId: input.engineId } })
  const existingForExternalId = await registrationRepo.findOne({ where: { externalId: input.externalId } })
  if (existingForExternalId && existingForExternalId.engineId !== input.engineId) {
    throw Errors.conflict('An engine with this externalId already exists')
  }

  const payload = {
    engineId: input.engineId,
    externalId: input.externalId,
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
async function assertEngineCanUseEngineWideAccess(dataSource: DataSource, engineId: string): Promise<void> {
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
        version = data?.version || null
      } catch {
        version = null
      }
      await engineRepo.update({ id: eng.id }, { version: version || null, updatedAt: Date.now() })
      const rec = { id: generateId(), engineId: eng.id, status, latencyMs, message: null, checkedAt: Date.now() }
      await healthRepo.insert(rec)
      return { ...rec, version, transport: diagnostics }
    }

    status = 'disconnected'
    message = `${response.status} ${response.statusText}`
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

r.get('/engines-api/engines', engineLimiter, requireAuth, requireAction('engine.inventory.read', { resourceResolver: 'engine.visibleCollection' }), asyncHandler(async (req: Request, res: Response) => {
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
  await engineService.createEngineWithGovernanceAssignments(payload, dataSource)
  if (externalId) {
    await syncExternalEngineRegistration(dataSource, {
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
  const engineRepo = dataSource.getRepository(Engine)
  const settings = await platformSettingsService.get()
  const authType = req.body.authType || 'basic'
  assertEndpointAuthenticationPolicy(req.body.connectionMode, authType, settings.credentiallessCustomerSidecarsEnabled ?? false)
  assertEngineEndpointPolicy(req.body.baseUrl, req.body.oauthTokenUrl)
  const now = Date.now()
  const dockerLoopbackError = getDockerLoopbackEngineError(req.body.baseUrl)
  if (dockerLoopbackError) {
    return res.status(400).json({ error: dockerLoopbackError, field: 'baseUrl' })
  }

  const requestTenantId = req.tenant?.tenantId || null
  const externalId = req.body.externalId.trim()
  const externalSystem = await resolveExternalEngineSystem(dataSource, req.body.externalSystemId ?? null, requestTenantId)
  const externalSystemManagementMode = engineManagementModeSchema.safeParse(externalSystem?.defaultManagementMode).success
    ? externalSystem?.defaultManagementMode
    : undefined
  const managementMode = req.body.managementMode || externalSystemManagementMode || 'external_managed'
  const fieldOwnership = mergeFieldOwnership(req.body.fieldOwnership || parseEngineFieldOwnership(externalSystem?.defaultFieldOwnershipJson))
  const fieldOwnershipJson = fieldOwnershipToJson(fieldOwnership)
  const lifecycleStatus: EngineLifecycleStatus = req.body.lifecycleStatus || 'active'
  const reportedCapabilities = normalizeExternalEngineCapabilities(req.body.capabilities)
  const capabilitiesJson = capabilitiesToJson(reportedCapabilities)
  const capabilityStatus = getCapabilityStatus(req.body.type, reportedCapabilities)
  const existing = await engineRepo.findOne({ where: { externalId } })
  const resolvedTenancy = existing
    ? await engineTenancyProvisioningService.validateUpdate(existing, {
      tenancy: req.body.tenancy,
      runtimeAccessScope: req.body.runtimeAccessScope || existing.runtimeAccessScope || 'engine_wide',
      requestTenantId,
      principalType: 'api_client',
      principalId: req.apiClient?.id || null,
      resolver: engineTenantReferenceResolver(req),
    }, { compatibilityOmissionMeansDedicated: true })
    : await engineTenancyProvisioningService.resolveForCreate({
      tenancy: req.body.tenancy,
      runtimeAccessScope: req.body.runtimeAccessScope || 'engine_wide',
      requestTenantId,
      principalType: 'api_client',
      principalId: req.apiClient?.id || null,
      resolver: engineTenantReferenceResolver(req),
    })
  if (!resolvedTenancy) {
    throw Errors.internal('External engine tenancy resolution returned no decision')
  }
  const tenancyWarnings = req.body.tenancy === undefined
    ? [EXTERNAL_TENANCY_COMPATIBILITY_WARNING]
    : []
  if (existing && req.body.runtimeAccessScope === 'engine_wide' && existing.runtimeAccessScope === 'resource_aware') {
    await assertEngineCanUseEngineWideAccess(dataSource, String(existing.id))
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
      tenancyMode: resolvedTenancy?.tenancyMode,
      tenantId: resolvedTenancy?.tenantId,
      tenantMappingStrategy: resolvedTenancy?.tenantMappingStrategy,
      tenantMappingVersion: resolvedTenancy?.tenantMappingVersion,
      tenantResolutionStatus: resolvedTenancy?.tenantResolutionStatus,
      updatedAt: now,
    }
    await engineRepo.update({ id: existing.id }, updatePayload)
    await syncExternalEngineRegistration(dataSource, {
      engineId: String(existing.id),
      externalId,
      labelsJson: (updatePayload.labelsJson as string | null | undefined) ?? existing.labelsJson,
      registrationSource: 'external_api',
      apiClientId: req.apiClient?.id || null,
      externalSystemId: payload.externalSystemId,
      managementMode: payload.managementMode,
      fieldOwnershipJson: payload.fieldOwnershipJson,
      driftStatus: ownedUpdate.driftStatus,
      lifecycleStatus,
      lastExternalSyncAt: now,
      capabilitiesJson: nextCapabilitiesJson,
      capabilityStatus: nextCapabilityStatus,
      lastRegisteredAt: now,
      now,
    })
    const effectiveTenantId = resolvedTenancy?.tenantId ?? existing.tenantId
    await refreshEngineSetMaterializationsForEngine(String(existing.id), effectiveTenantId)
    await refreshRuntimeResourceSetMaterializationsForEngine(String(existing.id), effectiveTenantId)
    scheduleRuntimeInventoryReconciliation(String(existing.id), effectiveTenantId, {
      runtimeAccessScope: (updatePayload.runtimeAccessScope as string | undefined) ?? existing.runtimeAccessScope,
      metadataDiscoveryEnabled: (updatePayload.metadataDiscoveryEnabled as boolean | undefined) ?? existing.metadataDiscoveryEnabled,
      deploymentDiscoveryEnabled: (updatePayload.deploymentDiscoveryEnabled as boolean | undefined) ?? (existing.deploymentDiscoveryEnabled !== false),
    })
    const updated = await engineRepo.findOneBy({ id: existing.id })
    if (!updated) throw Errors.notFound('Engine')
    const health = req.body.testConnection ? await testEngineConnectionAndRecord(dataSource, updated) : null
    await logAudit({
      tenantId: effectiveTenantId || undefined,
      userId: req.apiClient?.createdById || undefined,
      action: 'engine.external_registration.update',
      resourceType: 'engine',
      resourceId: existing.id,
      details: {
        apiClientId: req.apiClient?.id,
        externalSystemId: payload.externalSystemId,
        managementMode,
        fieldOwnership,
        driftStatus: ownedUpdate.driftStatus,
        lifecycleStatus,
        capabilityStatus: nextCapabilityStatus,
        capabilities: req.body.capabilities === undefined ? parseExternalEngineCapabilities(existing.capabilitiesJson) : reportedCapabilities,
        externalId,
        labels: normalizeEngineLabels(req.body.labels),
        tenancy: {
          mode: resolvedTenancy?.tenancyMode,
          tenantId: resolvedTenancy?.tenantId,
          mappingStrategy: resolvedTenancy?.tenantMappingStrategy,
          warnings: tenancyWarnings,
        },
        connectionTest: health ? { status: health.status, latencyMs: health.latencyMs, version: health.version ?? null } : undefined,
      },
    })
    const responseEngine = health?.version ? { ...updated, version: health.version } : updated
    return res.status(200).json({
      created: false,
      engine: withEngineCapabilities(serializeEngine(responseEngine)),
      health,
      diagnostics: { tenancyWarnings },
    })
  }

  const id = generateId()
  const created = {
    id,
    ...payload,
    ownerId: req.apiClient?.createdById || null,
    delegateId: null,
    environmentLocked: false,
    tenantId: resolvedTenancy.tenantId,
    tenancyMode: resolvedTenancy.tenancyMode,
    tenantMappingStrategy: resolvedTenancy.tenantMappingStrategy,
    tenantMappingVersion: resolvedTenancy.tenantMappingVersion,
    tenantResolutionStatus: resolvedTenancy.tenantResolutionStatus,
    lastTenantReconciledAt: null,
    createdAt: now,
  }
  await engineService.createEngineWithGovernanceAssignments(created, dataSource)
  await syncExternalEngineRegistration(dataSource, {
    engineId: id,
    externalId,
    labelsJson: payload.labelsJson,
    registrationSource: 'external_api',
    apiClientId: req.apiClient?.id || null,
    externalSystemId: payload.externalSystemId,
    managementMode: payload.managementMode,
    fieldOwnershipJson: payload.fieldOwnershipJson,
    driftStatus: payload.driftStatus,
    lifecycleStatus: payload.lifecycleStatus,
    lastExternalSyncAt: payload.lastExternalSyncAt,
    capabilitiesJson: payload.capabilitiesJson,
    capabilityStatus: payload.capabilityStatus,
    lastRegisteredAt: now,
    now,
  })
  await refreshEngineSetMaterializationsForEngine(id, resolvedTenancy.tenantId)
  await refreshRuntimeResourceSetMaterializationsForEngine(id, resolvedTenancy.tenantId)
  scheduleRuntimeInventoryReconciliation(id, resolvedTenancy.tenantId, {
    runtimeAccessScope: payload.runtimeAccessScope || 'engine_wide',
    metadataDiscoveryEnabled: payload.metadataDiscoveryEnabled,
    deploymentDiscoveryEnabled: payload.deploymentDiscoveryEnabled !== false,
  })
  const health = req.body.testConnection ? await testEngineConnectionAndRecord(dataSource, created) : null
  await logAudit({
    tenantId: resolvedTenancy.tenantId || undefined,
    userId: req.apiClient?.createdById || undefined,
    action: 'engine.external_registration.create',
    resourceType: 'engine',
    resourceId: id,
    details: {
      apiClientId: req.apiClient?.id,
      externalSystemId: payload.externalSystemId,
      managementMode,
      fieldOwnership,
      driftStatus: payload.driftStatus,
      lifecycleStatus,
      capabilityStatus,
      capabilities: reportedCapabilities,
      externalId,
      labels: normalizeEngineLabels(req.body.labels),
      tenancy: {
        mode: resolvedTenancy.tenancyMode,
        tenantId: resolvedTenancy.tenantId,
        mappingStrategy: resolvedTenancy.tenantMappingStrategy,
        warnings: tenancyWarnings,
      },
      connectionTest: health ? { status: health.status, latencyMs: health.latencyMs, version: health.version ?? null } : undefined,
    },
  })
  const responseEngine = health?.version ? { ...created, version: health.version } : created
  return res.status(201).json({
    created: true,
    engine: withEngineCapabilities(serializeEngine(responseEngine)),
    health,
    diagnostics: { tenancyWarnings },
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
  const engine = await dataSource.getRepository(Engine).findOne({ where: { externalId } })
  if (!engine) throw Errors.notFound('Engine')
  if (req.body.externalSystemId && engine.externalSystemId !== req.body.externalSystemId) {
    throw Errors.notFound('Engine')
  }
  const { externalSystemId: _externalSystemId, ...mappingRequest } = req.body
  const result = await engineTenantMappingService.upsert({
    engineId: String(engine.id),
    request: mappingRequest,
    requestTenantId: req.tenant?.tenantId || null,
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
}), validateBody(decommissionExternalEngineBodySchema), asyncHandler(async (req: Request, res: Response) => {
  const dataSource = await getDataSource()
  const engineRepo = dataSource.getRepository(Engine)
  const registrationRepo = dataSource.getRepository(ExternalEngineRegistration)
  const now = Date.now()
  const externalId = req.body.externalId.trim()
  const tenantId = req.tenant?.tenantId || null

  const registration = await registrationRepo.findOne({ where: { externalId } })
  const engine = registration
    ? await engineRepo.findOneBy({ id: registration.engineId })
    : await engineRepo.findOne({ where: { externalId } })
  if (!engine) throw Errors.notFound('Engine')
  if (engine.registrationSource !== 'external_api') {
    throw Errors.validation('Only externally registered engines can be decommissioned through the external registration API')
  }
  const requestedSystemId = req.body.externalSystemId?.trim() || null
  const registeredSystemId = engine.externalSystemId || registration?.externalSystemId || null
  if (requestedSystemId && registeredSystemId !== requestedSystemId) {
    throw Errors.validation('External engine system does not match the registered engine')
  }

  const lifecycleStatus = 'decommissioned'
  const updates = {
    lifecycleStatus,
    driftStatus: 'decommissioned',
    externalUpdatedAt: now,
    lastExternalSyncAt: now,
    updatedAt: now,
  }
  await engineRepo.update({ id: engine.id }, updates)
  if (registration) {
    await registrationRepo.update({ id: registration.id }, {
      apiClientId: req.apiClient?.id || registration.apiClientId,
      lifecycleStatus,
      driftStatus: 'decommissioned',
      lastExternalSyncAt: now,
      lastRegisteredAt: now,
      updatedAt: now,
    })
  }
  await dataSource.getRepository(EngineSetMaterialization).delete({ engineId: engine.id })
  await logAudit({
    tenantId: tenantId || undefined,
    userId: req.apiClient?.createdById || undefined,
    action: 'engine.external_registration.decommission',
    resourceType: 'engine',
    resourceId: engine.id,
    details: {
      apiClientId: req.apiClient?.id,
      externalId,
      externalSystemId: registeredSystemId,
      reason: req.body.reason || null,
    },
  })

  res.json({
    decommissioned: true,
    engineId: engine.id,
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
  const tenantId = req.tenant?.tenantId || null
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
  const tenantId = req.tenant?.tenantId || null
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

r.post('/engines-api/engines/:id/tenancy/preview', engineLimiter, requireAuth, engineRegistrationLimiter, validateParams(engineIdParamSchema), requireAction('engine.inventory.update', { resourceResolver: 'engine.byId', resourceIdFrom: 'params', resourceIdKey: 'id', acceptedPermissions: [EnginePermissions.ENGINE_EDIT] }), engineRegistrationJsonPayloadLimit, validateBody(EngineTenancyTransitionPreviewRequestSchema), asyncHandler(async (req: Request, res: Response) => {
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

r.post('/engines-api/engines/:id/tenancy/apply', engineLimiter, requireAuth, engineRegistrationLimiter, validateParams(engineIdParamSchema), requireAction('engine.inventory.update', { resourceResolver: 'engine.byId', resourceIdFrom: 'params', resourceIdKey: 'id', acceptedPermissions: [EnginePermissions.ENGINE_EDIT] }), engineRegistrationJsonPayloadLimit, validateBody(EngineTenancyTransitionApplyRequestSchema), asyncHandler(async (req: Request, res: Response) => {
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
  if (result.transition.proposed.mode === 'dedicated') {
    await refreshEngineSetMaterializationsForEngine(engineId, result.transition.proposed.tenantId)
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
  await engineRepo.update({ id: engineId }, updates)
  if (req.body.externalId !== undefined || req.body.labels !== undefined) {
    const nextExternalId = updates.externalId === undefined ? existing.externalId : updates.externalId
    const nextLabelsJson = updates.labelsJson === undefined ? existing.labelsJson : updates.labelsJson
    await syncExternalEngineRegistration(dataSource, {
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
  res.json(withEngineCapabilities(serializeEngine(updated)))
}))

r.delete('/engines-api/engines/:id', engineLimiter, requireAuth, requireAction('engine.inventory.delete', { resourceResolver: 'engine.byId', resourceIdFrom: 'params', resourceIdKey: 'id' }), asyncHandler(async (req: Request, res: Response) => {
  const dataSource = await getDataSource()
  const engineRepo = dataSource.getRepository(Engine)
  const engineId = String(req.params.id)
  const existing = await engineRepo.findOneBy({ id: engineId })
  if (!existing) throw Errors.notFound('Engine')
  if ((await getEngineOnboardingMode()) === 'external_only') {
    throw Errors.forbidden('Manual engine deletion is disabled by the current onboarding policy')
  }
  if (existing.registrationSource === 'external_api') {
    throw Errors.conflict('Externally registered engines cannot be deleted through manual engine deletion; decommission them from Access Control or the owning external system')
  }
  if (existing.lifecycleStatus === 'decommissioned') {
    throw Errors.conflict('Decommissioned engines cannot be deleted through manual engine deletion; reactivate or manage them through the external registration lifecycle')
  }
  await dataSource.getRepository(ExternalEngineRegistration).delete({ engineId })
  await dataSource.getRepository(EngineSetMaterialization).delete({ engineId })
  await engineRepo.delete({ id: engineId })
  await dataSource.getRepository(RbacRoleAssignment).delete({
    scopeType: 'engine',
    scopeId: engineId,
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
      const r = await fetch(resolveBpmnEngineRequestUrl(baseUrl, '/version'), { headers: { 'Content-Type': 'application/json' } })
      const latencyMs = Date.now() - started
      if (r.ok) {
        let version: string | null = null
        try { const data: any = await r.json(); version = data?.version || null } catch {}
        return res.json(EngineConnectionHealthResponseSchema.parse({ id: 'env-health', engineId: '__env__', status: 'connected', latencyMs, message: null, checkedAt: Date.now(), version }))
      } else {
        return res.json(EngineConnectionHealthResponseSchema.parse({ id: 'env-health', engineId: '__env__', status: 'disconnected', latencyMs, message: `${r.status} ${r.statusText}`, checkedAt: Date.now(), version: null }))
      }
    } catch (e: any) {
      const latencyMs = Date.now() - started
      return res.json(EngineConnectionHealthResponseSchema.parse({ id: 'env-health', engineId: '__env__', status: 'disconnected', latencyMs, message: e?.message || 'Failed to connect', checkedAt: Date.now(), version: null }))
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
