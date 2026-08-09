import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as fallback from './data.mjs'

const moduleDir = path.dirname(fileURLToPath(import.meta.url))

function truthy(value) {
  return value === '1' || value === 'true' || value === 'yes'
}

function byId(items) {
  return new Map((items || []).filter((item) => item?.id).map((item) => [item.id, item]))
}

function mapFromObject(value) {
  return new Map(Object.entries(value || {}))
}

function cloneList(items) {
  return [...(items || [])]
}

function mergeListsById(primaryItems, secondaryItems) {
  const seen = new Set()
  const output = []
  for (const item of [...(primaryItems || []), ...(secondaryItems || [])]) {
    if (!item?.id || seen.has(item.id)) continue
    seen.add(item.id)
    output.push(item)
  }
  return output
}

function mergeMaps(primaryMap, secondaryMap) {
  return new Map([...(secondaryMap?.entries?.() || []), ...(primaryMap?.entries?.() || [])])
}

function bool(value) {
  return value === 'true' || value === '1'
}

function asList(map) {
  return Array.from(map.values()).flat()
}

function loadAdaptedBundle() {
  const useAdaptedBundle = truthy(String(process.env.MOCK_CAMUNDA_USE_ADAPTED_BUNDLE || '')) || !!process.env.MOCK_CAMUNDA_ADAPTED_BUNDLE
  if (!useAdaptedBundle) return null
  const bundlePath = process.env.MOCK_CAMUNDA_ADAPTED_BUNDLE
    ? (path.isAbsolute(process.env.MOCK_CAMUNDA_ADAPTED_BUNDLE)
      ? process.env.MOCK_CAMUNDA_ADAPTED_BUNDLE
      : path.resolve(process.cwd(), process.env.MOCK_CAMUNDA_ADAPTED_BUNDLE))
    : path.resolve(moduleDir, '.generated/latest.json')
  if (!existsSync(bundlePath)) return null
  return JSON.parse(readFileSync(bundlePath, 'utf8'))
}

function createAdaptedSource(bundle) {
  const fallbackSource = createFallbackSource()
  const processDefinitions = cloneList(bundle.processDefinitions)
  const processDefinitionsById = mapFromObject(bundle.processDefinitionsById)
  const runtimeInstances = cloneList(bundle.runtimeInstances)
  const runtimeInstancesById = mapFromObject(bundle.runtimeInstancesById)
  const historicProcessInstances = cloneList(bundle.historicProcessInstances)
  const historicProcessInstancesById = mapFromObject(bundle.historicProcessInstancesById)
  const processInstanceVariables = mapFromObject(bundle.processInstanceVariables)
  const activityTrees = mapFromObject(bundle.activityTrees)
  const activityHistory = mapFromObject(bundle.activityHistory)
  const historicVariables = mapFromObject(bundle.historicVariables)
  const variableHistory = mapFromObject(bundle.variableHistory)
  const historicTasks = mapFromObject(bundle.historicTasks)
  const incidents = mapFromObject(bundle.incidents)
  const jobs = mapFromObject(bundle.jobs)
  const externalTasks = mapFromObject(bundle.externalTasks)
  const processBpmnXml = mapFromObject(bundle.processDefinitionXml)
  const processDefinitionStatisticsById = mapFromObject(bundle.processDefinitionStatistics)
  const decisionDefinitions = cloneList(bundle.decisionDefinitions)
  const decisionDefinitionsById = mapFromObject(bundle.decisionDefinitionsById)
  const decisionDefinitionXmlById = mapFromObject(bundle.decisionDefinitionXml)
  const decisionHistory = mapFromObject(bundle.decisionHistory)
  const decisionInputs = mapFromObject(bundle.decisionInputs)
  const decisionOutputs = mapFromObject(bundle.decisionOutputs)
  const userOperations = mapFromObject(bundle.userOperations)
  const decisionDefinition = bundle.primaryDecisionDefinition || decisionDefinitions[0] || null
  const dmnXml = decisionDefinition ? (decisionDefinitionXmlById.get(decisionDefinition.id) || bundle.primaryDecisionDefinitionXml || '') : ''
  const selectionReasons = bundle.selectionReasons || {}
  const scenarioCoverage = bundle.scenarioCoverage || {}
  const primaryInstanceId = Object.entries(selectionReasons).find(([, meta]) => meta?.selectionReason === 'decision-linked')?.[0]
    || cloneList(historicProcessInstances)[0]?.id
    || null
  const sequentialInstanceId = Object.entries(selectionReasons).find(([, meta]) => meta?.selectionReason === 'sequential')?.[0]
    || scenarioCoverage.sequential?.[0]
    || null
  const parallelInstanceId = Object.entries(selectionReasons).find(([, meta]) => meta?.selectionReason === 'parallel')?.[0]
    || scenarioCoverage.parallel?.[0]
    || null
  const loopInstanceId = Object.entries(selectionReasons).find(([, meta]) => meta?.selectionReason === 'loop')?.[0]
    || scenarioCoverage.loop?.[0]
    || null

  const mergedProcessDefinitions = mergeListsById(processDefinitions, fallbackSource.processDefinitions)
  const mergedRuntimeInstances = mergeListsById(runtimeInstances, fallbackSource.runtimeInstances)
  const mergedHistoricProcessInstances = mergeListsById(historicProcessInstances, fallbackSource.historicProcessInstances)
  const mergedProcessDefinitionsById = mergeMaps(processDefinitionsById, fallbackSource.processDefinitionsById)
  const mergedRuntimeInstancesById = mergeMaps(runtimeInstancesById, fallbackSource.runtimeInstancesById)
  const mergedHistoricProcessInstancesById = mergeMaps(historicProcessInstancesById, fallbackSource.historicProcessInstancesById)
  const mergedProcessInstanceVariables = mergeMaps(processInstanceVariables, fallbackSource.processInstanceVariables)
  const mergedActivityTrees = mergeMaps(activityTrees, fallbackSource.activityTrees)
  const mergedActivityHistory = mergeMaps(activityHistory, fallbackSource.activityHistory)
  const mergedHistoricVariables = mergeMaps(historicVariables, fallbackSource.historicVariables)
  const mergedVariableHistory = mergeMaps(variableHistory, fallbackSource.variableHistory)
  const mergedHistoricTasks = mergeMaps(historicTasks, fallbackSource.historicTasks)
  const mergedIncidents = mergeMaps(incidents, fallbackSource.incidents)
  const mergedJobs = mergeMaps(jobs, fallbackSource.jobs)
  const mergedExternalTasks = mergeMaps(externalTasks, fallbackSource.externalTasks)
  const mergedProcessBpmnXml = mergeMaps(processBpmnXml, fallbackSource.processBpmnXml)
  const mergedProcessDefinitionStatisticsById = mergeMaps(processDefinitionStatisticsById, mapFromObject(Object.fromEntries(Array.from(fallbackSource.processDefinitionsById.keys()).map((id) => [id, fallbackSource.getProcessDefinitionStatistics(id)]))))
  const mergedDecisionDefinitions = mergeListsById(decisionDefinitions, fallbackSource.decisionDefinitions)
  const mergedDecisionDefinitionsById = mergeMaps(decisionDefinitionsById, fallbackSource.decisionDefinitionsById)
  const mergedDecisionDefinitionXmlById = mergeMaps(decisionDefinitionXmlById, fallbackSource.decisionDefinitionXmlById)
  const mergedDecisionHistory = mergeMaps(decisionHistory, mapFromObject(Object.fromEntries(fallbackSource.historicProcessInstances.map((item) => [item.id, fallbackSource.filterDecisionHistory(new URLSearchParams([['processInstanceId', item.id]]))]))))
  const mergedDecisionInputs = mergeMaps(decisionInputs, fallbackSource.decisionInputs)
  const mergedDecisionOutputs = mergeMaps(decisionOutputs, fallbackSource.decisionOutputs)
  const mergedUserOperations = mergeMaps(userOperations, mapFromObject(Object.fromEntries(Array.from(fallbackSource.historicProcessInstancesById.keys()).flatMap((processInstanceId) => {
    const history = fallbackSource.activityHistory.get(processInstanceId) || []
    const executionIds = [...new Set(history.map((entry) => entry?.executionId).filter(Boolean))]
    return executionIds.map((executionId) => [`${processInstanceId}:${executionId}`, fallbackSource.filterUserOperations(new URLSearchParams([['processInstanceId', processInstanceId], ['executionId', executionId]]))])
  }))))

  function byProcessDefinitionId(definitionId) {
    return mergedHistoricProcessInstances.filter((item) => item.processDefinitionId === definitionId).map((item) => item.id)
  }

  function filterProcessDefinitions(searchParams) {
    const key = searchParams.get('key')
    const version = searchParams.get('version')
    const latestVersion = searchParams.get('latestVersion')
    let items = cloneList(mergedProcessDefinitions)
    if (key) items = items.filter((item) => item.key === key)
    if (version) items = items.filter((item) => String(item.version) === String(version))
    if (bool(latestVersion)) {
      const latestByKey = new Map()
      for (const item of items) {
        const current = latestByKey.get(item.key)
        if (!current || item.version > current.version) latestByKey.set(item.key, item)
      }
      items = Array.from(latestByKey.values())
    }
    return items
  }

  function filterRuntimeInstances(searchParams) {
    const processDefinitionId = searchParams.get('processDefinitionId')
    const processDefinitionKey = searchParams.get('processDefinitionKey')
    const processInstanceIdIn = searchParams.get('processInstanceIdIn')
    const suspended = searchParams.get('suspended')
    const withIncident = searchParams.get('withIncident')
    const activityIdIn = searchParams.get('activityIdIn')
    let items = cloneList(mergedRuntimeInstances)
    if (processDefinitionId) items = items.filter((item) => item.definitionId === processDefinitionId)
    if (processDefinitionKey) items = items.filter((item) => item.definitionKey === processDefinitionKey)
    if (processInstanceIdIn) {
      const allowed = new Set(processInstanceIdIn.split(',').map((item) => item.trim()).filter(Boolean))
      items = items.filter((item) => allowed.has(item.id))
    }
    if (suspended !== null) items = items.filter((item) => item.suspended === bool(suspended))
    if (bool(withIncident)) items = items.filter((item) => (mergedIncidents.get(item.id) || []).length > 0)
    if (activityIdIn) {
      const allowedActivityIds = new Set(activityIdIn.split(',').map((item) => item.trim()).filter(Boolean))
      items = items.filter((item) => (mergedActivityHistory.get(item.id) || []).some((entry) => allowedActivityIds.has(entry.activityId) && !entry.endTime))
    }
    return items
  }

  function filterHistoricProcessInstances(searchParams) {
    const processDefinitionId = searchParams.get('processDefinitionId')
    const processDefinitionKey = searchParams.get('processDefinitionKey')
    const processInstanceIdIn = searchParams.get('processInstanceIdIn')
    const superProcessInstanceId = searchParams.get('superProcessInstanceId')
    const finished = searchParams.get('finished')
    const unfinished = searchParams.get('unfinished')
    let items = cloneList(mergedHistoricProcessInstances)
    if (processDefinitionId) items = items.filter((item) => item.processDefinitionId === processDefinitionId)
    if (processDefinitionKey) items = items.filter((item) => item.processDefinitionKey === processDefinitionKey)
    if (processInstanceIdIn) {
      const allowed = new Set(processInstanceIdIn.split(',').map((item) => item.trim()).filter(Boolean))
      items = items.filter((item) => allowed.has(item.id))
    }
    if (superProcessInstanceId) items = items.filter((item) => item.superProcessInstanceId === superProcessInstanceId)
    if (bool(finished)) items = items.filter((item) => !!item.endTime)
    if (bool(unfinished)) items = items.filter((item) => !item.endTime)
    return items
  }

  function filterHistoricActivityInstances(searchParams) {
    const processInstanceId = searchParams.get('processInstanceId')
    const processDefinitionId = searchParams.get('processDefinitionId')
    const unfinished = searchParams.get('unfinished')
    const finished = searchParams.get('finished')
    const canceled = searchParams.get('canceled')
    const firstResult = Number(searchParams.get('firstResult') || '0')
    const maxResults = Number(searchParams.get('maxResults') || '0')
    let items = []
    if (processInstanceId) {
      items = cloneList(mergedActivityHistory.get(processInstanceId) || [])
    } else if (processDefinitionId) {
      const ids = byProcessDefinitionId(processDefinitionId)
      items = ids.flatMap((id) => mergedActivityHistory.get(id) || [])
    }
    if (bool(unfinished)) items = items.filter((item) => !item.endTime)
    if (bool(finished)) items = items.filter((item) => !!item.endTime)
    if (bool(canceled)) items = items.filter((item) => !!item.canceled)
    if (Number.isFinite(firstResult) && firstResult > 0) items = items.slice(firstResult)
    if (Number.isFinite(maxResults) && maxResults > 0) items = items.slice(0, maxResults)
    return items
  }

  function filterHistoricVariables(searchParams) {
    const processInstanceId = searchParams.get('processInstanceId')
    const activityInstanceIdIn = searchParams.get('activityInstanceIdIn')
    let items = processInstanceId ? cloneList(mergedHistoricVariables.get(processInstanceId) || []) : asList(mergedHistoricVariables)
    if (activityInstanceIdIn) {
      const allowed = new Set(activityInstanceIdIn.split(',').map((item) => item.trim()).filter(Boolean))
      items = items.filter((item) => item.activityInstanceId && allowed.has(item.activityInstanceId))
    }
    return items
  }

  function filterIncidents(searchParams) {
    const processInstanceId = searchParams.get('processInstanceId')
    const processInstanceIdIn = searchParams.get('processInstanceIdIn')
    let items = processInstanceId ? cloneList(mergedIncidents.get(processInstanceId) || []) : asList(mergedIncidents)
    if (processInstanceIdIn) {
      const allowed = new Set(processInstanceIdIn.split(',').map((item) => item.trim()).filter(Boolean))
      items = items.filter((item) => allowed.has(item.processInstanceId))
    }
    return items
  }

  function filterJobs(searchParams) {
    const processInstanceId = searchParams.get('processInstanceId')
    let items = processInstanceId ? cloneList(mergedJobs.get(processInstanceId) || []) : asList(mergedJobs)
    if (bool(searchParams.get('withException'))) items = items.filter((item) => !!item.exceptionMessage)
    return items
  }

  function filterExternalTasks(searchParams) {
    const processInstanceId = searchParams.get('processInstanceId')
    return processInstanceId ? cloneList(mergedExternalTasks.get(processInstanceId) || []) : asList(mergedExternalTasks)
  }

  function filterDecisionDefinitions(searchParams) {
    const key = searchParams.get('key')
    let items = cloneList(mergedDecisionDefinitions)
    if (key) items = items.filter((item) => item.key === key)
    return items
  }

  function filterDecisionHistory(searchParams) {
    const processInstanceId = searchParams.get('processInstanceId')
    const decisionDefinitionId = searchParams.get('decisionDefinitionId')
    const activityInstanceIdIn = searchParams.get('activityInstanceIdIn')
    let items = processInstanceId ? cloneList(mergedDecisionHistory.get(processInstanceId) || []) : asList(mergedDecisionHistory)
    if (decisionDefinitionId) items = items.filter((item) => item.decisionDefinitionId === decisionDefinitionId)
    if (activityInstanceIdIn) {
      const allowed = new Set(activityInstanceIdIn.split(',').map((item) => item.trim()).filter(Boolean))
      items = items.filter((item) => item.activityInstanceId && allowed.has(item.activityInstanceId))
    }
    return items
  }

  function filterHistoricTasks(searchParams) {
    const processInstanceId = searchParams.get('processInstanceId')
    const activityInstanceIdIn = searchParams.get('activityInstanceIdIn')
    let items = processInstanceId ? cloneList(mergedHistoricTasks.get(processInstanceId) || []) : asList(mergedHistoricTasks)
    if (activityInstanceIdIn) {
      const allowed = new Set(activityInstanceIdIn.split(',').map((item) => item.trim()).filter(Boolean))
      items = items.filter((item) => item.activityInstanceId && allowed.has(item.activityInstanceId))
    }
    return items
  }

  function filterUserOperations(searchParams) {
    const processInstanceId = searchParams.get('processInstanceId')
    const executionId = searchParams.get('executionId')
    if (!processInstanceId || !executionId) return []
    return cloneList(mergedUserOperations.get(`${processInstanceId}:${executionId}`) || [])
  }

  function getProcessDefinitionStatistics(processDefinitionId) {
    return cloneList(mergedProcessDefinitionStatisticsById.get(processDefinitionId) || [])
  }

  return {
    primaryInstanceId,
    sequentialInstanceId,
    parallelInstanceId,
    loopInstanceId,
    processDefinitions: mergedProcessDefinitions,
    processDefinitionsById: mergedProcessDefinitionsById,
    runtimeInstances: mergedRuntimeInstances,
    runtimeInstancesById: mergedRuntimeInstancesById,
    historicProcessInstances: mergedHistoricProcessInstances,
    historicProcessInstancesById: mergedHistoricProcessInstancesById,
    processInstanceVariables: mergedProcessInstanceVariables,
    activityTrees: mergedActivityTrees,
    activityHistory: mergedActivityHistory,
    historicVariables: mergedHistoricVariables,
    variableHistory: mergedVariableHistory,
    historicTasks: mergedHistoricTasks,
    incidents: mergedIncidents,
    jobs: mergedJobs,
    externalTasks: mergedExternalTasks,
    decisionDefinition,
    decisionDefinitions: mergedDecisionDefinitions,
    decisionDefinitionsById: mergedDecisionDefinitionsById,
    dmnXml,
    decisionDefinitionXmlById: mergedDecisionDefinitionXmlById,
    processBpmnXml: mergedProcessBpmnXml,
    decisionInputs: mergedDecisionInputs,
    decisionOutputs: mergedDecisionOutputs,
    filterProcessDefinitions,
    filterRuntimeInstances,
    filterHistoricProcessInstances,
    filterHistoricActivityInstances,
    filterHistoricVariables,
    filterIncidents,
    filterJobs,
    filterExternalTasks,
    filterDecisionDefinitions,
    filterDecisionHistory,
    filterHistoricTasks,
    filterUserOperations,
    getProcessDefinitionStatistics,
  }
}

function createFallbackSource() {
  return {
    ...fallback,
    decisionDefinitions: fallback.decisionDefinition ? [fallback.decisionDefinition] : [],
    decisionDefinitionsById: fallback.decisionDefinition ? new Map([[fallback.decisionDefinition.id, fallback.decisionDefinition]]) : new Map(),
    decisionDefinitionXmlById: fallback.decisionDefinition && fallback.dmnXml ? new Map([[fallback.decisionDefinition.id, fallback.dmnXml]]) : new Map(),
  }
}

const adaptedBundle = loadAdaptedBundle()
const source = adaptedBundle ? createAdaptedSource(adaptedBundle) : createFallbackSource()

// Camunda's deployment endpoint is needed by metadata reconciliation.  Keep the
// fixture derived from the definitions instead of maintaining a second,
// potentially divergent catalogue of deployment IDs.
const derivedDeployments = Array.from(new Map(
  [...source.processDefinitions, ...source.decisionDefinitions]
    .filter((definition) => definition?.deploymentId)
    .map((definition) => [definition.deploymentId, {
      id: definition.deploymentId,
      name: `Synthetic ${definition.deploymentId}`,
      source: 'enterpriseglue-e2e',
      deploymentTime: '2026-03-01T00:00:00.000Z',
      tenantId: definition.tenantId || null,
    }]),
).values())

export const primaryInstanceId = source.primaryInstanceId
export const sequentialInstanceId = source.sequentialInstanceId
export const parallelInstanceId = source.parallelInstanceId
export const loopInstanceId = source.loopInstanceId
export const processDefinitions = source.processDefinitions
export const deployments = derivedDeployments
export const nativeAuthorizations = source.nativeAuthorizations || []
export const filterNativeAuthorizations = source.filterNativeAuthorizations || ((searchParams) => {
  const firstResult = Math.max(Number(searchParams.get('firstResult') || 0), 0)
  const maxResults = Math.max(Number(searchParams.get('maxResults') || nativeAuthorizations.length), 0)
  return nativeAuthorizations.slice(firstResult, firstResult + maxResults)
})
export const processDefinitionsById = source.processDefinitionsById
export const runtimeInstances = source.runtimeInstances
export const runtimeInstancesById = source.runtimeInstancesById
export const historicProcessInstances = source.historicProcessInstances
export const historicProcessInstancesById = source.historicProcessInstancesById
export const processInstanceVariables = source.processInstanceVariables
export const activityTrees = source.activityTrees
export const activityHistory = source.activityHistory
export const historicVariables = source.historicVariables
export const variableHistory = source.variableHistory
export const historicTasks = source.historicTasks
export const incidents = source.incidents
export const jobs = source.jobs
export const externalTasks = source.externalTasks
export const decisionDefinition = source.decisionDefinition
export const decisionDefinitions = source.decisionDefinitions
export const decisionDefinitionsById = source.decisionDefinitionsById
export const dmnXml = source.dmnXml
export const decisionDefinitionXmlById = source.decisionDefinitionXmlById
export const processBpmnXml = source.processBpmnXml
export const decisionInputs = source.decisionInputs
export const decisionOutputs = source.decisionOutputs
export const filterProcessDefinitions = source.filterProcessDefinitions
export const filterRuntimeInstances = source.filterRuntimeInstances
export const filterHistoricProcessInstances = source.filterHistoricProcessInstances
export const filterHistoricActivityInstances = source.filterHistoricActivityInstances
export const filterHistoricVariables = source.filterHistoricVariables
export const filterIncidents = source.filterIncidents
export const filterJobs = source.filterJobs
export const filterExternalTasks = source.filterExternalTasks
export const filterDecisionDefinitions = source.filterDecisionDefinitions
export const filterDecisionHistory = source.filterDecisionHistory
export const filterHistoricTasks = source.filterHistoricTasks
export const filterUserOperations = source.filterUserOperations
export const getProcessDefinitionStatistics = source.getProcessDefinitionStatistics
