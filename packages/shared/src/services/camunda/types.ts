// Camunda API Types
export interface ProcessDefinition {
  id: string;
  key: string;
  name?: string;
  version: number;
  versionTag?: string;
  suspended?: boolean;
}

export interface ProcessDefinitionXml {
  id?: string;
  bpmn20Xml: string;
}

export interface ProcessInstance {
  id: string;
  processDefinitionKey?: string;
  rootProcessInstanceId?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  state?: 'ACTIVE' | 'COMPLETED' | 'CANCELED';
}

export interface HistoricProcessInstance {
  id: string;
  processDefinitionKey?: string;
  startTime?: string;
  endTime?: string | null;
  state?: string;
}

export interface Variables {
  [key: string]: { value: any; type: string };
}

export interface ActivityInstance {
  id: string;
  activityId?: string;
  activityName?: string;
  endTime?: string | null;
}

export interface Batch {
  id: string;
  type: string;
  totalJobs?: number;
  jobsCreated?: number;
  batchJobsPerSeed?: number;
  invocationsPerBatchJob?: number;
  seedJobDefinitionId?: string;
  monitorJobDefinitionId?: string;
  batchJobDefinitionId?: string;
  suspended?: boolean;
  tenantId?: string | null;
}

export interface BatchStatistics {
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
  tenantId: string | null;
  createUserId: string | null;
  startTime: string;
  executionStartTime: string | null;
  remainingJobs: number;
  completedJobs: number;
  failedJobs: number;
}
