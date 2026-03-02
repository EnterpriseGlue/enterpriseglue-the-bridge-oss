/**
 * Camunda REST API Type Definitions
 * Provides type safety for Camunda 7 REST API interactions
 */

// ===== Common Types =====

export interface CamundaVariable {
  value: unknown;
  type?: string;
  valueInfo?: Record<string, unknown>;
}

export type CamundaVariables = Record<string, CamundaVariable>;

export interface CamundaLink {
  method: string;
  href: string;
  rel: string;
}

// ===== Process Instance Types =====

export interface ProcessInstance {
  id: string;
  definitionId: string;
  businessKey?: string | null;
  caseInstanceId?: string | null;
  ended: boolean;
  suspended: boolean;
  tenantId?: string | null;
  links?: CamundaLink[];
}

export interface ProcessInstanceCount {
  count: number;
}

export interface ActivityInstance {
  id: string;
  activityId: string;
  activityName?: string | null;
  activityType: string;
  processInstanceId: string;
  processDefinitionId: string;
  childActivityInstances: ActivityInstance[];
  childTransitionInstances: TransitionInstance[];
  executionIds: string[];
  incidentIds: string[];
}

export interface TransitionInstance {
  id: string;
  activityId: string;
  activityName?: string | null;
  activityType: string;
  processInstanceId: string;
  processDefinitionId: string;
  executionId: string;
  incidentIds: string[];
}

// ===== Process Definition Types =====

export interface ProcessDefinition {
  id: string;
  key: string;
  category?: string | null;
  description?: string | null;
  name?: string | null;
  version: number;
  resource?: string | null;
  deploymentId?: string | null;
  diagram?: string | null;
  suspended: boolean;
  tenantId?: string | null;
  versionTag?: string | null;
  historyTimeToLive?: number | null;
  startableInTasklist: boolean;
}

// ===== Deployment Types =====

export interface Deployment {
  id: string;
  name?: string | null;
  source?: string | null;
  deploymentTime: string;
  tenantId?: string | null;
  links?: CamundaLink[];
  deployedProcessDefinitions?: Record<string, ProcessDefinition> | null;
  deployedCaseDefinitions?: Record<string, unknown> | null;
  deployedDecisionDefinitions?: Record<string, DecisionDefinition> | null;
  deployedDecisionRequirementsDefinitions?: Record<string, unknown> | null;
}

// ===== Task Types =====

export interface Task {
  id: string;
  name?: string | null;
  assignee?: string | null;
  owner?: string | null;
  created: string;
  due?: string | null;
  followUp?: string | null;
  delegationState?: 'PENDING' | 'RESOLVED' | null;
  description?: string | null;
  executionId?: string | null;
  parentTaskId?: string | null;
  priority: number;
  processDefinitionId?: string | null;
  processInstanceId?: string | null;
  caseDefinitionId?: string | null;
  caseInstanceId?: string | null;
  caseExecutionId?: string | null;
  taskDefinitionKey?: string | null;
  suspended: boolean;
  formKey?: string | null;
  tenantId?: string | null;
}

export interface TaskCount {
  count: number;
}

export interface TaskForm {
  key?: string | null;
  contextPath?: string | null;
}

export interface ClaimTaskRequest {
  userId: string;
}

export interface SetAssigneeRequest {
  userId: string | null;
}

export interface CompleteTaskRequest {
  variables?: CamundaVariables;
  withVariablesInReturn?: boolean;
}

// ===== External Task Types =====

export interface ExternalTask {
  id: string;
  activityId: string;
  activityInstanceId: string;
  errorMessage?: string | null;
  errorDetails?: string | null;
  executionId: string;
  lockExpirationTime?: string | null;
  processDefinitionId: string;
  processDefinitionKey: string;
  processInstanceId: string;
  tenantId?: string | null;
  retries?: number | null;
  suspended: boolean;
  workerId?: string | null;
  topicName: string;
  priority: number;
  businessKey?: string | null;
}

export interface FetchAndLockRequest {
  workerId: string;
  maxTasks: number;
  usePriority?: boolean;
  topics: FetchAndLockTopic[];
}

export interface FetchAndLockTopic {
  topicName: string;
  lockDuration: number;
  variables?: string[];
  processDefinitionId?: string;
  processDefinitionIdIn?: string[];
  processDefinitionKey?: string;
  processDefinitionKeyIn?: string[];
  processDefinitionVersionTag?: string;
  withoutTenantId?: boolean;
  tenantIdIn?: string[];
  processVariables?: Record<string, unknown>;
  deserializeValues?: boolean;
  includeExtensionProperties?: boolean;
}

export interface CompleteExternalTaskRequest {
  workerId: string;
  variables?: CamundaVariables;
  localVariables?: CamundaVariables;
}

export interface ExternalTaskFailureRequest {
  workerId: string;
  errorMessage: string;
  errorDetails?: string;
  retries: number;
  retryTimeout: number;
}

export interface ExternalTaskBpmnErrorRequest {
  workerId: string;
  errorCode: string;
  errorMessage?: string;
  variables?: CamundaVariables;
}

export interface ExtendLockRequest {
  workerId: string;
  newDuration: number;
}

export interface SetRetriesRequest {
  retries: number;
}

// ===== Job Types =====

export interface Job {
  id: string;
  jobDefinitionId?: string | null;
  processInstanceId?: string | null;
  processDefinitionId?: string | null;
  processDefinitionKey?: string | null;
  executionId?: string | null;
  exceptionMessage?: string | null;
  failedActivityId?: string | null;
  retries: number;
  dueDate?: string | null;
  suspended: boolean;
  priority: number;
  tenantId?: string | null;
  createTime?: string | null;
}

export interface JobDefinition {
  id: string;
  processDefinitionId: string;
  processDefinitionKey: string;
  activityId: string;
  jobType: string;
  jobConfiguration?: string | null;
  overridingJobPriority?: number | null;
  suspended: boolean;
  tenantId?: string | null;
  deploymentId?: string | null;
}

export interface SetJobRetriesRequest {
  retries: number;
  dueDate?: string | null;
}

export interface SetSuspensionStateRequest {
  suspended: boolean;
}

export interface SetDuedateRequest {
  duedate: string | null;
  cascade?: boolean;
}

// ===== Decision Types =====

export interface DecisionDefinition {
  id: string;
  key: string;
  category?: string | null;
  name?: string | null;
  version: number;
  resource?: string | null;
  deploymentId?: string | null;
  decisionRequirementsDefinitionId?: string | null;
  decisionRequirementsDefinitionKey?: string | null;
  tenantId?: string | null;
  versionTag?: string | null;
  historyTimeToLive?: number | null;
}

export interface DecisionDefinitionXml {
  id: string;
  dmnXml: string;
}

export interface EvaluateDecisionRequest {
  variables?: CamundaVariables;
}

export interface DecisionResult {
  [key: string]: CamundaVariable;
}

// ===== History Types =====

export interface HistoricActivityInstance {
  id: string;
  parentActivityInstanceId?: string | null;
  activityId: string;
  activityName?: string | null;
  activityType: string;
  processDefinitionKey: string;
  processDefinitionId: string;
  processInstanceId: string;
  executionId: string;
  taskId?: string | null;
  calledProcessInstanceId?: string | null;
  calledCaseInstanceId?: string | null;
  assignee?: string | null;
  startTime: string;
  endTime?: string | null;
  durationInMillis?: number | null;
  canceled: boolean;
  completeScope: boolean;
  tenantId?: string | null;
  removalTime?: string | null;
  rootProcessInstanceId?: string | null;
}

export interface HistoricTaskInstance {
  id: string;
  processDefinitionKey: string;
  processDefinitionId: string;
  processInstanceId: string;
  executionId: string;
  caseDefinitionKey?: string | null;
  caseDefinitionId?: string | null;
  caseInstanceId?: string | null;
  caseExecutionId?: string | null;
  activityInstanceId: string;
  name?: string | null;
  description?: string | null;
  deleteReason?: string | null;
  owner?: string | null;
  assignee?: string | null;
  startTime: string;
  endTime?: string | null;
  duration?: number | null;
  taskDefinitionKey: string;
  priority: number;
  due?: string | null;
  parentTaskId?: string | null;
  followUp?: string | null;
  tenantId?: string | null;
  removalTime?: string | null;
  rootProcessInstanceId?: string | null;
}

export interface HistoricVariableInstance {
  id: string;
  name: string;
  type: string;
  value: unknown;
  valueInfo?: Record<string, unknown>;
  processDefinitionKey?: string | null;
  processDefinitionId?: string | null;
  processInstanceId?: string | null;
  executionId?: string | null;
  activityInstanceId?: string | null;
  caseDefinitionKey?: string | null;
  caseDefinitionId?: string | null;
  caseInstanceId?: string | null;
  caseExecutionId?: string | null;
  taskId?: string | null;
  tenantId?: string | null;
  errorMessage?: string | null;
  state: string;
  createTime: string;
  removalTime?: string | null;
  rootProcessInstanceId?: string | null;
}

export interface HistoricDecisionInstance {
  id: string;
  decisionDefinitionId: string;
  decisionDefinitionKey: string;
  decisionDefinitionName?: string | null;
  evaluationTime: string;
  removalTime?: string | null;
  processDefinitionId?: string | null;
  processDefinitionKey?: string | null;
  processInstanceId?: string | null;
  caseDefinitionId?: string | null;
  caseDefinitionKey?: string | null;
  caseInstanceId?: string | null;
  activityId?: string | null;
  activityInstanceId?: string | null;
  userId?: string | null;
  inputs?: HistoricDecisionInputInstance[];
  outputs?: HistoricDecisionOutputInstance[];
  collectResultValue?: number | null;
  rootDecisionInstanceId?: string | null;
  rootProcessInstanceId?: string | null;
  decisionRequirementsDefinitionId?: string | null;
  decisionRequirementsDefinitionKey?: string | null;
  tenantId?: string | null;
}

export interface HistoricDecisionInputInstance {
  id: string;
  decisionInstanceId: string;
  clauseId?: string | null;
  clauseName?: string | null;
  type: string;
  value: unknown;
  valueInfo?: Record<string, unknown>;
  errorMessage?: string | null;
  createTime: string;
  removalTime?: string | null;
  rootProcessInstanceId?: string | null;
}

export interface HistoricDecisionOutputInstance {
  id: string;
  decisionInstanceId: string;
  clauseId?: string | null;
  clauseName?: string | null;
  ruleId?: string | null;
  ruleOrder?: number | null;
  variableName?: string | null;
  type: string;
  value: unknown;
  valueInfo?: Record<string, unknown>;
  errorMessage?: string | null;
  createTime: string;
  removalTime?: string | null;
  rootProcessInstanceId?: string | null;
}

export interface UserOperationLogEntry {
  id: string;
  userId?: string | null;
  timestamp: string;
  operationId: string;
  operationType: string;
  entityType: string;
  category: string;
  annotation?: string | null;
  property?: string | null;
  orgValue?: string | null;
  newValue?: string | null;
  deploymentId?: string | null;
  processDefinitionId?: string | null;
  processDefinitionKey?: string | null;
  processInstanceId?: string | null;
  executionId?: string | null;
  caseDefinitionId?: string | null;
  caseInstanceId?: string | null;
  caseExecutionId?: string | null;
  taskId?: string | null;
  externalTaskId?: string | null;
  batchId?: string | null;
  jobId?: string | null;
  jobDefinitionId?: string | null;
  removalTime?: string | null;
  rootProcessInstanceId?: string | null;
}

// ===== Batch Types =====

export interface Batch {
  id: string;
  type: string;
  totalJobs: number;
  jobsCreated: number;
  batchJobsPerSeed: number;
  invocationsPerBatchJob: number;
  seedJobDefinitionId: string;
  monitorJobDefinitionId: string;
  batchJobDefinitionId: string;
  suspended: boolean;
  tenantId?: string | null;
  createUserId?: string | null;
  startTime?: string | null;
  executionStartTime?: string | null;
}

export interface BatchStatistics extends Batch {
  remainingJobs: number;
  completedJobs: number;
  failedJobs: number;
}

export interface DeleteProcessInstancesRequest {
  processInstanceIds?: string[];
  processInstanceQuery?: Record<string, unknown>;
  deleteReason?: string;
  skipCustomListeners?: boolean;
  skipSubprocesses?: boolean;
  failIfNotExists?: boolean;
}

export interface SuspendProcessInstancesRequest {
  processInstanceIds?: string[];
  processInstanceQuery?: Record<string, unknown>;
  suspended: boolean;
}

export interface SetJobRetriesAsyncRequest {
  processInstances?: string[];
  processInstanceQuery?: Record<string, unknown>;
  jobIds?: string[];
  jobQuery?: Record<string, unknown>;
  retries: number;
}

// ===== Migration Types =====

export interface MigrationPlan {
  sourceProcessDefinitionId: string;
  targetProcessDefinitionId: string;
  instructions: MigrationInstruction[];
  variables?: CamundaVariables;
}

export interface MigrationInstruction {
  sourceActivityIds: string[];
  targetActivityIds: string[];
  updateEventTrigger?: boolean;
}

export interface GenerateMigrationPlanRequest {
  sourceProcessDefinitionId: string;
  targetProcessDefinitionId: string;
  updateEventTriggers?: boolean;
}

export interface ValidateMigrationPlanRequest {
  migrationPlan?: MigrationPlan;
  sourceProcessDefinitionId?: string;
  targetProcessDefinitionId?: string;
  instructions?: MigrationInstruction[];
  updateEventTriggers?: boolean;
  processInstanceIds?: string[];
  processInstanceQuery?: Record<string, unknown>;
}

export interface MigrationPlanValidationReport {
  migrationPlan: MigrationPlan;
  instructionReports: MigrationInstructionValidationReport[];
}

export interface MigrationInstructionValidationReport {
  instruction: MigrationInstruction;
  failures: string[];
}

export interface ExecuteMigrationRequest {
  migrationPlan: MigrationPlan;
  processInstanceIds?: string[];
  processInstanceQuery?: Record<string, unknown>;
  skipCustomListeners?: boolean;
  skipIoMappings?: boolean;
}

// ===== Message & Signal Types =====

export interface CorrelateMessageRequest {
  messageName: string;
  businessKey?: string;
  tenantId?: string;
  withoutTenantId?: boolean;
  processInstanceId?: string;
  correlationKeys?: CamundaVariables;
  localCorrelationKeys?: CamundaVariables;
  processVariables?: CamundaVariables;
  processVariablesLocal?: CamundaVariables;
  all?: boolean;
  resultEnabled?: boolean;
  variablesInResultEnabled?: boolean;
}

export interface MessageCorrelationResult {
  resultType: 'Execution' | 'ProcessDefinition';
  processInstance?: ProcessInstance;
  execution?: { id: string; processInstanceId: string; ended: boolean; tenantId?: string };
  variables?: CamundaVariables;
}

export interface DeliverSignalRequest {
  name: string;
  executionId?: string;
  tenantId?: string;
  withoutTenantId?: boolean;
  variables?: CamundaVariables;
}

// ===== Modification Types =====

export interface ModifyProcessInstanceRequest {
  skipCustomListeners?: boolean;
  skipIoMappings?: boolean;
  instructions: ModificationInstruction[];
  annotation?: string;
}

export interface ModificationInstruction {
  type: 'cancel' | 'startBeforeActivity' | 'startAfterActivity' | 'startTransition';
  activityId?: string;
  transitionId?: string;
  activityInstanceId?: string;
  transitionInstanceId?: string;
  ancestorActivityInstanceId?: string;
  variables?: CamundaVariables;
}

export interface RestartProcessInstanceRequest {
  processInstanceIds?: string[];
  historicProcessInstanceQuery?: Record<string, unknown>;
  skipCustomListeners?: boolean;
  skipIoMappings?: boolean;
  initialVariables?: boolean;
  withoutBusinessKey?: boolean;
  instructions: RestartInstruction[];
}

export interface RestartInstruction {
  type: 'startBeforeActivity' | 'startAfterActivity' | 'startTransition';
  activityId?: string;
  transitionId?: string;
}

// ===== Metrics Types =====

export interface Metric {
  timestamp: string;
  name: string;
  reporter?: string | null;
  value: number;
}

export interface MetricResult {
  result: number;
}

// ===== Version Types =====

export interface EngineVersion {
  version?: string;
}
