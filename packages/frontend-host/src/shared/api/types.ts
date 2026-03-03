// Shared API types for frontend

export interface Project {
  id: string;
  name: string;
  createdAt: number;
}

export interface File {
  id: string;
  projectId?: string;
  folderId?: string | null;
  name: string;
  type?: 'bpmn' | 'dmn' | 'form';
  xml?: string;
  bpmnProcessId?: string | null;
  dmnDecisionId?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Version {
  id: string;
  fileId: string;
  author?: string;
  message: string;
  xml: string;
  createdAt: number;
}

export interface Comment {
  id: string;
  author?: string;
  message: string;
  createdAt: number;
}

export interface Engine {
  id: string;
  name: string;
  baseUrl: string;
  type?: 'camunda7' | 'operaton';
  authType?: 'none' | 'basic';
  username?: string;
  active: boolean;
  version?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ProcessDefinition {
  id: string;
  key: string;
  name?: string;
  version: number;
  versionTag?: string;
  suspended?: boolean;
}

export interface ProcessInstance {
  id: string;
  processDefinitionKey?: string;
  superProcessInstanceId?: string | null;
  rootProcessInstanceId?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  state?: 'ACTIVE' | 'COMPLETED' | 'CANCELED';
}
