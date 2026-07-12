import { camundaGet } from '@enterpriseglue/shared/services/bpmn-engine-client.js'

/**
 * Runtime APIs such as jobs and external tasks expose a process definition id
 * rather than its stable authorization key. This helper resolves that lineage
 * server-side and drops entries that cannot be connected to an allowed key.
 */
export async function filterRuntimeItemsByProcessDefinitionKeys<T extends { processDefinitionId?: unknown }>(
  engineId: string,
  items: T[],
  authorizedDefinitionKeys?: string[],
): Promise<T[]> {
  if (!authorizedDefinitionKeys) return items

  const allowedKeys = new Set(authorizedDefinitionKeys)
  const definitionIds = [...new Set(items
    .map((item) => item.processDefinitionId)
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
    const definitionId = typeof item.processDefinitionId === 'string' ? item.processDefinitionId : ''
    return allowedKeys.has(keyByDefinitionId.get(definitionId) || '')
  })
}
