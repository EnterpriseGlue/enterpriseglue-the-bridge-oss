import { getAuthzActionDefinition } from '@enterpriseglue/shared/authz/permission-actions.js'
import { permissionService } from '@enterpriseglue/shared/services/platform-admin/permissions.js'

export interface RuntimeRowActionDecision {
  allowed: boolean
  reason?: string
}

export interface RuntimeProcessInstanceActionDecisions {
  suspension: RuntimeRowActionDecision
  retry: RuntimeRowActionDecision
  terminate: RuntimeRowActionDecision
}

const ACTIONS = {
  suspension: 'engine.runtime.process-instances.suspension.update',
  retry: 'engine.runtime.process-instances.retry',
  terminate: 'engine.runtime.process-instances.delete',
} as const

function processDefinitionKey(row: object): string {
  const candidate = row as Record<string, unknown>
  const key = typeof candidate.processDefinitionKey === 'string'
    ? candidate.processDefinitionKey
    : typeof candidate.definitionKey === 'string' ? candidate.definitionKey : ''
  return key.trim()
}

function unavailable(): RuntimeRowActionDecision {
  return { allowed: false, reason: 'Action unavailable for this runtime resource' }
}

/**
 * Produces only boolean availability and a generic reason for rows that have
 * already passed the collection visibility filter. The browser intentionally
 * receives no runtime-resource grants in its permission snapshot, so this
 * keeps row-action UX aligned with the same evaluator used by mutation routes.
 */
export async function addRuntimeProcessInstanceActionDecisions<T extends object>(input: {
  userId: string
  tenantId?: string | null
  engineId: string
  runtimeAccessScope: 'engine_wide' | 'resource_aware'
  rows: T[]
}): Promise<Array<T & { runtimeActionDecisions: RuntimeProcessInstanceActionDecisions }>> {
  const entries = await Promise.all(Object.entries(ACTIONS).map(async ([name, actionId]) => {
    const action = getAuthzActionDefinition(actionId)
    if (!action) throw new Error(`Unknown authorization action: ${actionId}`)
    const context = {
      userId: input.userId,
      tenantId: input.tenantId || null,
      resourceType: 'engine' as const,
      resourceId: input.engineId,
    }
    const broad = await permissionService.hasPermission(action.permissionId, context)
    const allowedKeys = broad || input.runtimeAccessScope !== 'resource_aware'
      ? null
      : new Set((await permissionService.getVisibleRuntimeResources({
          userId: input.userId,
          tenantId: input.tenantId || null,
          engineId: input.engineId,
          resourceKind: 'process_definition',
          permission: action.permissionId,
          limit: 5_000,
        })).map((resource) => resource.resourceKey))
    return [name as keyof typeof ACTIONS, broad, allowedKeys] as const
  }))

  const decisionsByAction = new Map(entries.map(([name, broad, allowedKeys]) => [name, { broad, allowedKeys }]))
  return input.rows.map((row) => {
    const key = processDefinitionKey(row)
    const decisionFor = (name: keyof typeof ACTIONS): RuntimeRowActionDecision => {
      const decision = decisionsByAction.get(name)!
      if (decision.broad || (decision.allowedKeys?.has(key) ?? false)) return { allowed: true }
      return unavailable()
    }
    return {
      ...row,
      runtimeActionDecisions: {
        suspension: decisionFor('suspension'),
        retry: decisionFor('retry'),
        terminate: decisionFor('terminate'),
      },
    }
  })
}
