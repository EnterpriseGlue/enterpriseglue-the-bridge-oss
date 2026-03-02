/**
 * Type definitions for engine deployments
 * Reduces 'as any' usage in deployment routes
 */

import type { Engine } from '@enterpriseglue/shared/db/entities/Engine.js';
import type { EngineDeployment } from '@enterpriseglue/shared/db/entities/EngineDeployment.js';
import type { EngineDeploymentArtifact } from '@enterpriseglue/shared/db/entities/EngineDeploymentArtifact.js';

// Engine connection info for deployment
export interface EngineConnectionInfo {
  id: string;
  baseUrl: string;
  username?: string | null;
  passwordEnc?: string | null;
}

// File resource from request body
export interface DeploymentFileResource {
  id: string;
  name: string;
  type: 'bpmn' | 'dmn';
  xml: string;
  projectId: string;
  folderId: string | null;
  updatedAt: number | null;
}

// Resources structure in request body
export interface DeployResources {
  fileIds?: string[];
  folderId?: string;
  projectId?: string;
  recursive?: boolean;
}

// Request body for deployment
export interface DeployRequestBody {
  projectId?: string;
  engineId?: string;
  resources?: DeployResources;
  enableDuplicateFiltering?: boolean;
  deployChangedOnly?: boolean;
  deploymentName?: string;
  tenantId?: string;
}

// Camunda deployment response
export interface CamundaDeploymentResponse {
  id: string;
  name?: string;
  deploymentTime?: string;
  source?: string;
  tenantId?: string;
  deployedProcessDefinitions?: Record<string, CamundaProcessDefinition>;
  deployedDecisionDefinitions?: Record<string, CamundaDecisionDefinition>;
  deployedDecisionRequirementsDefinitions?: Record<string, CamundaDecisionRequirementsDefinition>;
}

export interface CamundaProcessDefinition {
  id: string;
  key: string;
  name?: string;
  version: number;
  resource?: string;
  resourceName?: string;
  tenantId?: string;
}

export interface CamundaDecisionDefinition {
  id: string;
  key: string;
  name?: string;
  version: number;
  resource?: string;
  resourceName?: string;
  tenantId?: string;
}

export interface CamundaDecisionRequirementsDefinition {
  id: string;
  key: string;
  name?: string;
  version: number;
  resource?: string;
  resourceName?: string;
  tenantId?: string;
}

// Resource metadata for tracking
export interface ResourceMeta {
  fileId: string;
  fileName: string;
  fileUpdatedAt: number | null;
  fileContentHash: string;
}

// DMN debug metadata
export interface DmnDebugMeta {
  fileId: string;
  fileName: string;
  rootTag: string;
  xmlnsDefault: string;
  xmlnsDmn: string;
  namespace: string;
  definitionsId: string;
  hasDecisionTable: boolean;
  hasRule: boolean;
  decisionIds: string[];
}

// Git commit info for file
export interface FileGitCommitInfo {
  id: string;
  message: string;
}

// Insert types for database operations
export type EngineDeploymentInsert = Omit<EngineDeployment, 'id'> & { id?: string };
export type EngineDeploymentArtifactInsert = Omit<EngineDeploymentArtifact, 'id'> & { id?: string };
