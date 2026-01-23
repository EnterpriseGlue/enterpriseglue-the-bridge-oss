import { Buffer } from 'node:buffer'
import { fetch } from 'undici'
import { getDataSource } from '@shared/db/data-source.js'
import { Engine } from '@shared/db/entities/Engine.js'
import { Errors } from '@shared/middleware/errorHandler.js'
import { safeDecrypt } from './encryption.js'
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
} from '@shared/types/bpmn-engine-api.js'

type EngineCfg = { baseUrl: string; authType: 'none' | 'basic'; username?: string | null; password?: string | null }

async function getEngine(engineId: string): Promise<EngineCfg> {
  if (!engineId) throw Errors.validation('engineId is required')
  const dataSource = await getDataSource()
  const engineRepo = dataSource.getRepository(Engine)
  const row = await engineRepo.findOneBy({ id: engineId })
  if (!row || !row.baseUrl) throw Errors.engineNotFound(engineId)

  const engineRow = row as Engine & { authType?: string; passwordEnc?: string; username?: string }
  const authType = engineRow.authType || ((engineRow.username ? 'basic' : 'none') as 'none' | 'basic')
  const encryptedPassword = engineRow.passwordEnc || null
  const password = encryptedPassword ? safeDecrypt(encryptedPassword) : null
  return { baseUrl: String(row.baseUrl), authType: authType as 'none' | 'basic', username: engineRow.username || null, password }
}

function buildHeaders(cfg: EngineCfg): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (cfg.authType === 'basic' && cfg.username) {
    const token = Buffer.from(`${cfg.username}:${cfg.password ?? ''}`).toString('base64')
    h['Authorization'] = `Basic ${token}`
  }
  return h
}

export async function camundaGet<T = unknown>(engineId: string, path: string, params?: Record<string, any>): Promise<T> {
  const cfg = await getEngine(engineId)
  const url = new URL(path.startsWith('http') ? path : cfg.baseUrl.replace(/\/$/, '') + path)
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === '') continue
      if (Array.isArray(v)) v.forEach((vv) => url.searchParams.append(k, String(vv)))
      else url.searchParams.set(k, String(v))
    }
  }
  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: buildHeaders(cfg),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Camunda GET ${url} failed: ${res.status} ${res.statusText} ${text}`)
  }
  const ct = res.headers.get('content-type') || ''
  if (ct.includes('application/json')) return (await res.json()) as T
  return (await res.text()) as unknown as T
}

async function camundaSend<T = unknown>(engineId: string, method: 'POST' | 'PUT' | 'DELETE', path: string, body?: any): Promise<T> {
  const cfg = await getEngine(engineId)
  const url = path.startsWith('http') ? path : cfg.baseUrl.replace(/\/$/, '') + path
  const res = await fetch(url, {
    method,
    headers: buildHeaders(cfg),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Camunda ${method} ${url} failed: ${res.status} ${res.statusText} ${text}`)
  }
  const ct = res.headers.get('content-type') || ''
  if (ct.includes('application/json')) return (await res.json()) as T
  return (await res.text()) as unknown as T
}

export const camundaPost = <T = unknown>(engineId: string, path: string, body?: any) => camundaSend<T>(engineId, 'POST', path, body)
export const camundaPut =  <T = unknown>(engineId: string, path: string, body?: any) => camundaSend<T>(engineId, 'PUT', path, body)
export const camundaDelete =  <T = unknown>(engineId: string, path: string, body?: any) => camundaSend<T>(engineId, 'DELETE', path, body)

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
