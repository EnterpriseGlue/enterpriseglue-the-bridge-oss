import { camundaGet } from '@enterpriseglue/shared/services/bpmn-engine-client.js'
import { AppError } from '@enterpriseglue/shared/middleware/errorHandler.js'

export const MAX_RUNTIME_RESOURCE_PAGE_SIZE = 100

export type AuthorizedRuntimeResourceScope = {
  resourceKey: string
  /** Empty string is the persisted inventory identity for definitions without a runtime tenant. */
  runtimeTenantId: string
}

function runtimeFilterNotSupported(message: string): AppError {
  return new AppError('runtime_filter_not_supported', message, 403)
}

/**
 * Resolves the one runtime tenant that may be used by an exact key-based
 * operation. Multiple authorized runtime tenants remain safe for collection
 * reads, but an exact mutation/evaluation must never let the engine choose
 * between them implicitly.
 */
export function getAuthorizedRuntimeTenantIdForKey(
  scopes: AuthorizedRuntimeResourceScope[] | undefined,
  resourceKey: string,
): string | undefined {
  if (!scopes) return undefined
  const runtimeTenantIds = [...new Set(scopes
    .filter((scope) => scope.resourceKey === resourceKey)
    .map((scope) => scope.runtimeTenantId))]
  if (runtimeTenantIds.length !== 1) {
    throw runtimeFilterNotSupported(
      'An exact runtime operation requires one resolved runtime tenant scope',
    )
  }
  return runtimeTenantIds[0]
}

/**
 * Resource-aware routes must never query an unbounded central-engine
 * collection. This normalizes an omitted limit and rejects attempts to exceed
 * the supported post-filtering page size.
 */
export function getBoundedRuntimeResourceQuery<T extends Record<string, unknown>>(params: T): T & { maxResults: number } {
  const maxResults = typeof params.maxResults === 'string' && /^\d+$/.test(params.maxResults)
    ? Number(params.maxResults)
    : params.maxResults
  if (maxResults !== undefined && (
    typeof maxResults !== 'number'
    || !Number.isInteger(maxResults)
    || maxResults < 1
    || maxResults > MAX_RUNTIME_RESOURCE_PAGE_SIZE
  )) {
    throw runtimeFilterNotSupported(`Resource-aware runtime queries require maxResults between 1 and ${MAX_RUNTIME_RESOURCE_PAGE_SIZE}`)
  }

  return { ...params, maxResults: maxResults ?? MAX_RUNTIME_RESOURCE_PAGE_SIZE }
}

/**
 * Adds the authoritative runtime tenant scope for one stable definition key.
 * Every current adapter follows the Camunda 7 REST profile, whose collection
 * endpoints accept `tenantIdIn` and `withoutTenantId`; callers still perform
 * their normal key/lineage verification after the engine responds.
 */
export function withAuthorizedRuntimeTenantQuery<T extends Record<string, unknown>>(
  params: T,
  scopes: AuthorizedRuntimeResourceScope[] | undefined,
  resourceKey: string,
): Omit<T, 'tenantIdIn' | 'withoutTenantId'> & { tenantIdIn?: string[]; withoutTenantId?: boolean } {
  if (!scopes) return params
  const { tenantIdIn: _requestedTenantIdIn, withoutTenantId: _requestedWithoutTenantId, ...query } = params
  const runtimeTenantIds = scopes
    .filter((scope) => scope.resourceKey === resourceKey)
    .map((scope) => scope.runtimeTenantId)
  const tenantIdIn = [...new Set(runtimeTenantIds.filter(Boolean))]
  const withoutTenantId = runtimeTenantIds.includes('')
  return {
    ...query,
    ...(tenantIdIn.length ? { tenantIdIn } : {}),
    ...(withoutTenantId ? { withoutTenantId: true } : {}),
  }
}

/**
 * fetchAndLock has the same high-cardinality risk as collection reads. Limit
 * its resource-aware result set before resolving returned definition lineage.
 */
export function getBoundedRuntimeFetchAndLockRequest<T extends Record<string, unknown>>(body: T): T & { maxTasks: number } {
  const maxTasks = typeof body.maxTasks === 'string' && /^\d+$/.test(body.maxTasks)
    ? Number(body.maxTasks)
    : body.maxTasks
  if (maxTasks !== undefined && (
    typeof maxTasks !== 'number'
    || !Number.isInteger(maxTasks)
    || maxTasks < 1
    || maxTasks > MAX_RUNTIME_RESOURCE_PAGE_SIZE
  )) {
    throw runtimeFilterNotSupported(`Resource-aware external task fetches require maxTasks between 1 and ${MAX_RUNTIME_RESOURCE_PAGE_SIZE}`)
  }

  return { ...body, maxTasks: maxTasks ?? MAX_RUNTIME_RESOURCE_PAGE_SIZE }
}

/**
 * Some engine collections already carry the stable authorization key. Check
 * that key locally instead of relying solely on the upstream query filter.
 */
export function filterRuntimeItemsByResourceKey<T extends object>(
  items: T[],
  authorizedKeys: string[] | undefined,
  keyField: string,
  scopes?: AuthorizedRuntimeResourceScope[],
): T[] {
  if (!authorizedKeys) return items
  if (items.length > MAX_RUNTIME_RESOURCE_PAGE_SIZE) {
    throw runtimeFilterNotSupported('The engine returned an unbounded runtime collection for a resource-aware request')
  }
  const allowedKeys = new Set(authorizedKeys)
  return items.filter((item) => {
    const key = (item as Record<string, unknown>)[keyField]
    if (typeof key !== 'string' || !allowedKeys.has(key)) return false
    if (!scopes) return true
    const runtimeTenantId = typeof (item as Record<string, unknown>).tenantId === 'string'
      ? (item as Record<string, unknown>).tenantId as string
      : ''
    return scopes.some((scope) => scope.resourceKey === key && scope.runtimeTenantId === runtimeTenantId)
  })
}

/**
 * Runtime APIs such as jobs and external tasks expose a process definition id
 * rather than its stable authorization key. This helper resolves that lineage
 * server-side and drops entries that cannot be connected to an allowed key.
 */
export async function filterRuntimeItemsByProcessDefinitionKeys<T extends {
  processDefinitionId?: unknown;
  definitionId?: unknown;
  processDefinitionKey?: unknown;
  definitionKey?: unknown;
  processInstanceId?: unknown;
}>(
  engineId: string,
  items: T[],
  authorizedDefinitionKeys?: string[],
  scopes?: AuthorizedRuntimeResourceScope[],
  options?: { enrichHistoricProcessLineage?: boolean },
): Promise<T[]> {
  if (!authorizedDefinitionKeys) return items

  if (items.length > MAX_RUNTIME_RESOURCE_PAGE_SIZE) {
    throw runtimeFilterNotSupported('The engine returned an unbounded runtime collection for a resource-aware request')
  }

  const allowedKeys = new Set(authorizedDefinitionKeys)
  const definitionIds = [...new Set(items
    .filter((item) => typeof item.processDefinitionKey !== 'string' && typeof item.definitionKey !== 'string')
    .map((item) => item.processDefinitionId ?? item.definitionId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0))]
  const definitions = await Promise.all(definitionIds.map(async (id) => [
    id,
    await camundaGet<Record<string, unknown>>(engineId, `/process-definition/${encodeURIComponent(id)}`),
  ] as const))
  const keyByDefinitionId = new Map(definitions.map(([id, definition]) => [
    id,
    typeof definition.key === 'string' ? definition.key : '',
  ]))

  // Historic variable-instance responses in the Camunda 7 REST profile carry
  // a process instance id, but not the stable process-definition key. Resolve
  // that missing lineage before applying resource-aware authorization. Without
  // this, scoped users either receive an unsafe unfiltered response or (as the
  // old direct-key filter did) an empty history collection.
  const processInstanceIds = [...new Set(items
    .filter((item) => typeof item.processDefinitionKey !== 'string'
      && typeof item.definitionKey !== 'string'
      && typeof item.processDefinitionId !== 'string'
      && typeof item.definitionId !== 'string')
    .map((item) => item.processInstanceId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0))]
  const historicInstances = processInstanceIds.length
    ? await camundaGet<Record<string, unknown>[]>(engineId, '/history/process-instance', {
      processInstanceIdIn: processInstanceIds.join(','),
      maxResults: MAX_RUNTIME_RESOURCE_PAGE_SIZE,
    })
    : []
  const historicInstanceById = new Map((Array.isArray(historicInstances) ? historicInstances : [])
    .map((instance) => [
      typeof instance.id === 'string' ? instance.id : '',
      instance,
    ] as const)
    .filter(([id]) => Boolean(id)))

  // Enrich before filtering, not after it. Apart from making the resolved
  // lineage available to the value-presenter, this keeps malformed historic
  // records on the fail-closed path instead of relying on an unreachable
  // post-filter fallback.
  const itemsWithHistoricProcessLineage = !options?.enrichHistoricProcessLineage
    ? items
    : items.map((item) => {
      const hasDirectOrDefinitionLineage = typeof item.processDefinitionKey === 'string'
        || typeof item.definitionKey === 'string'
        || typeof item.processDefinitionId === 'string'
        || typeof item.definitionId === 'string'
      if (hasDirectOrDefinitionLineage || typeof item.processInstanceId !== 'string') return item
      const historicInstance = historicInstanceById.get(item.processInstanceId)
      if (!historicInstance || typeof historicInstance.processDefinitionKey !== 'string') return item
      const enriched: Record<string, unknown> = {
        ...item,
        processDefinitionKey: historicInstance.processDefinitionKey,
      }
      if (enriched.tenantId === undefined && typeof historicInstance.tenantId === 'string') {
        enriched.tenantId = historicInstance.tenantId
      }
      return enriched as T
    })

  const filtered = itemsWithHistoricProcessLineage.filter((item) => {
    const directKey = typeof item.processDefinitionKey === 'string'
      ? item.processDefinitionKey
      : typeof item.definitionKey === 'string' ? item.definitionKey : ''
    const key = directKey || (() => {
      const candidateDefinitionId = item.processDefinitionId ?? item.definitionId
      const definitionId = typeof candidateDefinitionId === 'string' ? candidateDefinitionId : ''
      const resolvedDefinitionKey = keyByDefinitionId.get(definitionId) || ''
      if (resolvedDefinitionKey) return resolvedDefinitionKey
      const processInstanceId = typeof item.processInstanceId === 'string' ? item.processInstanceId : ''
      const instance = historicInstanceById.get(processInstanceId)
      return typeof instance?.processDefinitionKey === 'string' ? instance.processDefinitionKey : ''
    })()
    if (!key || !allowedKeys.has(key)) return false
    if (!scopes) return true
    const runtimeTenantId = typeof (item as Record<string, unknown>).tenantId === 'string'
      ? (item as Record<string, unknown>).tenantId as string
      : ''
    if (scopes.some((scope) => scope.resourceKey === key && scope.runtimeTenantId === runtimeTenantId)) return true
    const candidateDefinitionId = item.processDefinitionId ?? item.definitionId
    const definitionId = typeof candidateDefinitionId === 'string' ? candidateDefinitionId : ''
    const processInstanceId = typeof item.processInstanceId === 'string' ? item.processInstanceId : ''
    const historicInstance = historicInstanceById.get(processInstanceId)
    const historicInstanceTenantId = typeof historicInstance?.tenantId === 'string' ? historicInstance.tenantId : ''
    if (historicInstance && scopes.some((scope) => scope.resourceKey === key && scope.runtimeTenantId === historicInstanceTenantId)) return true
    const definition = definitions.find(([id]) => id === definitionId)?.[1]
    const definitionTenantId = typeof definition?.tenantId === 'string' ? definition.tenantId : ''
    return Boolean(definition) && scopes.some((scope) => scope.resourceKey === key && scope.runtimeTenantId === definitionTenantId)
  })

  return filtered
}
