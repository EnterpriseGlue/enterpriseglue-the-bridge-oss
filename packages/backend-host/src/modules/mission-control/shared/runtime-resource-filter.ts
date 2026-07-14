import { camundaGet } from '@enterpriseglue/shared/services/bpmn-engine-client.js'
import { AppError } from '@enterpriseglue/shared/middleware/errorHandler.js'

export const MAX_RUNTIME_RESOURCE_PAGE_SIZE = 100

function runtimeFilterNotSupported(message: string): AppError {
  return new AppError('runtime_filter_not_supported', message, 403)
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
): T[] {
  if (!authorizedKeys) return items
  if (items.length > MAX_RUNTIME_RESOURCE_PAGE_SIZE) {
    throw runtimeFilterNotSupported('The engine returned an unbounded runtime collection for a resource-aware request')
  }
  const allowedKeys = new Set(authorizedKeys)
  return items.filter((item) => {
    const key = (item as Record<string, unknown>)[keyField]
    return typeof key === 'string' && allowedKeys.has(key)
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
}>(
  engineId: string,
  items: T[],
  authorizedDefinitionKeys?: string[],
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

  return items.filter((item) => {
    const directKey = typeof item.processDefinitionKey === 'string'
      ? item.processDefinitionKey
      : typeof item.definitionKey === 'string' ? item.definitionKey : ''
    if (directKey) return allowedKeys.has(directKey)
    const candidateDefinitionId = item.processDefinitionId ?? item.definitionId
    const definitionId = typeof candidateDefinitionId === 'string' ? candidateDefinitionId : ''
    return allowedKeys.has(keyByDefinitionId.get(definitionId) || '')
  })
}
