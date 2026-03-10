import path from 'node:path'

function parseArgs(argv) {
  const options = {
    baseUrl: process.env.CAMUNDA_BASE_URL || 'http://localhost:8080/engine-rest',
    username: process.env.CAMUNDA_USERNAME || 'demo',
    password: process.env.CAMUNDA_PASSWORD || 'demo',
    outputDir: process.env.MOCK_CAMUNDA_RAW_DIR || path.resolve(process.cwd(), '.local/mock-camunda/raw'),
    maxResults: Number(process.env.CAMUNDA_MAX_RESULTS || 100),
    processDefinitionKeys: [],
    decisionDefinitionKeys: [],
    processInstanceIds: [],
    historicProcessInstanceIds: [],
  }

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    const next = argv[index + 1]
    if (token === '--base-url' && next) {
      options.baseUrl = next
      index += 1
      continue
    }
    if (token === '--username' && next) {
      options.username = next
      index += 1
      continue
    }
    if (token === '--password' && next) {
      options.password = next
      index += 1
      continue
    }
    if (token === '--output-dir' && next) {
      options.outputDir = path.resolve(process.cwd(), next)
      index += 1
      continue
    }
    if (token === '--max-results' && next) {
      options.maxResults = Number(next)
      index += 1
      continue
    }
    if (token === '--process-definition-key' && next) {
      options.processDefinitionKeys.push(next)
      index += 1
      continue
    }
    if (token === '--decision-definition-key' && next) {
      options.decisionDefinitionKeys.push(next)
      index += 1
      continue
    }
    if (token === '--process-instance-id' && next) {
      options.processInstanceIds.push(next)
      index += 1
      continue
    }
    if (token === '--historic-process-instance-id' && next) {
      options.historicProcessInstanceIds.push(next)
      index += 1
      continue
    }
  }

  return options
}

function buildAuthHeaders(username, password) {
  const token = Buffer.from(`${username}:${password}`).toString('base64')
  return {
    authorization: `Basic ${token}`,
    'content-type': 'application/json',
    accept: 'application/json',
  }
}

function buildUrl(baseUrl, endpoint, searchParams) {
  const url = new URL(endpoint.replace(/^\//, ''), baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`)
  for (const [key, value] of Object.entries(searchParams || {})) {
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item === undefined || item === null || item === '') continue
        url.searchParams.append(key, String(item))
      }
      continue
    }
    url.searchParams.set(key, String(value))
  }
  return url
}

async function fetchJson(baseUrl, headers, endpoint, searchParams) {
  const url = buildUrl(baseUrl, endpoint, searchParams)
  const response = await fetch(url, { method: 'GET', headers })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}${text ? ` ${text}` : ''}`)
  }
  return response.json()
}

async function fetchJsonOptional(baseUrl, headers, endpoint, searchParams, warnings, warningCode) {
  const url = buildUrl(baseUrl, endpoint, searchParams)
  const response = await fetch(url, { method: 'GET', headers })
  if (response.ok) return response.json()
  const text = await response.text().catch(() => '')
  warnings.push({
    code: warningCode,
    url: url.toString(),
    status: response.status,
    statusText: response.statusText,
    body: text,
  })
  return null
}

async function fetchJsonOrNull(baseUrl, headers, endpoint, searchParams) {
  const url = buildUrl(baseUrl, endpoint, searchParams)
  const response = await fetch(url, { method: 'GET', headers })
  if (response.status === 404) return null
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}${text ? ` ${text}` : ''}`)
  }
  return response.json()
}

async function fetchAllPages(baseUrl, headers, endpoint, searchParams, maxResults) {
  const items = []
  let firstResult = 0
  for (;;) {
    const page = await fetchJson(baseUrl, headers, endpoint, {
      ...searchParams,
      firstResult,
      maxResults,
    })
    if (!Array.isArray(page)) {
      return page
    }
    items.push(...page)
    if (page.length < maxResults) break
    firstResult += page.length
  }
  return items
}

function collectProcessInstanceIds(options, runtimeInstances, historicProcessInstances) {
  const selected = new Set()
  for (const id of options.processInstanceIds) selected.add(id)
  for (const id of options.historicProcessInstanceIds) selected.add(id)
  for (const item of runtimeInstances || []) selected.add(item.id)
  for (const item of historicProcessInstances || []) selected.add(item.id)
  return Array.from(selected)
}

function uniqueStrings(values) {
  return Array.from(new Set((values || []).filter((value) => typeof value === 'string' && value.trim() !== '').map((value) => value.trim())))
}

function findRepeatedActivityIds(activityHistory) {
  const counts = new Map()
  for (const entry of activityHistory || []) {
    const activityId = entry?.activityId
    if (!activityId) continue
    counts.set(activityId, (counts.get(activityId) || 0) + 1)
  }
  return Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([activityId, count]) => ({ activityId, count }))
}

function getTreeSiblingSignals(node, signals = []) {
  const children = Array.isArray(node?.childActivityInstances) ? node.childActivityInstances : []
  if (children.length > 1) {
    const activityCounts = new Map()
    for (const child of children) {
      if (!child?.activityId) continue
      activityCounts.set(child.activityId, (activityCounts.get(child.activityId) || 0) + 1)
    }
    for (const [activityId, count] of activityCounts.entries()) {
      if (count > 1) {
        signals.push({ parentActivityId: node?.activityId || null, activityId, count })
      }
    }
  }
  for (const child of children) {
    getTreeSiblingSignals(child, signals)
  }
  return signals
}

function intervalsOverlap(left, right) {
  const leftStart = left?.startTime ? Date.parse(left.startTime) : Number.NaN
  const rightStart = right?.startTime ? Date.parse(right.startTime) : Number.NaN
  const leftEnd = left?.endTime ? Date.parse(left.endTime) : Number.POSITIVE_INFINITY
  const rightEnd = right?.endTime ? Date.parse(right.endTime) : Number.POSITIVE_INFINITY
  if (!Number.isFinite(leftStart) || !Number.isFinite(rightStart)) return false
  return leftStart < rightEnd && rightStart < leftEnd
}

function getParallelHistorySignals(activityHistory) {
  const byActivity = new Map()
  for (const entry of activityHistory || []) {
    if (!entry?.activityId) continue
    const list = byActivity.get(entry.activityId) || []
    list.push(entry)
    byActivity.set(entry.activityId, list)
  }

  const signals = []
  for (const [activityId, entries] of byActivity.entries()) {
    if (entries.length < 2) continue
    const overlaps = []
    for (let index = 0; index < entries.length; index += 1) {
      for (let inner = index + 1; inner < entries.length; inner += 1) {
        const left = entries[index]
        const right = entries[inner]
        if (left?.executionId && right?.executionId && left.executionId === right.executionId) continue
        if (!intervalsOverlap(left, right)) continue
        overlaps.push({
          leftExecutionId: left?.executionId || null,
          rightExecutionId: right?.executionId || null,
          leftActivityInstanceId: left?.activityInstanceId || null,
          rightActivityInstanceId: right?.activityInstanceId || null,
          leftStartTime: left?.startTime || null,
          rightStartTime: right?.startTime || null,
        })
      }
    }
    if (overlaps.length === 0) continue
    signals.push({
      activityId,
      activityType: entries[0]?.activityType || null,
      overlapCount: overlaps.length,
      distinctExecutionCount: uniqueStrings(entries.map((entry) => entry?.executionId)).length,
      parentActivityInstanceIds: uniqueStrings(entries.map((entry) => entry?.parentActivityInstanceId)),
      overlaps,
    })
  }
  return signals
}

function analyzeCandidates(processInstanceSnapshots) {
  const parallel = []
  const sequential = []
  const loop = []

  for (const snapshot of processInstanceSnapshots) {
    const repeated = findRepeatedActivityIds(snapshot.activityHistory)
    const siblingSignals = getTreeSiblingSignals(snapshot.activityTree)
    const parallelHistorySignals = getParallelHistorySignals(snapshot.activityHistory)
    const unfinishedRepeated = repeated.filter(({ activityId }) => {
      const matches = (snapshot.activityHistory || []).filter((entry) => entry.activityId === activityId)
      return matches.filter((entry) => !entry.endTime).length === 1
    })
    const repeatedGateways = repeated.filter(({ activityId }) => {
      return (snapshot.activityHistory || []).some((entry) => entry.activityId === activityId && String(entry.activityType || '').toLowerCase().includes('gateway'))
    })

    if (siblingSignals.length > 0 || parallelHistorySignals.length > 0) {
      parallel.push({
        processInstanceId: snapshot.processInstanceId,
        processDefinitionId: snapshot.processDefinitionId,
        siblingSignals,
        parallelHistorySignals,
        repeatedActivityIds: repeated,
      })
    }

    if (unfinishedRepeated.length > 0) {
      sequential.push({
        processInstanceId: snapshot.processInstanceId,
        processDefinitionId: snapshot.processDefinitionId,
        repeatedActivityIds: unfinishedRepeated,
      })
    }

    if (repeatedGateways.length > 0 || repeated.length > 1) {
      loop.push({
        processInstanceId: snapshot.processInstanceId,
        processDefinitionId: snapshot.processDefinitionId,
        repeatedActivityIds: repeated,
        repeatedGateways,
      })
    }
  }

  return { parallel, sequential, loop }
}

async function harvestProcessDefinitionArtifacts(baseUrl, headers, processDefinitions) {
  const details = {}
  const xmlById = {}
  const statisticsById = {}
  for (const definition of processDefinitions) {
    details[definition.id] = await fetchJsonOrNull(baseUrl, headers, `/process-definition/${encodeURIComponent(definition.id)}`)
    xmlById[definition.id] = await fetchJsonOrNull(baseUrl, headers, `/process-definition/${encodeURIComponent(definition.id)}/xml`)
    statisticsById[definition.id] = await fetchJsonOrNull(baseUrl, headers, `/process-definition/${encodeURIComponent(definition.id)}/statistics`)
  }
  return { details, xmlById, statisticsById }
}

async function harvestDecisionDefinitionArtifacts(baseUrl, headers, decisionDefinitions) {
  const details = {}
  const xmlById = {}
  for (const definition of decisionDefinitions) {
    details[definition.id] = await fetchJsonOrNull(baseUrl, headers, `/decision-definition/${encodeURIComponent(definition.id)}`)
    xmlById[definition.id] = await fetchJsonOrNull(baseUrl, headers, `/decision-definition/${encodeURIComponent(definition.id)}/xml`)
  }
  return { details, xmlById }
}

async function harvestProcessInstanceArtifacts(baseUrl, headers, processInstanceIds, warnings) {
  const items = []
  for (const processInstanceId of processInstanceIds) {
    const runtime = await fetchJsonOrNull(baseUrl, headers, `/process-instance/${encodeURIComponent(processInstanceId)}`)
    const historic = await fetchJsonOrNull(baseUrl, headers, `/history/process-instance/${encodeURIComponent(processInstanceId)}`)
    const activityTree = await fetchJsonOptional(baseUrl, headers, `/process-instance/${encodeURIComponent(processInstanceId)}/activity-instances`, undefined, warnings, 'runtime-activity-tree-unavailable')
    const variables = await fetchJsonOptional(baseUrl, headers, `/process-instance/${encodeURIComponent(processInstanceId)}/variables`, undefined, warnings, 'runtime-variables-unavailable')
    const activityHistory = await fetchAllPages(baseUrl, headers, '/history/activity-instance', { processInstanceId }, 200)
    const historicVariables = await fetchAllPages(baseUrl, headers, '/history/variable-instance', { processInstanceId }, 200)
    const historicTasks = await fetchAllPages(baseUrl, headers, '/history/task', { processInstanceId }, 200)
    const decisionHistory = await fetchAllPages(baseUrl, headers, '/history/decision-instance', { processInstanceId }, 200)
    const incidents = await fetchAllPages(baseUrl, headers, '/incident', { processInstanceId }, 200)
    const jobs = await fetchAllPages(baseUrl, headers, '/job', { processInstanceId }, 200)
    const externalTasks = await fetchAllPages(baseUrl, headers, '/external-task', { processInstanceId }, 200)
    const variableHistory = {}
    for (const variable of historicVariables) {
      if (!variable?.id) continue
      variableHistory[variable.id] = await fetchAllPages(baseUrl, headers, '/history/detail', { variableInstanceId: variable.id }, 200)
    }

    const decisionInputs = {}
    const decisionOutputs = {}
    for (const decision of decisionHistory) {
      if (!decision?.id) continue
      decisionInputs[decision.id] = await fetchJsonOrNull(baseUrl, headers, `/history/decision-instance/${encodeURIComponent(decision.id)}/inputs`) || []
      decisionOutputs[decision.id] = await fetchJsonOrNull(baseUrl, headers, `/history/decision-instance/${encodeURIComponent(decision.id)}/outputs`) || []
    }

    const userOperations = {}
    for (const executionId of uniqueStrings(activityHistory.map((entry) => entry?.executionId))) {
      userOperations[`${processInstanceId}:${executionId}`] = await fetchAllPages(baseUrl, headers, '/history/user-operation', {
        processInstanceId,
        executionId,
        sortBy: 'timestamp',
        sortOrder: 'desc',
      }, 200)
    }

    items.push({
      processInstanceId,
      processDefinitionId: runtime?.definitionId || historic?.processDefinitionId || null,
      runtime,
      historic,
      activityTree,
      variables,
      activityHistory,
      historicVariables,
      historicTasks,
      decisionHistory,
      decisionInputs,
      decisionOutputs,
      incidents,
      jobs,
      externalTasks,
      variableHistory,
      userOperations,
    })
  }
  return items
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const headers = buildAuthHeaders(options.username, options.password)
  const warnings = []

  const processDefinitions = await fetchAllPages(options.baseUrl, headers, '/process-definition', options.processDefinitionKeys.length > 0
    ? { key: options.processDefinitionKeys[0] }
    : {}, options.maxResults)
  const filteredProcessDefinitions = options.processDefinitionKeys.length > 1
    ? processDefinitions.filter((item) => options.processDefinitionKeys.includes(item.key))
    : processDefinitions

  const decisionDefinitions = await fetchAllPages(options.baseUrl, headers, '/decision-definition', options.decisionDefinitionKeys.length > 0
    ? { key: options.decisionDefinitionKeys[0] }
    : {}, options.maxResults)
  const filteredDecisionDefinitions = options.decisionDefinitionKeys.length > 1
    ? decisionDefinitions.filter((item) => options.decisionDefinitionKeys.includes(item.key))
    : decisionDefinitions

  const runtimeInstances = await fetchAllPages(options.baseUrl, headers, '/process-instance', {}, options.maxResults)
  const historicProcessInstances = await fetchAllPages(options.baseUrl, headers, '/history/process-instance', {
    sortBy: 'startTime',
    sortOrder: 'desc',
  }, options.maxResults)
  const decisionHistoryGlobal = await fetchAllPages(options.baseUrl, headers, '/history/decision-instance', {
    sortBy: 'evaluationTime',
    sortOrder: 'desc',
  }, options.maxResults)
  const incidentsGlobal = await fetchAllPages(options.baseUrl, headers, '/incident', {}, options.maxResults)

  const { details: processDefinitionDetails, xmlById: processDefinitionXml, statisticsById: processDefinitionStatistics } = await harvestProcessDefinitionArtifacts(
    options.baseUrl,
    headers,
    filteredProcessDefinitions,
  )
  const { details: decisionDefinitionDetails, xmlById: decisionDefinitionXml } = await harvestDecisionDefinitionArtifacts(
    options.baseUrl,
    headers,
    filteredDecisionDefinitions,
  )

  const processInstanceIds = collectProcessInstanceIds(options, runtimeInstances, historicProcessInstances)
  const processInstances = await harvestProcessInstanceArtifacts(options.baseUrl, headers, processInstanceIds, warnings)
  const candidates = analyzeCandidates(processInstances)

  const snapshot = {
    harvestedAt: new Date().toISOString(),
    source: {
      baseUrl: options.baseUrl,
      username: options.username,
      maxResults: options.maxResults,
    },
    filters: {
      processDefinitionKeys: options.processDefinitionKeys,
      decisionDefinitionKeys: options.decisionDefinitionKeys,
      processInstanceIds: options.processInstanceIds,
      historicProcessInstanceIds: options.historicProcessInstanceIds,
    },
    summary: {
      processDefinitions: filteredProcessDefinitions.length,
      decisionDefinitions: filteredDecisionDefinitions.length,
      runtimeInstances: runtimeInstances.length,
      historicProcessInstances: historicProcessInstances.length,
      decisionHistory: decisionHistoryGlobal.length,
      incidents: incidentsGlobal.length,
      harvestedProcessInstances: processInstances.length,
      warnings: warnings.length,
    },
    processDefinitions: filteredProcessDefinitions,
    processDefinitionDetails,
    processDefinitionXml,
    processDefinitionStatistics,
    decisionDefinitions: filteredDecisionDefinitions,
    decisionDefinitionDetails,
    decisionDefinitionXml,
    runtimeInstances,
    historicProcessInstances,
    decisionHistoryGlobal,
    incidentsGlobal,
    processInstances,
    candidates,
    warnings,
  }

  const body = JSON.stringify(snapshot, null, 2)

  console.error(JSON.stringify({
    outputPath: process.env.MOCK_CAMUNDA_OUTPUT_PATH || null,
    latestPath: process.env.MOCK_CAMUNDA_LATEST_PATH || null,
    summary: snapshot.summary,
    candidates: {
      parallel: snapshot.candidates.parallel.map((item) => item.processInstanceId),
      sequential: snapshot.candidates.sequential.map((item) => item.processInstanceId),
      loop: snapshot.candidates.loop.map((item) => item.processInstanceId),
    },
  }, null, 2))
  process.stdout.write(`${body}\n`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
