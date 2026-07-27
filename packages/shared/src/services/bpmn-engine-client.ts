import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { fetch, Response } from 'undici'
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js'
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js'
import { AppError, Errors } from '@enterpriseglue/shared/interfaces/middleware/errorHandler.js'
import { secretResolver } from './platform-admin/SecretResolver.js'
import { getBpmnEngineRequestContext } from './bpmn-engine-request-context.js'
import { logAudit } from './audit.js'
import type {
  Batch,
  BatchStatistics,
  ProcessInstance,
  ProcessInstanceCount,
  ActivityInstance,
  HistoricActivityInstance,
  HistoricTaskInstance,
  HistoricVariableInstance,
  HistoricDecisionInstance,
  UserOperationLogEntry,
  Deployment,
  Task,
  TaskCount,
  TaskForm,
  ExternalTask,
  Job,
  JobDefinition,
  DecisionDefinition,
  DecisionDefinitionXml,
  DecisionResult,
  Metric,
  MetricResult,
  EngineVersion,
  MigrationPlan,
  MigrationPlanValidationReport,
  DeleteProcessInstancesRequest,
  SuspendProcessInstancesRequest,
  SetJobRetriesAsyncRequest,
  GenerateMigrationPlanRequest,
  ValidateMigrationPlanRequest,
  ExecuteMigrationRequest,
  ClaimTaskRequest,
  SetAssigneeRequest,
  CompleteTaskRequest,
  FetchAndLockRequest,
  CompleteExternalTaskRequest,
  ExternalTaskFailureRequest,
  ExternalTaskBpmnErrorRequest,
  ExtendLockRequest,
  SetRetriesRequest,
  SetJobRetriesRequest,
  SetSuspensionStateRequest,
  SetDuedateRequest,
  EvaluateDecisionRequest,
  CorrelateMessageRequest,
  MessageCorrelationResult,
  DeliverSignalRequest,
  ModifyProcessInstanceRequest,
  RestartProcessInstanceRequest,
  CamundaVariables,
} from '@enterpriseglue/shared/types/bpmn-engine-api.js'

type EngineAuthType = 'none' | 'basic' | 'bearer' | 'oauth2-client-credentials'

type EngineCfg = {
  id: string;
  baseUrl: string;
  connectionMode: 'direct' | 'customer_sidecar';
  authType: EngineAuthType;
  username?: string | null;
  passwordEnc?: string | null;
  oauthTokenUrl?: string | null;
  oauthScopes?: string | null;
  oauthAudience?: string | null;
}

export type EngineCredentialInput = {
  authType?: string | null;
  username?: string | null;
  passwordEnc?: string | null;
};

export type EngineConnectionInput = EngineCredentialInput & {
  id?: string | null;
  baseUrl: string;
  connectionMode?: string | null;
  oauthTokenUrl?: string | null;
  oauthScopes?: string | null;
  oauthAudience?: string | null;
};

export type EngineTransportDiagnostics = {
  connectionMode: 'direct' | 'customer_sidecar';
  upstreamHop: 'enterpriseglue_to_engine' | 'enterpriseglue_to_sidecar';
  endpointAuthentication: EngineAuthType;
  downstreamAuthentication: 'not_applicable' | 'customer_managed';
  attempts?: number;
  timeoutMs?: number;
};

export type ResolvedBpmnEngineConnection = {
  url: string;
  headers: Record<string, string>;
  diagnostics: EngineTransportDiagnostics;
};

export type BpmnEngineRequestOptions = {
  engineId?: string;
  method?: string;
  path?: string;
  contentType?: string | null;
  timeoutMs?: number;
  retry?: 'safe_read' | 'never';
};

export type BpmnEngineFetchResult = {
  response: Awaited<ReturnType<typeof fetch>>;
  diagnostics: EngineTransportDiagnostics;
};

const DEFAULT_ENGINE_REQUEST_TIMEOUT_MS = 10_000
const MAX_ENGINE_REQUEST_TIMEOUT_MS = 60_000
export const MAX_ENGINE_RESPONSE_BYTES = 5 * 1024 * 1024
const TRANSIENT_ENGINE_STATUSES = new Set([429, 502, 503, 504])

/**
 * Production engine connections are an SSRF-sensitive outbound boundary. The
 * allowlist intentionally contains host names only: ports and paths remain
 * engine-specific, while an exact host or `*.suffix` entry gives operations a
 * small, reviewable network policy. Development and test installations retain
 * their existing local-engine ergonomics unless enforcement is opted in.
 */
function isEngineEndpointPolicyEnforced(): boolean {
  if (process.env.EG_ENFORCE_ENGINE_ENDPOINT_POLICY === 'true') return true
  if (process.env.EG_ENFORCE_ENGINE_ENDPOINT_POLICY === 'false') return false
  return process.env.NODE_ENV === 'production'
}

function isInsecureEngineHttpAllowed(): boolean {
  return process.env.EG_ALLOW_INSECURE_ENGINE_HTTP === 'true'
}

function engineEndpointAllowedHosts(): string[] {
  return (process.env.EG_ENGINE_ALLOWED_HOSTS || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase().replace(/\.$/, ''))
    .filter(Boolean)
}

function isAllowedEngineEndpointHost(host: string, allowedHosts: string[]): boolean {
  const normalizedHost = host.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  return allowedHosts.some((pattern) => {
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(2)
      return suffix.length > 0 && normalizedHost.endsWith(`.${suffix}`)
    }
    return normalizedHost === pattern
  })
}

async function boundEngineResponseBody(
  response: Awaited<ReturnType<typeof fetch>>,
  input: { method: string; path: string; connectionMode: 'direct' | 'customer_sidecar' },
): Promise<Awaited<ReturnType<typeof fetch>>> {
  const declaredResponseBytes = Number(response.headers?.get?.('content-length'))
  if (Number.isSafeInteger(declaredResponseBytes) && declaredResponseBytes > MAX_ENGINE_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => undefined)
    throw new BpmnEngineResponseTooLargeError({
      ...input,
      maxResponseBytes: MAX_ENGINE_RESPONSE_BYTES,
    })
  }
  const body = response.body
  if (!body) return response
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let receivedBytes = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      receivedBytes += value.byteLength
      if (receivedBytes > MAX_ENGINE_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw new BpmnEngineResponseTooLargeError({
          ...input,
          maxResponseBytes: MAX_ENGINE_RESPONSE_BYTES,
        })
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return new Response(Buffer.concat(chunks), {
    status: response.status,
    statusText: response.statusText,
    headers: Object.fromEntries(response.headers.entries()),
  })
}

function boundedTimeoutMs(value?: number): number {
  if (!Number.isFinite(value)) return DEFAULT_ENGINE_REQUEST_TIMEOUT_MS
  return Math.max(100, Math.min(MAX_ENGINE_REQUEST_TIMEOUT_MS, Math.trunc(value!)))
}

export function describeBpmnEngineTransport(input: EngineCredentialInput & { connectionMode?: string | null }): EngineTransportDiagnostics {
  const connectionMode = input.connectionMode === 'customer_sidecar' ? 'customer_sidecar' : 'direct'
  const endpointAuthentication = (input.authType || (input.username ? 'basic' : 'none')) as EngineAuthType
  return {
    connectionMode,
    upstreamHop: connectionMode === 'customer_sidecar' ? 'enterpriseglue_to_sidecar' : 'enterpriseglue_to_engine',
    endpointAuthentication,
    downstreamAuthentication: connectionMode === 'customer_sidecar' ? 'customer_managed' : 'not_applicable',
  }
}

/** Shared credential projection for all EnterpriseGlue-to-endpoint calls. */
export function buildEngineCredentialHeaders(input: EngineCredentialInput): Record<string, string> {
  const authType = (input.authType || (input.username ? 'basic' : 'none')) as EngineAuthType;
  const password = secretResolver.resolveStored(input.passwordEnc);
  if (authType === 'basic' && input.username) {
    const token = Buffer.from(`${input.username}:${password || ''}`).toString('base64');
    return { Authorization: `Basic ${token}` };
  }
  if (authType === 'bearer' && password) {
    return { Authorization: `Bearer ${password}` };
  }
  return {};
}

type OAuthTokenCacheEntry = {
  token: string;
  expiresAt: number;
}

const oauthTokenCache = new Map<string, OAuthTokenCacheEntry>()

function isLoopbackEngineHost(raw: string): boolean {
  try {
    const host = new URL(raw).hostname
    return host === 'localhost' || host === '::1' || host === '[::1]' || /^127\./.test(host)
  } catch {
    return false
  }
}

function isDockerRuntime(): boolean {
  if (process.env.EG_RUNTIME_MODE === 'docker') return true
  if (process.env.EG_RUNTIME_MODE === 'host') return false
  return existsSync('/.dockerenv')
}

function shouldRewriteDockerLoopbackEngineUrls(): boolean {
  if (process.env.EG_REWRITE_DOCKER_LOOPBACK_ENGINE_URLS === 'true') return true
  if (process.env.EG_REWRITE_DOCKER_LOOPBACK_ENGINE_URLS === 'false') return false
  if (process.env.NODE_ENV === 'test') return false
  return isDockerRuntime()
}

export function validateBpmnEngineEndpointUrl(rawUrl: string, label = 'Engine endpoint URL'): URL {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw Errors.validation(`${label} is invalid`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw Errors.validation(`${label} must use HTTP or HTTPS`)
  }
  if (parsed.username || parsed.password) {
    throw Errors.validation(`${label} must not include embedded credentials`)
  }
  if (isEngineEndpointPolicyEnforced()) {
    if (parsed.protocol !== 'https:' && !isInsecureEngineHttpAllowed()) {
      throw Errors.validation(`${label} must use HTTPS when endpoint policy is enforced`)
    }
    const allowedHosts = engineEndpointAllowedHosts()
    if (!isAllowedEngineEndpointHost(parsed.hostname, allowedHosts)) {
      throw Errors.validation(`${label} host is not permitted by endpoint policy`)
    }
  }
  return parsed
}

export function resolveBpmnEngineRequestUrl(baseUrl: string, path = ''): string {
  if (/^[a-z][a-z\d+.-]*:/i.test(path) || path.startsWith('//')) {
    throw Errors.validation('Engine request path must be relative to the configured endpoint')
  }
  const rawUrl = baseUrl.replace(/\/$/, '') + path
  const parsed = validateBpmnEngineEndpointUrl(rawUrl, 'Engine endpoint URL')
  if (!shouldRewriteDockerLoopbackEngineUrls() || !isLoopbackEngineHost(rawUrl)) return rawUrl

  parsed.hostname = 'host.docker.internal'
  return parsed.toString()
}

async function getEngine(engineId: string): Promise<EngineCfg> {
  if (!engineId) throw Errors.validation('engineId is required')
  const dataSource = await getDataSource()
  const engineRepo = dataSource.getRepository(Engine)
  const row = await engineRepo.findOneBy({ id: engineId })
  if (!row || !row.baseUrl) throw Errors.engineNotFound(engineId)

  const engineRow = row as Engine & {
    authType?: string;
    passwordEnc?: string;
    username?: string;
    oauthTokenUrl?: string | null;
    oauthScopes?: string | null;
    oauthAudience?: string | null;
  }
  const authType = (engineRow.authType || (engineRow.username ? 'basic' : 'none')) as EngineAuthType
  return {
    id: engineId,
    baseUrl: String(row.baseUrl),
    connectionMode: row.connectionMode === 'customer_sidecar' ? 'customer_sidecar' : 'direct',
    authType,
    username: engineRow.username || null,
    passwordEnc: engineRow.passwordEnc || null,
    oauthTokenUrl: engineRow.oauthTokenUrl || null,
    oauthScopes: engineRow.oauthScopes || null,
    oauthAudience: engineRow.oauthAudience || null,
  }
}

function inferOperationClass(method: string, path: string): string {
  const normalizedMethod = method.toUpperCase()
  const normalizedPath = path.startsWith('http') ? new URL(path).pathname : path
  if (/\/authorization(?:\/|$)/.test(normalizedPath)) return 'engine.native_authorization.backstop'
  if (normalizedMethod === 'GET') return 'engine.read'
  if (normalizedPath.includes('/deployment')) return 'engine.deploy'
  if (normalizedPath.includes('/task/')) return 'engine.task.mutate'
  if (normalizedPath.includes('/job') || normalizedPath.includes('/job-definition')) return 'engine.job.mutate'
  if (normalizedPath.includes('/batch')) return 'engine.batch.admin'
  if (normalizedPath.includes('/process-instance') || normalizedPath.includes('/process-definition')) return 'engine.instance.mutate'
  return 'engine.admin'
}

/**
 * EnterpriseGlue authorization has already succeeded when this error is
 * produced. Keep the upstream response distinct from a local authorization
 * denial and avoid exposing engine URLs or response bodies to callers.
 */
export class BpmnEngineOperationError extends AppError {
  constructor(input: { method: string; path: string; status: number; connectionMode?: 'direct' | 'customer_sidecar' }) {
    super(
      'ENGINE_OPERATION_REJECTED',
      'The engine rejected the requested operation',
      502,
      {
        engineStatus: input.status,
        operationClass: inferOperationClass(input.method, input.path),
        ...(input.connectionMode === 'customer_sidecar' ? { connectionMode: input.connectionMode } : {}),
      },
    )
  }
}

/** A bounded upstream response could be read but was not valid for its declared format. */
export class BpmnEngineMalformedResponseError extends AppError {
  constructor(input: { method: string; path: string; connectionMode: 'direct' | 'customer_sidecar' }) {
    super(
      'ENGINE_MALFORMED_RESPONSE',
      'The engine returned a malformed response',
      502,
      {
        operationClass: inferOperationClass(input.method, input.path),
        connectionMode: input.connectionMode,
      },
    )
  }
}

async function resolveOAuthClientCredentialsToken(cfg: EngineCfg): Promise<string> {
  if (!cfg.oauthTokenUrl) throw Errors.validation('OAuth2 token URL is required for engine client credentials auth')
  if (!cfg.username) throw Errors.validation('OAuth2 client id is required for engine client credentials auth')
  const password = secretResolver.resolveStored(cfg.passwordEnc)
  if (!password) throw Errors.validation('OAuth2 client secret is required for engine client credentials auth')

  const cacheKey = [
    cfg.id,
    cfg.oauthTokenUrl,
    cfg.username,
    cfg.oauthScopes || '',
    cfg.oauthAudience || '',
  ].join('\n')
  const cached = oauthTokenCache.get(cacheKey)
  const now = Date.now()
  if (cached && cached.expiresAt > now + 30_000) return cached.token

  const body = new URLSearchParams()
  body.set('grant_type', 'client_credentials')
  body.set('client_id', cfg.username)
  body.set('client_secret', password)
  if (cfg.oauthScopes) body.set('scope', cfg.oauthScopes)
  if (cfg.oauthAudience) body.set('audience', cfg.oauthAudience)
  const tokenUrl = validateBpmnEngineEndpointUrl(cfg.oauthTokenUrl, 'OAuth2 token URL').toString()

  let response: Awaited<ReturnType<typeof fetch>>
  try {
    response = await fetch(tokenUrl, {
      method: 'POST',
      redirect: 'error',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(DEFAULT_ENGINE_REQUEST_TIMEOUT_MS),
    })
  } catch {
    throw Errors.authFailed('Engine OAuth2 token request failed')
  }
  if (!response.ok) {
    await response.text().catch(() => '')
    throw Errors.authFailed(`Engine OAuth2 token request failed with status ${response.status}`)
  }

  const payload = await (await boundEngineResponseBody(response, {
    method: 'POST',
    path: '/oauth2/token',
    connectionMode: cfg.connectionMode,
  })).json() as { access_token?: string; expires_in?: number }
  if (!payload.access_token) throw Errors.authFailed('Engine OAuth2 token response did not include an access token')

  const expiresInMs = Math.max(60, Number(payload.expires_in || 300)) * 1000
  oauthTokenCache.set(cacheKey, { token: payload.access_token, expiresAt: now + expiresInMs })
  return payload.access_token
}

export async function resolveBpmnEngineConnection(
  input: EngineConnectionInput,
  request: BpmnEngineRequestOptions = {},
): Promise<ResolvedBpmnEngineConnection> {
  const engineId = request.engineId || input.id || 'unknown'
  const method = request.method || 'GET'
  const path = request.path || ''
  const diagnostics = describeBpmnEngineTransport(input)
  const { connectionMode, endpointAuthentication: authType } = diagnostics
  const h: Record<string, string> = { ...buildEngineCredentialHeaders(input) }
  if (request.contentType !== null) h['Content-Type'] = request.contentType || 'application/json'
  if (authType === 'oauth2-client-credentials') {
    h['Authorization'] = `Bearer ${await resolveOAuthClientCredentialsToken({
      id: String(input.id || engineId),
      baseUrl: input.baseUrl,
      connectionMode,
      authType,
      username: input.username,
      passwordEnc: input.passwordEnc,
      oauthTokenUrl: input.oauthTokenUrl,
      oauthScopes: input.oauthScopes,
      oauthAudience: input.oauthAudience,
    })}`
  }

  const requestContext = getBpmnEngineRequestContext()
  h['X-EnterpriseGlue-Request-Id'] = requestContext?.requestId || randomUUID()
  if (requestContext?.userId) h['X-EnterpriseGlue-User-Id'] = requestContext.userId
  if (requestContext?.tenantId) h['X-EnterpriseGlue-Tenant-Id'] = requestContext.tenantId
  if (requestContext?.tenantSlug) h['X-EnterpriseGlue-Tenant-Slug'] = requestContext.tenantSlug
  h['X-EnterpriseGlue-Engine-Id'] = requestContext?.engineId || engineId
  h['X-EnterpriseGlue-Operation-Class'] = inferOperationClass(method, path)

  return {
    url: resolveBpmnEngineRequestUrl(input.baseUrl, path),
    headers: h,
    diagnostics,
  }
}

/**
 * Executes all persisted-engine HTTP calls through one bounded transport.
 * Only safe reads retry, and thrown errors never contain endpoint URLs,
 * credentials, or upstream response bodies.
 */
export async function fetchBpmnEngineEndpoint(
  input: EngineConnectionInput,
  request: BpmnEngineRequestOptions = {},
  init: Parameters<typeof fetch>[1] = {},
): Promise<BpmnEngineFetchResult> {
  const method = String(request.method || init?.method || 'GET').toUpperCase()
  const retry = request.retry || (method === 'GET' ? 'safe_read' : 'never')
  const maxAttempts = retry === 'safe_read' && method === 'GET' ? 2 : 1
  const timeoutMs = boundedTimeoutMs(request.timeoutMs)
  const connection = await resolveBpmnEngineConnection(input, { ...request, method })

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response: Awaited<ReturnType<typeof fetch>>
    try {
      const timeoutSignal = AbortSignal.timeout(timeoutMs)
      const callerSignal = init?.signal
      const signal = callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal
      response = await fetch(connection.url, {
        ...init,
        method,
        redirect: init?.redirect || 'error',
        headers: { ...connection.headers, ...(init?.headers || {}) },
        signal,
      })
    } catch {
      if (attempt < maxAttempts) continue
      throw new BpmnEngineTransportError({
        method,
        path: request.path || '',
        attempts: attempt,
        timeoutMs,
        connectionMode: connection.diagnostics.connectionMode,
      })
    }

    if (attempt < maxAttempts && TRANSIENT_ENGINE_STATUSES.has(response.status)) {
      await response.body?.cancel().catch(() => undefined)
      continue
    }
    return {
      response: await boundEngineResponseBody(response, {
        method,
        path: request.path || '',
        connectionMode: connection.diagnostics.connectionMode,
      }),
      diagnostics: { ...connection.diagnostics, attempts: attempt, timeoutMs },
    }
  }

  throw new BpmnEngineTransportError({
    method,
    path: request.path || '',
    attempts: maxAttempts,
    timeoutMs,
    connectionMode: connection.diagnostics.connectionMode,
  })
}

export class BpmnEngineTransportError extends AppError {
  constructor(input: { method: string; path: string; attempts: number; timeoutMs: number; connectionMode: 'direct' | 'customer_sidecar' }) {
    super(
      'ENGINE_TRANSPORT_UNAVAILABLE',
      'The engine endpoint is unavailable',
      502,
      {
        operationClass: inferOperationClass(input.method, input.path),
        attempts: input.attempts,
        timeoutMs: input.timeoutMs,
        connectionMode: input.connectionMode,
      },
    )
  }
}

export class BpmnEngineResponseTooLargeError extends AppError {
  constructor(input: { method: string; path: string; maxResponseBytes: number; connectionMode: 'direct' | 'customer_sidecar' }) {
    super(
      'ENGINE_RESPONSE_TOO_LARGE',
      'The engine response exceeded the allowed size',
      502,
      {
        operationClass: inferOperationClass(input.method, input.path),
        maxResponseBytes: input.maxResponseBytes,
        connectionMode: input.connectionMode,
      },
    )
  }
}

type BpmnEngineAuditResult = 'succeeded' | 'operation_rejected' | 'transport_unavailable' | 'malformed_response' | 'response_too_large' | 'failed'

function bpmnEngineAuditResult(error?: unknown): BpmnEngineAuditResult {
  if (!(error instanceof AppError)) return error ? 'failed' : 'succeeded'
  switch (error.code) {
    case 'ENGINE_OPERATION_REJECTED': return 'operation_rejected'
    case 'ENGINE_TRANSPORT_UNAVAILABLE': return 'transport_unavailable'
    case 'ENGINE_MALFORMED_RESPONSE': return 'malformed_response'
    case 'ENGINE_RESPONSE_TOO_LARGE': return 'response_too_large'
    default: return 'failed'
  }
}

/**
 * Records only stable EnterpriseGlue lineage and sanitized outcome classes.
 * It deliberately omits endpoint URLs, request payloads, credentials, and all
 * customer-owned downstream sidecar material.
 */
async function auditBpmnEngineOperation(input: {
  engineId: string;
  method: string;
  path: string;
  connectionMode: 'direct' | 'customer_sidecar';
  error?: unknown;
}): Promise<void> {
  const context = getBpmnEngineRequestContext()
  if (!context?.userId || !context.actionId) return

  const appError = input.error instanceof AppError ? input.error : null
  await logAudit({
    tenantId: context.tenantId,
    userId: context.userId,
    action: 'engine.operation',
    resourceType: 'engine',
    resourceId: input.engineId,
    details: {
      requestId: context.requestId,
      authorizedActionId: context.actionId,
      projectId: context.projectId || null,
      operationClass: inferOperationClass(input.method, input.path),
      method: input.method,
      connectionMode: input.connectionMode,
      result: bpmnEngineAuditResult(input.error),
      ...(appError?.code ? { errorCode: appError.code } : {}),
      ...(typeof appError?.details?.engineStatus === 'number' ? { engineStatus: appError.details.engineStatus } : {}),
    },
  })
}

async function decodeBpmnEngineResponse<T>(
  response: Awaited<ReturnType<typeof fetch>>,
  input: { method: string; path: string; connectionMode: 'direct' | 'customer_sidecar' },
): Promise<T> {
  try {
    const contentType = response.headers.get('content-type') || ''
    if (contentType.includes('application/json')) return await response.json() as T
    return await response.text() as T
  } catch {
    throw new BpmnEngineMalformedResponseError(input)
  }
}

async function camundaGetUsingConnection<T = unknown>(engineId: string, cfg: EngineConnectionInput, path: string, params?: Record<string, any>): Promise<T> {
  const url = new URL(resolveBpmnEngineRequestUrl(cfg.baseUrl, path))
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === '') continue
      if (Array.isArray(v)) v.forEach((vv) => url.searchParams.append(k, String(vv)))
      else url.searchParams.set(k, String(v))
    }
  }
  const connectionMode = cfg.connectionMode === 'customer_sidecar' ? 'customer_sidecar' : 'direct'
  try {
    const { response: res, diagnostics } = await fetchBpmnEngineEndpoint(cfg, { engineId, method: 'GET', path: `${path}${url.search}` })
    if (!res.ok) {
      await res.text().catch(() => '')
      throw new BpmnEngineOperationError({ method: 'GET', path, status: res.status, connectionMode: diagnostics.connectionMode })
    }
    const decoded = await decodeBpmnEngineResponse<T>(res, { method: 'GET', path, connectionMode: diagnostics.connectionMode })
    await auditBpmnEngineOperation({ engineId, method: 'GET', path, connectionMode: diagnostics.connectionMode })
    return decoded
  } catch (error) {
    await auditBpmnEngineOperation({ engineId, method: 'GET', path, connectionMode, error })
    throw error
  }
}

/**
 * Uses an already-authorized persisted connection rather than resolving the
 * engine a second time. This is essential for durable operations that have
 * just loaded the engine through their own data-source boundary.
 */
export async function camundaGetWithConnection<T = unknown>(engine: EngineConnectionInput & { id: string }, path: string, params?: Record<string, any>): Promise<T> {
  return camundaGetUsingConnection<T>(engine.id, engine, path, params)
}

export async function camundaGet<T = unknown>(engineId: string, path: string, params?: Record<string, any>): Promise<T> {
  return camundaGetUsingConnection<T>(engineId, await getEngine(engineId), path, params)
}

async function camundaSendWithConnection<T = unknown>(engineId: string, cfg: EngineConnectionInput, method: 'POST' | 'PUT' | 'DELETE', path: string, body?: any): Promise<T> {
  const connectionMode = cfg.connectionMode === 'customer_sidecar' ? 'customer_sidecar' : 'direct'
  try {
    const { response: res, diagnostics } = await fetchBpmnEngineEndpoint(cfg, { engineId, method, path }, {
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
      await res.text().catch(() => '')
      throw new BpmnEngineOperationError({ method, path, status: res.status, connectionMode: diagnostics.connectionMode })
    }
    const decoded = await decodeBpmnEngineResponse<T>(res, { method, path, connectionMode: diagnostics.connectionMode })
    await auditBpmnEngineOperation({ engineId, method, path, connectionMode: diagnostics.connectionMode })
    return decoded
  } catch (error) {
    await auditBpmnEngineOperation({ engineId, method, path, connectionMode, error })
    throw error
  }
}

/** Sends a mutation through the supplied persisted connection and shared hardened transport. */
export async function camundaSendForConnection<T = unknown>(engine: EngineConnectionInput & { id: string }, method: 'POST' | 'PUT' | 'DELETE', path: string, body?: any): Promise<T> {
  return camundaSendWithConnection<T>(engine.id, engine, method, path, body)
}

async function camundaSend<T = unknown>(engineId: string, method: 'POST' | 'PUT' | 'DELETE', path: string, body?: any): Promise<T> {
  return camundaSendWithConnection<T>(engineId, await getEngine(engineId), method, path, body)
}

export const camundaPost = <T = unknown>(engineId: string, path: string, body?: any) => camundaSend<T>(engineId, 'POST', path, body)
export const camundaPut =  <T = unknown>(engineId: string, path: string, body?: any) => camundaSend<T>(engineId, 'PUT', path, body)
export const camundaDelete =  <T = unknown>(engineId: string, path: string, body?: any) => camundaSend<T>(engineId, 'DELETE', path, body)
export const camundaPostWithConnection = <T = unknown>(engine: EngineConnectionInput & { id: string }, path: string, body?: any) => camundaSendForConnection<T>(engine, 'POST', path, body)
export const camundaPutWithConnection = <T = unknown>(engine: EngineConnectionInput & { id: string }, path: string, body?: any) => camundaSendForConnection<T>(engine, 'PUT', path, body)
export const camundaDeleteWithConnection = <T = unknown>(engine: EngineConnectionInput & { id: string }, path: string, body?: any) => camundaSendForConnection<T>(engine, 'DELETE', path, body)

// -----------------------------
// Batch: common helpers
// -----------------------------
export const postProcessInstanceDeleteAsync = <T = Batch>(engineId: string, body: DeleteProcessInstancesRequest) => camundaPost<T>(engineId, '/process-instance/delete', body)
export const postProcessInstanceSuspendedAsync = <T = Batch>(engineId: string, body: SuspendProcessInstancesRequest) => camundaPost<T>(engineId, '/process-instance/suspended-async', body)
export const postJobRetriesAsync = <T = Batch>(engineId: string, body: SetJobRetriesAsyncRequest) => camundaPost<T>(engineId, '/job/retries-async', body)
export const getBatchInfo = <T = Batch>(engineId: string, id: string) => camundaGet<T>(engineId, `/batch/${encodeURIComponent(id)}`)
export const getBatchStatistics = <T = BatchStatistics>(engineId: string, id: string) => camundaGet<T>(engineId, `/batch/${encodeURIComponent(id)}/statistics`)
export const deleteBatchById = <T = void>(engineId: string, id: string) => camundaDelete<T>(engineId, `/batch/${encodeURIComponent(id)}`)
export const setBatchSuspensionState = <T = void>(engineId: string, id: string, body: SetSuspensionStateRequest) =>
  camundaPut<T>(engineId, `/batch/${encodeURIComponent(id)}/suspended`, body)

// -----------------------------
// Migration helpers
// -----------------------------
export const postMigrationGenerate = <T = MigrationPlan>(engineId: string, body: GenerateMigrationPlanRequest) => camundaPost<T>(engineId, '/migration/generate', body)
export const postMigrationValidate = <T = MigrationPlanValidationReport>(engineId: string, body: ValidateMigrationPlanRequest) => camundaPost<T>(engineId, '/migration/validate', body)
export const postMigrationExecuteAsync = <T = Batch>(engineId: string, body: ExecuteMigrationRequest) => camundaPost<T>(engineId, '/migration/executeAsync', body)
export const postMigrationExecute = <T = void>(engineId: string, body: ExecuteMigrationRequest) => camundaPost<T>(engineId, '/migration/execute', body)

// -----------------------------
// History helpers
// -----------------------------
export const getHistoricActivityInstances = <T = HistoricActivityInstance[]>(engineId: string, params?: Record<string, any>) => camundaGet<T>(engineId, '/history/activity-instance', params)
export const getProcessInstanceActivityTree = <T = ActivityInstance>(engineId: string, id: string) => camundaGet<T>(engineId, `/process-instance/${encodeURIComponent(id)}/activity-instances`)
export const getProcessInstanceCount = <T = ProcessInstanceCount>(engineId: string, params?: Record<string, any>) => camundaGet<T>(engineId, '/process-instance/count', params)
export const postProcessInstanceCount = <T = ProcessInstanceCount>(engineId: string, body?: Record<string, any>) => camundaPost<T>(engineId, '/process-instance/count', body)

// Version/health helpers
export const getEngineVersion = async (engineId: string): Promise<EngineVersion | null> => {
  try {
    const data = await camundaGet<EngineVersion>(engineId, '/version')
    if (data && typeof data === 'object') return data
  } catch {}
  return null
}

// -----------------------------
// Deployment helpers
// -----------------------------
export const getDeployments = <T = Deployment[]>(engineId: string, params?: Record<string, any>) => camundaGet<T>(engineId, '/deployment', params)
export const getDeployment = <T = Deployment>(engineId: string, id: string) => camundaGet<T>(engineId, `/deployment/${encodeURIComponent(id)}`)
export const deleteDeployment = <T = void>(engineId: string, id: string, cascade?: boolean) => {
  const query = cascade ? `?cascade=true` : ''
  return camundaDelete<T>(engineId, `/deployment/${encodeURIComponent(id)}${query}`)
}
export const getProcessDefinitionDiagram = <T = string>(engineId: string, id: string) => camundaGet<T>(engineId, `/process-definition/${encodeURIComponent(id)}/diagram`)

// -----------------------------
// Task helpers
// -----------------------------
export const getTasks = <T = Task[]>(engineId: string, params?: Record<string, any>) => camundaGet<T>(engineId, '/task', params)
export const getTask = <T = Task>(engineId: string, id: string) => camundaGet<T>(engineId, `/task/${encodeURIComponent(id)}`)
export const getTaskCount = <T = TaskCount>(engineId: string, params?: Record<string, any>) => camundaGet<T>(engineId, '/task/count', params)
export const claimTask = <T = void>(engineId: string, id: string, body: any) => camundaPost<T>(engineId, `/task/${encodeURIComponent(id)}/claim`, body)
export const unclaimTask = <T = void>(engineId: string, id: string) => camundaPost<T>(engineId, `/task/${encodeURIComponent(id)}/unclaim`)
export const setTaskAssignee = <T = void>(engineId: string, id: string, body: any) => camundaPost<T>(engineId, `/task/${encodeURIComponent(id)}/assignee`, body)
export const completeTask = <T = CamundaVariables | void>(engineId: string, id: string, body?: any) => camundaPost<T>(engineId, `/task/${encodeURIComponent(id)}/complete`, body)
export const getTaskVariables = <T = CamundaVariables>(engineId: string, id: string) => camundaGet<T>(engineId, `/task/${encodeURIComponent(id)}/variables`)
export const updateTaskVariables = <T = void>(engineId: string, id: string, body: any) => camundaPost<T>(engineId, `/task/${encodeURIComponent(id)}/variables`, body)
export const getTaskForm = <T = TaskForm>(engineId: string, id: string) => camundaGet<T>(engineId, `/task/${encodeURIComponent(id)}/form`)

// -----------------------------
// External task helpers
// -----------------------------
export const fetchAndLockExternalTasks = <T = ExternalTask[]>(engineId: string, body: any) => camundaPost<T>(engineId, '/external-task/fetchAndLock', body)
export const getExternalTasks = <T = ExternalTask[]>(engineId: string, params?: Record<string, any>) => camundaGet<T>(engineId, '/external-task', params)
export const completeExternalTask = <T = void>(engineId: string, id: string, body: any) => camundaPost<T>(engineId, `/external-task/${encodeURIComponent(id)}/complete`, body)
export const handleExternalTaskFailure = <T = void>(engineId: string, id: string, body: any) => camundaPost<T>(engineId, `/external-task/${encodeURIComponent(id)}/failure`, body)
export const handleExternalTaskBpmnError = <T = void>(engineId: string, id: string, body: any) => camundaPost<T>(engineId, `/external-task/${encodeURIComponent(id)}/bpmnError`, body)
export const extendExternalTaskLock = <T = void>(engineId: string, id: string, body: any) => camundaPost<T>(engineId, `/external-task/${encodeURIComponent(id)}/extendLock`, body)
export const unlockExternalTask = <T = void>(engineId: string, id: string) => camundaPost<T>(engineId, `/external-task/${encodeURIComponent(id)}/unlock`)
export const setExternalTaskRetries = <T = void>(engineId: string, id: string, body: any) => camundaPut<T>(engineId, `/external-task/${encodeURIComponent(id)}/retries`, body)

// -----------------------------
// Message & Signal helpers
// -----------------------------
export const correlateMessage = <T = MessageCorrelationResult[]>(engineId: string, body: any) => camundaPost<T>(engineId, '/message', body)
export const deliverSignal = <T = void>(engineId: string, body: any) => camundaPost<T>(engineId, '/signal', body)

// -----------------------------
// Decision definition helpers
// -----------------------------
export const getDecisionDefinitions = <T = DecisionDefinition[]>(engineId: string, params?: Record<string, any>) => camundaGet<T>(engineId, '/decision-definition', params)
export const getDecisionDefinition = <T = DecisionDefinition>(engineId: string, id: string) => camundaGet<T>(engineId, `/decision-definition/${encodeURIComponent(id)}`)
export const getDecisionDefinitionXml = <T = DecisionDefinitionXml>(engineId: string, id: string) => camundaGet<T>(engineId, `/decision-definition/${encodeURIComponent(id)}/xml`)
export const evaluateDecision = <T = DecisionResult[]>(engineId: string, id: string, body: any) => camundaPost<T>(engineId, `/decision-definition/${encodeURIComponent(id)}/evaluate`, body)

// -----------------------------
// Job helpers
// -----------------------------
export const getJobs = <T = Job[]>(engineId: string, params?: Record<string, any>) => camundaGet<T>(engineId, '/job', params)
export const getJob = <T = Job>(engineId: string, id: string) => camundaGet<T>(engineId, `/job/${encodeURIComponent(id)}`)
export const executeJob = <T = void>(engineId: string, id: string) => camundaPost<T>(engineId, `/job/${encodeURIComponent(id)}/execute`)
export const setJobRetries = <T = void>(engineId: string, id: string, body: any) => camundaPut<T>(engineId, `/job/${encodeURIComponent(id)}/retries`, body)
export const setJobSuspensionState = <T = void>(engineId: string, id: string, body: any) => camundaPut<T>(engineId, `/job/${encodeURIComponent(id)}/suspended`, body)
export const setJobDuedate = <T = void>(engineId: string, id: string, body: any) => camundaPut<T>(engineId, `/job/${encodeURIComponent(id)}/duedate`, body)

// Job definition helpers
export const getJobDefinitions = <T = JobDefinition[]>(engineId: string, params?: Record<string, any>) => camundaGet<T>(engineId, '/job-definition', params)
export const setJobDefinitionRetries = <T = void>(engineId: string, id: string, body: any) => camundaPut<T>(engineId, `/job-definition/${encodeURIComponent(id)}/retries`, body)
export const setJobDefinitionSuspensionState = <T = void>(engineId: string, id: string, body: any) => camundaPut<T>(engineId, `/job-definition/${encodeURIComponent(id)}/suspended`, body)

// -----------------------------
// Extended history helpers
// -----------------------------
export const getHistoricTaskInstances = <T = HistoricTaskInstance[]>(engineId: string, params?: Record<string, any>) => camundaGet<T>(engineId, '/history/task', params)
export const getHistoricVariableInstances = <T = HistoricVariableInstance[]>(engineId: string, params?: Record<string, any>) => camundaGet<T>(engineId, '/history/variable-instance', params)
export const getHistoricDecisionInstances = <T = HistoricDecisionInstance[]>(engineId: string, params?: Record<string, any>) => camundaGet<T>(engineId, '/history/decision-instance', params)

// Fetch a single historic decision instance by ID with optional inputs/outputs embedded.
// includeInputs and includeOutputs query params tell Camunda to embed those arrays in the response.
export async function getHistoricDecisionInstanceById<T = HistoricDecisionInstance>(
  engineId: string,
  id: string,
  options?: { includeInputs?: boolean; includeOutputs?: boolean }
): Promise<T> {
  const params: Record<string, boolean> = {}
  if (options?.includeInputs) params.includeInputs = true
  if (options?.includeOutputs) params.includeOutputs = true
  return await camundaGet<T>(engineId, `/history/decision-instance/${encodeURIComponent(id)}`, params)
}

// Helper to extract inputs from a decision instance fetched with includeInputs=true.
export async function getHistoricDecisionInstanceInputs<T = unknown>(engineId: string, id: string): Promise<T> {
  const instance = await getHistoricDecisionInstanceById<any>(engineId, id, { includeInputs: true })
  return (instance?.inputs ?? []) as T
}

// Helper to extract outputs from a decision instance fetched with includeOutputs=true.
export async function getHistoricDecisionInstanceOutputs<T = unknown>(engineId: string, id: string): Promise<T> {
  const instance = await getHistoricDecisionInstanceById<any>(engineId, id, { includeOutputs: true })
  return (instance?.outputs ?? []) as T
}
export const getUserOperationLog = <T = UserOperationLogEntry[]>(engineId: string, params?: Record<string, any>) => camundaGet<T>(engineId, '/history/user-operation', params)

// -----------------------------
// Metrics helpers
// -----------------------------
export const getMetrics = <T = Metric[]>(engineId: string, params?: Record<string, any>) => camundaGet<T>(engineId, '/metrics', params)
export const getMetricByName = <T = MetricResult>(engineId: string, name: string, params?: Record<string, any>) => camundaGet<T>(engineId, `/metrics/${encodeURIComponent(name)}`, params)

// -----------------------------
// Modification & Restart helpers
// -----------------------------
export const postProcessInstanceModification = <T = void>(engineId: string, id: string, body: any) => camundaPost<T>(engineId, `/process-instance/${encodeURIComponent(id)}/modification`, body)
export const postProcessDefinitionModificationAsync = <T = Batch>(engineId: string, id: string, body: any) => camundaPost<T>(engineId, `/process-definition/${encodeURIComponent(id)}/modification/executeAsync`, body)
export const postProcessDefinitionRestartAsync = <T = Batch>(engineId: string, id: string, body: any) => camundaPost<T>(engineId, `/process-definition/${encodeURIComponent(id)}/restart/executeAsync`, body)
