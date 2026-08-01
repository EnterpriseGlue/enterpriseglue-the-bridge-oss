import {
  processDefinitionsById,
  deployments,
  runtimeInstancesById,
  historicProcessInstancesById,
  processInstanceVariables,
  activityTrees,
  historicVariables,
  variableHistory,
  decisionDefinition,
  decisionDefinitionsById,
  decisionDefinitionXmlById,
  dmnXml,
  processBpmnXml,
  decisionInputs,
  decisionOutputs,
  filterProcessDefinitions,
  filterNativeAuthorizations,
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
} from './data-runtime.mjs'

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

function sendNoContent(res) {
  res.writeHead(204)
  res.end()
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve(null)
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function toSearchParams(source) {
  const params = new URLSearchParams()
  if (!source || typeof source !== 'object') return params
  for (const [key, rawValue] of Object.entries(source)) {
    if (rawValue === undefined || rawValue === null) continue
    if (Array.isArray(rawValue)) {
      if (rawValue.length === 0) continue
      params.set(key, rawValue.join(','))
      continue
    }
    params.set(key, String(rawValue))
  }
  return params
}

function flattenMapValues(map) {
  return Array.from(map.values()).flat()
}

function getHistoricVariableSnapshotById(id) {
  return flattenMapValues(historicVariables).find((entry) => entry.id === id) || null
}

function getDecisionInputsById(id) {
  return decisionInputs.get(id) || []
}

function getDecisionOutputsById(id) {
  return decisionOutputs.get(id) || []
}

const partitionedRuntimePathPrefix = '/e2e-shared-engine-rest'
const standardRuntimePathPrefix = '/engine-rest'

function withPartitionedRuntimeTenant(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return item
  }
  const identity = String(
    item.key
      || item.definitionKey
      || item.processDefinitionKey
      || item.decisionDefinitionKey
      || item.id
      || '',
  )
  return {
    ...item,
    tenantId: /(sequential|rework|risk)/i.test(identity)
      ? 'e2e-runtime-green'
      : 'e2e-runtime-blue',
  }
}

function withPartitionedRuntimeTenants(value) {
  return Array.isArray(value)
    ? value.map(withPartitionedRuntimeTenant)
    : withPartitionedRuntimeTenant(value)
}

export function createMockCamundaHandler() {
  const requestLedger = new Map()

  function recordRequest(method, pathname) {
    const key = `${method} ${pathname}`
    requestLedger.set(key, (requestLedger.get(key) || 0) + 1)
  }

  return async function mockCamundaHandler(req, res) {
    try {
      const requestedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
      const partitionRuntimeTenants = requestedUrl.pathname === partitionedRuntimePathPrefix
        || requestedUrl.pathname.startsWith(`${partitionedRuntimePathPrefix}/`)
      if (partitionRuntimeTenants) {
        requestedUrl.pathname = `${standardRuntimePathPrefix}${requestedUrl.pathname.slice(partitionedRuntimePathPrefix.length)}`
      }
      const url = requestedUrl
      const { pathname, searchParams } = url
      const routePath = decodeURIComponent(pathname)

      if (pathname === '/health') {
        sendJson(res, 200, { ok: true })
        return
      }

      if (req.method === 'POST' && pathname === '/__e2e/requests/reset') {
        requestLedger.clear()
        sendNoContent(res)
        return
      }

      if (req.method === 'GET' && pathname === '/__e2e/requests') {
        sendJson(res, 200, {
          total: Array.from(requestLedger.values()).reduce((sum, count) => sum + count, 0),
          requests: Array.from(requestLedger.entries())
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([request, count]) => ({ request, count })),
        })
        return
      }

      recordRequest(req.method || 'GET', pathname)

      // Operaton exposes the Camunda 7-compatible `/version` endpoint. The
      // local acceptance stack uses this response for connection health and
      // adapter-version evidence.
      if (req.method === 'GET' && pathname === '/engine-rest/version') {
        sendJson(res, 200, { version: '2.1.0', productName: 'Operaton' })
        return
      }

      if (req.method === 'GET' && pathname === '/engine-rest/process-definition') {
        const definitions = filterProcessDefinitions(searchParams)
        sendJson(
          res,
          200,
          partitionRuntimeTenants ? withPartitionedRuntimeTenants(definitions) : definitions,
        )
        return
      }

      if (req.method === 'GET' && pathname === '/engine-rest/deployment') {
        sendJson(
          res,
          200,
          partitionRuntimeTenants ? withPartitionedRuntimeTenants(deployments) : deployments,
        )
        return
      }

      if (req.method === 'GET' && pathname === '/engine-rest/authorization') {
        sendJson(res, 200, filterNativeAuthorizations(searchParams))
        return
      }

      if (req.method === 'GET' && routePath.startsWith('/engine-rest/process-definition/') && routePath.endsWith('/xml')) {
        const id = routePath.slice('/engine-rest/process-definition/'.length, -'/xml'.length)
        const xml = processBpmnXml.get(id)
        if (!xml) {
          sendJson(res, 404, { message: `Unknown process definition XML: ${id}` })
          return
        }
        sendJson(res, 200, { id, bpmn20Xml: xml })
        return
      }

      if (req.method === 'GET' && routePath.startsWith('/engine-rest/process-definition/') && routePath.endsWith('/statistics')) {
        const id = routePath.slice('/engine-rest/process-definition/'.length, -'/statistics'.length)
        sendJson(res, 200, getProcessDefinitionStatistics(id))
        return
      }

      if (req.method === 'GET' && routePath.startsWith('/engine-rest/process-definition/')) {
        const id = routePath.slice('/engine-rest/process-definition/'.length)
        const item = processDefinitionsById.get(id)
        if (!item) {
          sendJson(res, 404, { message: `Unknown process definition: ${id}` })
          return
        }
        sendJson(res, 200, partitionRuntimeTenants ? withPartitionedRuntimeTenant(item) : item)
        return
      }

      if (req.method === 'POST' && pathname === '/engine-rest/process-instance/count') {
        const body = await parseBody(req)
        const params = toSearchParams(body)
        sendJson(res, 200, { count: filterRuntimeInstances(params).length })
        return
      }

      if (req.method === 'GET' && pathname === '/engine-rest/process-instance') {
        const instances = filterRuntimeInstances(searchParams)
        sendJson(
          res,
          200,
          partitionRuntimeTenants ? withPartitionedRuntimeTenants(instances) : instances,
        )
        return
      }

      if (req.method === 'GET' && routePath.startsWith('/engine-rest/process-instance/') && routePath.endsWith('/activity-instances')) {
        const id = routePath.slice('/engine-rest/process-instance/'.length, -'/activity-instances'.length)
        const tree = activityTrees.get(id)
        if (!tree) {
          sendJson(res, 404, { message: `Unknown process instance activity tree: ${id}` })
          return
        }
        sendJson(res, 200, tree)
        return
      }

      if (req.method === 'GET' && routePath.startsWith('/engine-rest/process-instance/') && routePath.endsWith('/variables')) {
        const id = routePath.slice('/engine-rest/process-instance/'.length, -'/variables'.length)
        sendJson(res, 200, processInstanceVariables.get(id) || {})
        return
      }

      // Preserve Camunda's `modifications` request contract for the browser
      // evidence lane. The state lives only in this disposable mock process,
      // allowing an editor test to prove a permitted write reaches the engine
      // and is returned on the next read without touching a real engine.
      if (req.method === 'POST' && routePath.startsWith('/engine-rest/process-instance/') && routePath.endsWith('/variables')) {
        const id = routePath.slice('/engine-rest/process-instance/'.length, -'/variables'.length)
        if (!runtimeInstancesById.has(id) && !historicProcessInstancesById.has(id)) {
          sendJson(res, 404, { message: `Unknown process instance: ${id}` })
          return
        }
        const body = await parseBody(req)
        const modifications = body?.modifications
        if (!modifications || typeof modifications !== 'object' || Array.isArray(modifications)) {
          sendJson(res, 400, { message: 'Variable modifications are required' })
          return
        }
        const nextVariables = { ...(processInstanceVariables.get(id) || {}) }
        for (const [name, variable] of Object.entries(modifications)) {
          if (!name) continue
          if (variable === null) {
            delete nextVariables[name]
          } else {
            nextVariables[name] = variable
          }
        }
        processInstanceVariables.set(id, nextVariables)
        sendNoContent(res)
        return
      }

      if (req.method === 'GET' && routePath.startsWith('/engine-rest/process-instance/')) {
        const id = routePath.slice('/engine-rest/process-instance/'.length)
        const item = runtimeInstancesById.get(id)
        if (!item) {
          sendJson(res, 404, { message: `Unknown process instance: ${id}` })
          return
        }
        sendJson(res, 200, partitionRuntimeTenants ? withPartitionedRuntimeTenant(item) : item)
        return
      }

      if (req.method === 'GET' && pathname === '/engine-rest/history/process-instance') {
        const instances = filterHistoricProcessInstances(searchParams)
        sendJson(
          res,
          200,
          partitionRuntimeTenants ? withPartitionedRuntimeTenants(instances) : instances,
        )
        return
      }

      if (req.method === 'GET' && routePath.startsWith('/engine-rest/history/process-instance/')) {
        const id = routePath.slice('/engine-rest/history/process-instance/'.length)
        const item = historicProcessInstancesById.get(id)
        if (!item) {
          sendJson(res, 404, { message: `Unknown historic process instance: ${id}` })
          return
        }
        sendJson(res, 200, partitionRuntimeTenants ? withPartitionedRuntimeTenant(item) : item)
        return
      }

      if (req.method === 'GET' && pathname === '/engine-rest/history/activity-instance') {
        sendJson(res, 200, filterHistoricActivityInstances(searchParams))
        return
      }

      if (req.method === 'GET' && pathname === '/engine-rest/history/variable-instance') {
        sendJson(res, 200, filterHistoricVariables(searchParams))
        return
      }

      if (req.method === 'GET' && routePath.startsWith('/engine-rest/history/variable-instance/')) {
        const id = routePath.slice('/engine-rest/history/variable-instance/'.length)
        const item = getHistoricVariableSnapshotById(id)
        if (!item) {
          sendJson(res, 404, { message: `Unknown historic variable: ${id}` })
          return
        }
        sendJson(res, 200, item)
        return
      }

      if (req.method === 'GET' && pathname === '/engine-rest/history/detail') {
        const variableInstanceId = searchParams.get('variableInstanceId')
        if (!variableInstanceId) {
          sendJson(res, 200, [])
          return
        }
        sendJson(res, 200, variableHistory.get(variableInstanceId) || [])
        return
      }

      if (req.method === 'GET' && pathname === '/engine-rest/history/task') {
        sendJson(res, 200, filterHistoricTasks(searchParams))
        return
      }

      if (req.method === 'GET' && pathname === '/engine-rest/task') {
        const runtimeTasks = [
          {
            id: 'task-review-primary',
            name: 'Review Invoice',
            assignee: 'demo.reviewer',
            created: '2026-03-09T10:00:02.000Z',
            executionId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
            processInstanceId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
            processDefinitionId: 'invoice-process:3:mock-process-definition',
            processDefinitionKey: 'invoice-process',
            taskDefinitionKey: 'Activity_Review',
            suspended: false,
            tenantId: null,
          },
          {
            id: 'task-sequential-review',
            name: 'Review Line Item',
            assignee: 'sequential.approver.3',
            created: '2026-03-09T11:04:04.000Z',
            executionId: 'Execution_seq_review_3',
            processInstanceId: '11111111-2222-4333-8444-555555555555',
            processDefinitionId: 'invoice-sequential-review:1:mock-process-definition',
            processDefinitionKey: 'invoice-sequential-review',
            taskDefinitionKey: 'Activity_SequentialReview',
            suspended: false,
            tenantId: null,
          },
        ]
        const processDefinitionKey = searchParams.get('processDefinitionKey')
        const filtered = processDefinitionKey
          ? runtimeTasks.filter((task) => task.processDefinitionKey === processDefinitionKey)
          : runtimeTasks
        sendJson(
          res,
          200,
          partitionRuntimeTenants ? withPartitionedRuntimeTenants(filtered) : filtered,
        )
        return
      }

      if (req.method === 'GET' && pathname === '/engine-rest/incident') {
        const incidents = filterIncidents(searchParams)
        sendJson(
          res,
          200,
          partitionRuntimeTenants ? withPartitionedRuntimeTenants(incidents) : incidents,
        )
        return
      }

      if (req.method === 'GET' && pathname === '/engine-rest/job') {
        const jobs = filterJobs(searchParams)
        sendJson(
          res,
          200,
          partitionRuntimeTenants ? withPartitionedRuntimeTenants(jobs) : jobs,
        )
        return
      }

      if (req.method === 'GET' && pathname === '/engine-rest/external-task') {
        sendJson(res, 200, filterExternalTasks(searchParams))
        return
      }

      if (req.method === 'GET' && pathname === '/engine-rest/decision-definition') {
        const definitions = filterDecisionDefinitions(searchParams)
        sendJson(
          res,
          200,
          partitionRuntimeTenants ? withPartitionedRuntimeTenants(definitions) : definitions,
        )
        return
      }

      if (req.method === 'GET' && routePath.startsWith('/engine-rest/decision-definition/') && routePath.endsWith('/xml')) {
        const id = routePath.slice('/engine-rest/decision-definition/'.length, -'/xml'.length)
        const xml = decisionDefinitionXmlById.get(id) || (decisionDefinition?.id === id ? dmnXml : null)
        if (!xml) {
          sendJson(res, 404, { message: `Unknown decision definition XML: ${id}` })
          return
        }
        sendJson(res, 200, { id, dmnXml: xml })
        return
      }

      if (req.method === 'GET' && routePath.startsWith('/engine-rest/decision-definition/')) {
        const id = routePath.slice('/engine-rest/decision-definition/'.length)
        const item = decisionDefinitionsById.get(id) || (decisionDefinition?.id === id ? decisionDefinition : null)
        if (!item) {
          sendJson(res, 404, { message: `Unknown decision definition: ${id}` })
          return
        }
        sendJson(res, 200, partitionRuntimeTenants ? withPartitionedRuntimeTenant(item) : item)
        return
      }

      if (req.method === 'GET' && pathname === '/engine-rest/history/decision-instance') {
        sendJson(res, 200, filterDecisionHistory(searchParams))
        return
      }

      if (req.method === 'GET' && routePath.startsWith('/engine-rest/history/decision-instance/') && routePath.endsWith('/inputs')) {
        const id = routePath.slice('/engine-rest/history/decision-instance/'.length, -'/inputs'.length)
        sendJson(res, 200, getDecisionInputsById(id))
        return
      }

      if (req.method === 'GET' && routePath.startsWith('/engine-rest/history/decision-instance/') && routePath.endsWith('/outputs')) {
        const id = routePath.slice('/engine-rest/history/decision-instance/'.length, -'/outputs'.length)
        sendJson(res, 200, getDecisionOutputsById(id))
        return
      }

      if (req.method === 'GET' && pathname === '/engine-rest/user-operation') {
        sendJson(res, 200, filterUserOperations(searchParams))
        return
      }

      if (req.method === 'PUT' && routePath.startsWith('/engine-rest/process-instance/') && routePath.endsWith('/suspended')) {
        await parseBody(req)
        sendNoContent(res)
        return
      }

      if (req.method === 'PUT' && pathname.startsWith('/engine-rest/job/')) {
        await parseBody(req)
        sendNoContent(res)
        return
      }

      if (req.method === 'DELETE' && routePath.startsWith('/engine-rest/process-instance/')) {
        sendNoContent(res)
        return
      }

      sendJson(res, 404, {
        message: `Unhandled mock route: ${req.method} ${pathname}`,
      })
    } catch (error) {
      sendJson(res, 500, {
        message: error instanceof Error ? error.message : 'Unknown mock server error',
      })
    }
  }
}
