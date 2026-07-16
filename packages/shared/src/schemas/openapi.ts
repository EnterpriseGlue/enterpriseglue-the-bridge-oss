import { z } from 'zod';
import { extendZodWithOpenApi, OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';

// Extend zod BEFORE loading schema modules — zod 4 requires this to run
// before any schema is created so that .openapi() is available on instances.
extendZodWithOpenApi(z);

// Dynamic imports ensure schema modules evaluate AFTER extendZodWithOpenApi.
const {
  ProjectSchema,
  CreateProjectRequest,
  RenameProjectRequest,
  FileSchema,
  FileSchemaRaw,
  CreateFileRequest,
  UpdateFileXmlRequest,
  RenameFileRequest,
  VersionSchema,
  CompareVersionsResponse,
  CommentSchema,
  FolderSchema,
  FolderSchemaRaw,
  FolderSummarySchema,
  CreateFolderRequest,
  UpdateFolderRequest,
  ProjectContentsSchema,
  FolderDeletePreviewSchema,
} = await import('@enterpriseglue/shared/schemas/starbase/index.js');

const {
  EngineSchema,
  EngineSchemaRaw,
  EngineConnectionModeSchema,
  EngineTransportDiagnosticsSchema,
  EndpointAuthenticationPolicyErrorSchema,
  CreateEngineRequestSchema,
  UpdateEngineRequestSchema,
  ExternalEngineRegistrationRequestSchema,
  SavedFilterSchema,
  SavedFilterSchemaRaw,
  BatchSchema,
  ProcessDefinitionSchema: MissionControlProcessDefinitionSchema,
  ProcessDefXmlSchema: MissionControlProcessDefXmlSchema,
  ProcessInstanceSchema: MissionControlProcessInstanceSchema,
  VariablesSchema: MissionControlVariablesSchema,
  ActivityInstanceSchema: MissionControlActivityInstanceSchema,
  PreviewCountRequest,
  DeploymentSchema,
  DeploymentQueryParams,
  TaskSchema,
  TaskQueryParams,
  ClaimTaskRequest,
  SetAssigneeRequest,
  CompleteTaskRequest,
  TaskVariablesRequest,
  ExternalTaskSchema,
  FetchAndLockRequest,
  CompleteExternalTaskRequest,
  ExternalTaskFailureRequest,
  ExternalTaskBpmnErrorRequest,
  ExtendLockRequest,
  ExternalTaskQueryParams,
  CorrelateMessageRequest,
  MessageCorrelationResultSchema,
  SignalEventSchema,
  DecisionDefinitionSchema,
  DecisionDefinitionQueryParams,
  EvaluateDecisionRequest,
  JobSchema,
  JobDefinitionSchema,
  JobQueryParams,
  JobDefinitionQueryParams,
  SetJobRetriesRequest,
  SetJobSuspensionStateRequest,
  SetJobDefinitionRetriesRequest,
  SetJobDefinitionSuspensionStateRequest,
  HistoricTaskInstanceSchema,
  HistoricVariableInstanceSchema,
  VariableHistoryEntrySchema,
  HistoricDecisionInstanceSchema,
  UserOperationLogEntrySchema,
  HistoricTaskQueryParams,
  VariableHistoryQueryParams,
  HistoricVariableQueryParams,
  HistoricDecisionQueryParams,
  UserOperationLogQueryParams,
  MetricSchema,
  MetricsQueryParams,
  ModificationInstructionSchema,
  ProcessInstanceModificationRequest,
  ProcessDefinitionModificationAsyncRequest,
  ProcessDefinitionRestartAsyncRequest,
} = await import('./mission-control/index.js');

const {
  RepositorySelectSchema,
  InitRepositoryRequestSchema,
  CloneRepositoryRequestSchema,
  DeployRequestSchema,
  RollbackRequestSchema,
  DeploymentResponseSchema,
  AcquireLockRequestSchema,
  LockResponseSchema,
} = await import('@enterpriseglue/shared/schemas/git/index.js');

const registry = new OpenAPIRegistry();

const {
  AUTHZ_OPENAPI_EXTENSION_KEY,
  getAuthzActionDefinition,
  toOpenApiAuthzExtension,
} = await import('../authz/permission-actions.js');
const {
  AUTHZ_OPENAPI_EXEMPTION_KEY,
  getAuthzRouteExemption,
  toOpenApiAuthzExemption,
} = await import('../authz/route-exemptions.js');

function authzExtension(actionId: string, method: string, path: string): Record<string, unknown> {
  const action = getAuthzActionDefinition(actionId);
  const route = action?.routes?.find((candidate) =>
    candidate.method.toUpperCase() === method.toUpperCase() && candidate.route === path
  ) || action?.routes?.find((candidate) => candidate.method.toUpperCase() === method.toUpperCase());
  if (!action || !route) return {};
  return { [AUTHZ_OPENAPI_EXTENSION_KEY]: toOpenApiAuthzExtension(action, route) };
}

function authzExemption(method: string, path: string): Record<string, unknown> {
  const exemption = getAuthzRouteExemption(method, path);
  if (!exemption) return {};
  return { [AUTHZ_OPENAPI_EXEMPTION_KEY]: toOpenApiAuthzExemption(exemption) };
}

const ConfigBootstrapStatusOpenApiSchema = z.object({
  mode: z.enum(['disabled', 'validate', 'apply']),
  status: z.enum(['disabled', 'validated', 'applied', 'failed']),
  hash: z.string().nullable(),
  message: z.string().nullable(),
  reconciliation: z.enum(['not_run', 'completed', 'pending']),
  secretPreflight: z.enum(['not_required', 'passed', 'failed']),
  issueCode: z.enum([
    'bundle_path_missing', 'bundle_read_failed', 'hash_mismatch', 'validation_failed',
    'secret_preflight_failed', 'tenant_scope_missing', 'apply_failed', 'identity_reconciliation_failed',
  ]).nullable(),
});
const HealthSchema = z.object({ status: z.enum(['ok', 'degraded']), configBootstrap: ConfigBootstrapStatusOpenApiSchema });
const ReadinessSchema = z.object({ status: z.enum(['ready', 'not_ready']), configBootstrap: ConfigBootstrapStatusOpenApiSchema });
const InvalidQueryParametersResponseSchema = z.object({
  error: z.literal('Invalid query parameters'),
  issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});
registry.register('Health', HealthSchema);
registry.register('Readiness', ReadinessSchema);
registry.register('ConfigBootstrapStatus', ConfigBootstrapStatusOpenApiSchema);
registry.register('InvalidQueryParametersResponse', InvalidQueryParametersResponseSchema);
registry.registerPath({
  method: 'get',
  path: '/health',
  ...authzExemption('GET', '/health'),
  responses: {
    200: { description: 'Health check', content: { 'application/json': { schema: HealthSchema } } },
  },
});
registry.registerPath({
  method: 'get',
  path: '/ready',
  ...authzExemption('GET', '/ready'),
  responses: {
    200: { description: 'Service is ready after required startup configuration work', content: { 'application/json': { schema: ReadinessSchema } } },
    503: { description: 'Required startup configuration work failed', content: { 'application/json': { schema: ReadinessSchema } } },
  },
});
registry.registerPath({
  method: 'get',
  path: '/metrics',
  ...authzExemption('GET', '/metrics'),
  responses: { 200: { description: 'Sanitized Prometheus configuration-bootstrap metrics', content: { 'text/plain': { schema: z.string() } } } },
});

registry.register('Project', ProjectSchema);
const ProjectImportPreviewRequestOpenApiSchema = z.object({
  engineId: z.string(),
});
const ProjectImportPreviewResponseOpenApiSchema = z.object({
  engineId: z.string(),
  allowed: z.literal(true),
  targetAction: z.literal('create_import_target'),
  counts: z.object({
    bpmn: z.number(),
    dmn: z.number(),
  }),
  files: z.array(z.object({
    name: z.string(),
    type: z.enum(['bpmn', 'dmn']),
    bpmnProcessId: z.string().nullable(),
    dmnDecisionId: z.string().nullable(),
  })),
  warnings: z.array(z.string()),
});
registry.registerPath({
  method: 'get',
  path: '/starbase-api/projects',
  ...authzExtension('project.projects.read', 'GET', '/starbase-api/projects'),
  responses: {
    200: {
      description: 'List projects',
      content: { 'application/json': { schema: z.array(ProjectSchema) } },
    },
  },
});

// POST /projects (create project)
registry.register('CreateProjectRequest', CreateProjectRequest);
registry.registerPath({
  method: 'post',
  path: '/starbase-api/projects',
  ...authzExtension('project.projects.create', 'POST', '/starbase-api/projects'),
  request: {
    body: { content: { 'application/json': { schema: CreateProjectRequest } } },
  },
  responses: {
    201: {
      description: 'Project created',
      content: { 'application/json': { schema: ProjectSchema } },
    },
  },
});

registry.register('ProjectImportPreviewRequest', ProjectImportPreviewRequestOpenApiSchema);
registry.register('ProjectImportPreviewResponse', ProjectImportPreviewResponseOpenApiSchema);
registry.registerPath({
  method: 'post',
  path: '/starbase-api/projects/import-preview',
  ...authzExtension('project.import.preview', 'POST', '/starbase-api/projects/import-preview'),
  request: {
    body: { content: { 'application/json': { schema: ProjectImportPreviewRequestOpenApiSchema } } },
  },
  responses: {
    200: {
      description: 'Preview latest BPMN/DMN definitions available for project import from an engine',
      content: { 'application/json': { schema: ProjectImportPreviewResponseOpenApiSchema } },
    },
  },
});

// PATCH /projects/:projectId (rename project)
registry.register('RenameProjectRequest', RenameProjectRequest);
registry.registerPath({
  method: 'patch',
  path: '/starbase-api/projects/{projectId}',
  ...authzExtension('project.projects.update', 'PATCH', '/starbase-api/projects/{projectId}'),
  request: {
    params: z.object({ projectId: z.string() }),
    body: { content: { 'application/json': { schema: RenameProjectRequest } } },
  },
  responses: {
    200: {
      description: 'Project renamed',
      content: { 'application/json': { schema: z.object({ id: z.string(), name: z.string() }) } },
    },
    404: { description: 'Not found' },
  },
});

// DELETE /projects/:projectId (delete project and cascade files)
registry.registerPath({
  method: 'delete',
  path: '/starbase-api/projects/{projectId}',
  ...authzExtension('project.projects.delete', 'DELETE', '/starbase-api/projects/{projectId}'),
  request: { params: z.object({ projectId: z.string() }) },
  responses: {
    204: { description: 'Project deleted' },
    404: { description: 'Not found' },
  },
});

// File schemas
registry.register('File', FileSchema);

// GET /projects/:projectId/files (list, no xml)
registry.registerPath({
  method: 'get',
  path: '/starbase-api/projects/{projectId}/files',
  ...authzExtension('project.files.read', 'GET', '/starbase-api/projects/{projectId}/files'),
  request: {
    params: z.object({ projectId: z.string() }),
  },
  responses: {
    200: {
      description: 'List files in project',
      content: {
        'application/json': {
          schema: z.array(
            FileSchemaRaw.omit({ xml: true, projectId: true })
          ),
        },
      },
    },
  },
});

// GET /files/:fileId (metadata + xml)
registry.registerPath({
  method: 'get',
  path: '/starbase-api/files/{fileId}',
  ...authzExtension('project.files.read', 'GET', '/starbase-api/files/{fileId}'),
  request: { params: z.object({ fileId: z.string() }) },
  responses: {
    200: {
      description: 'Get file by id',
      content: { 'application/json': { schema: FileSchema } },
    },
    404: { description: 'Not found' },
  },
});

// GET /projects/:projectId/files/:fileId/callers
registry.registerPath({
  method: 'get',
  path: '/starbase-api/projects/{projectId}/files/{fileId}/callers',
  ...authzExtension('project.files.read', 'GET', '/starbase-api/projects/{projectId}/files/{fileId}/callers'),
  request: { params: z.object({ projectId: z.string(), fileId: z.string() }) },
  responses: {
    200: {
      description: 'List BPMN call activities that reference the target file',
      content: {
        'application/json': {
          schema: z.object({
            callers: z.array(z.object({
              parentFileId: z.string(),
              parentFileName: z.string(),
              parentFolderId: z.string().nullable(),
              parentProcessId: z.string().nullable(),
              callActivityId: z.string(),
              callActivityName: z.string().nullable(),
            })),
          }),
        },
      },
    },
  },
});

// POST /projects/:projectId/files (create new BPMN/DMN file)
registry.register('CreateFileRequest', CreateFileRequest);
registry.registerPath({
  method: 'post',
  path: '/starbase-api/projects/{projectId}/files',
  ...authzExtension('project.files.create', 'POST', '/starbase-api/projects/{projectId}/files'),
  request: {
    params: z.object({ projectId: z.string() }),
    body: { content: { 'application/json': { schema: CreateFileRequest } } },
  },
  responses: {
    201: {
      description: 'File created',
      content: { 'application/json': { schema: FileSchemaRaw.omit({ xml: true, projectId: true }) } },
    },
  },
});

// PUT /files/:fileId (update XML - autosave)
registry.register('UpdateFileXmlRequest', UpdateFileXmlRequest);
registry.registerPath({
  method: 'put',
  path: '/starbase-api/files/{fileId}',
  ...authzExtension('project.files.update', 'PUT', '/starbase-api/files/{fileId}'),
  request: {
    params: z.object({ fileId: z.string() }),
    body: { content: { 'application/json': { schema: UpdateFileXmlRequest } } },
  },
  responses: {
    200: {
      description: 'File XML updated',
      content: { 'application/json': { schema: z.object({ updatedAt: z.number() }) } },
    },
    404: { description: 'Not found' },
    409: {
      description: 'Conflict - file was modified',
      content: { 'application/json': { schema: z.object({ message: z.string(), currentUpdatedAt: z.number() }) } },
    },
  },
});

// PATCH /files/:fileId (rename file)
registry.register('RenameFileRequest', RenameFileRequest);
registry.registerPath({
  method: 'patch',
  path: '/starbase-api/files/{fileId}',
  ...authzExtension('project.files.update', 'PATCH', '/starbase-api/files/{fileId}'),
  request: {
    params: z.object({ fileId: z.string() }),
    body: { content: { 'application/json': { schema: RenameFileRequest } } },
  },
  responses: {
    200: {
      description: 'File renamed',
      content: { 'application/json': { schema: z.object({ id: z.string(), name: z.string() }) } },
    },
    404: { description: 'Not found' },
  },
});

// DELETE /files/:fileId (delete file and versions)
registry.registerPath({
  method: 'delete',
  path: '/starbase-api/files/{fileId}',
  ...authzExtension('project.files.delete', 'DELETE', '/starbase-api/files/{fileId}'),
  request: { params: z.object({ fileId: z.string() }) },
  responses: {
    204: { description: 'File deleted' },
    404: { description: 'Not found' },
  },
});

// GET /files/:fileId/comments (read-only)
registry.register('Comment', CommentSchema);
registry.registerPath({
  method: 'get',
  path: '/starbase-api/files/{fileId}/comments',
  ...authzExtension('project.files.read', 'GET', '/starbase-api/files/{fileId}/comments'),
  request: { params: z.object({ fileId: z.string() }) },
  responses: {
    200: {
      description: 'List comments for a file',
      content: { 'application/json': { schema: z.array(CommentSchema) } },
    },
  },
});

// Version schemas
registry.register('Version', VersionSchema);
const VersionDetailResponseSchema = z.object({
  id: z.string(),
  fileId: z.string(),
  author: z.string(),
  message: z.string(),
  xml: z.string(),
  createdAt: z.number(),
});

// GET /files/:fileId/versions (list versions for a file)
registry.registerPath({
  method: 'get',
  path: '/starbase-api/files/{fileId}/versions',
  ...authzExtension('project.versions.read', 'GET', '/starbase-api/files/{fileId}/versions'),
  request: { params: z.object({ fileId: z.string() }) },
  responses: {
    200: {
      description: 'List file versions',
      content: { 'application/json': { schema: z.array(VersionSchema) } },
    },
  },
});

// POST /files/:fileId/versions (create version snapshot)
registry.registerPath({
  method: 'post',
  path: '/starbase-api/files/{fileId}/versions',
  ...authzExtension('project.versions.create', 'POST', '/starbase-api/files/{fileId}/versions'),
  request: {
    params: z.object({ fileId: z.string() }),
    body: { content: { 'application/json': { schema: z.object({ message: z.string().max(500).optional() }) } } },
  },
  responses: {
    201: {
      description: 'File version created',
      content: { 'application/json': { schema: z.object({ id: z.string(), author: z.string(), message: z.string(), createdAt: z.number() }) } },
    },
  },
});

// GET /files/:fileId/versions/:versionId
registry.registerPath({
  method: 'get',
  path: '/starbase-api/files/{fileId}/versions/{versionId}',
  ...authzExtension('project.versions.read', 'GET', '/starbase-api/files/{fileId}/versions/{versionId}'),
  request: { params: z.object({ fileId: z.string(), versionId: z.string() }) },
  responses: {
    200: {
      description: 'File version detail',
      content: { 'application/json': { schema: VersionDetailResponseSchema } },
    },
    404: { description: 'Not found' },
  },
});

// POST /files/:fileId/versions/:versionId/restore
registry.registerPath({
  method: 'post',
  path: '/starbase-api/files/{fileId}/versions/{versionId}/restore',
  ...authzExtension('project.versions.restore', 'POST', '/starbase-api/files/{fileId}/versions/{versionId}/restore'),
  request: { params: z.object({ fileId: z.string(), versionId: z.string() }) },
  responses: {
    200: {
      description: 'File restored from version',
      content: { 'application/json': { schema: z.object({ restored: z.boolean(), fileId: z.string(), versionId: z.string(), updatedAt: z.number() }) } },
    },
    404: { description: 'Not found' },
  },
});

// GET /versions/:versionId/compare/:otherVersionId (compare two versions)
registry.register('CompareVersionsResponse', CompareVersionsResponse);
registry.registerPath({
  method: 'get',
  path: '/starbase-api/versions/{versionId}/compare/{otherVersionId}',
  ...authzExtension('project.versions.read', 'GET', '/starbase-api/versions/{versionId}/compare/{otherVersionId}'),
  request: {
    params: z.object({
      versionId: z.string(),
      otherVersionId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Version comparison',
      content: { 'application/json': { schema: CompareVersionsResponse } },
    },
  },
});

// -----------------------------
// Starbase API - Deployments (artifact management)
// -----------------------------
registry.register('Deployment', DeploymentSchema);
registry.registerPath({ method: 'get', path: '/starbase-api/deployments', ...authzExtension('engine.deployments.read', 'GET', '/starbase-api/deployments'), request: { query: DeploymentQueryParams.partial() }, responses: { 200: { description: 'List deployments', content: { 'application/json': { schema: z.array(DeploymentSchema) } } } } });
registry.registerPath({ method: 'get', path: '/starbase-api/deployments/{id}', ...authzExtension('engine.deployments.read', 'GET', '/starbase-api/deployments/{id}'), request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'Get deployment', content: { 'application/json': { schema: DeploymentSchema } } }, 404: { description: 'Not found' } } });
registry.registerPath({ method: 'delete', path: '/starbase-api/deployments/{id}', ...authzExtension('engine.deployments.delete', 'DELETE', '/starbase-api/deployments/{id}'), request: { params: z.object({ id: z.string() }), query: z.object({ cascade: z.string().optional() }) }, responses: { 204: { description: 'Deleted' } } });
registry.registerPath({ method: 'post', path: '/starbase-api/deployments', ...authzExemption('POST', '/starbase-api/deployments'), responses: { 501: { description: 'Multipart deployment creation is not implemented on this route' } } });
registry.registerPath({ method: 'get', path: '/starbase-api/process-definitions/{id}/diagram', ...authzExtension('engine.deployments.read', 'GET', '/starbase-api/process-definitions/{id}/diagram'), request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'Process diagram', content: { 'application/json': { schema: z.unknown() } } } } });

// -----------------------------
// Mission Control API (Camunda-backed) docs
// -----------------------------
registry.register('MissionControlProcessDefinition', MissionControlProcessDefinitionSchema);
registry.register('MissionControlProcessDefinitionXml', MissionControlProcessDefXmlSchema);
registry.register('MissionControlProcessInstance', MissionControlProcessInstanceSchema);
registry.register('MissionControlVariables', MissionControlVariablesSchema);
registry.register('MissionControlActivityInstance', MissionControlActivityInstanceSchema);

// GET /mission-control-api/process-definitions
registry.registerPath({
  method: 'get',
  path: '/mission-control-api/process-definitions',
  ...authzExtension('engine.runtime.process-definitions.read', 'GET', '/mission-control-api/process-definitions'),
  request: {
    query: z.object({ key: z.string().optional(), nameLike: z.string().optional(), latest: z.string().optional() }),
  },
  responses: {
    200: { description: 'List process definitions', content: { 'application/json': { schema: z.array(MissionControlProcessDefinitionSchema) } } },
  },
});

// GET /mission-control-api/process-definitions/{id}
registry.registerPath({
  method: 'get',
  path: '/mission-control-api/process-definitions/{id}',
  ...authzExtension('engine.runtime.process-definitions.read', 'GET', '/mission-control-api/process-definitions/{id}'),
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'Process definition', content: { 'application/json': { schema: MissionControlProcessDefinitionSchema } } },
    404: { description: 'Not found' },
  },
});

// GET /mission-control-api/process-definitions/{id}/xml
registry.registerPath({
  method: 'get',
  path: '/mission-control-api/process-definitions/{id}/xml',
  ...authzExtension('engine.runtime.process-definitions.read', 'GET', '/mission-control-api/process-definitions/{id}/xml'),
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'BPMN XML', content: { 'application/json': { schema: MissionControlProcessDefXmlSchema } } },
    404: { description: 'Not found' },
  },
});

// GET /mission-control-api/process-definitions/resolve (resolve by key+version)
registry.registerPath({
  method: 'get',
  path: '/mission-control-api/process-definitions/resolve',
  ...authzExtension('engine.runtime.process-definitions.read', 'GET', '/mission-control-api/process-definitions/resolve'),
  request: {
    query: z.object({
      key: z.string(),
      version: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Resolved process definition',
      content: { 'application/json': { schema: z.object({ id: z.string() }) } },
    },
  },
});

// GET /mission-control-api/process-definitions/edit-target (resolve Starbase edit target for a deployed process version)
const ProcessEditTargetResponse = z.object({
  canShowEditButton: z.boolean(),
  canEdit: z.boolean(),
  engineId: z.string(),
  processKey: z.string(),
  processVersion: z.number(),
  projectId: z.string(),
  fileId: z.string(),
  engineDeploymentId: z.string().optional(),
  commitId: z.string().nullable().optional(),
  fileVersionNumber: z.number().nullable().optional(),
  mappingSource: z.enum(['git-commit', 'db-timestamp', 'db-latest', 'deployment-timestamp']).optional(),
  artifactCreatedAt: z.number().optional(),
});
registry.register('ProcessEditTarget', ProcessEditTargetResponse);
registry.registerPath({
  method: 'get',
  path: '/mission-control-api/process-definitions/edit-target',
  ...authzExtension('engine.runtime.process-definitions.edit-target.read', 'GET', '/mission-control-api/process-definitions/edit-target'),
  request: {
    query: z.object({
      engineId: z.string(),
      key: z.string(),
      version: z.string(),
      processDefinitionId: z.string().optional(),
    }),
  },
  responses: {
    200: { description: 'Starbase file target for the deployed process version', content: { 'application/json': { schema: ProcessEditTargetResponse } } },
    404: { description: 'No deployed process mapping found' },
  },
});

// GET /mission-control-api/process-definitions/{id}/active-activity-counts
registry.registerPath({
  method: 'get',
  path: '/mission-control-api/process-definitions/{id}/active-activity-counts',
  ...authzExtension('engine.runtime.process-definitions.read', 'GET', '/mission-control-api/process-definitions/{id}/active-activity-counts'),
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: 'Active activity counts by activity ID',
      content: { 'application/json': { schema: z.record(z.string(), z.number()) } },
    },
  },
});

// POST /mission-control-api/process-instances/preview-count (preview count with filters)
registry.register('PreviewCountRequest', PreviewCountRequest);
registry.registerPath({
  method: 'post',
  path: '/mission-control-api/process-instances/preview-count',
  ...authzExtension('engine.runtime.process-instances.read', 'POST', '/mission-control-api/process-instances/preview-count'),
  request: {
    body: { content: { 'application/json': { schema: PreviewCountRequest } } },
  },
  responses: {
    200: {
      description: 'Instance count matching filters',
      content: { 'application/json': { schema: z.object({ count: z.number() }) } },
    },
  },
});

// GET /mission-control-api/process-instances
registry.registerPath({
  method: 'get',
  path: '/mission-control-api/process-instances',
  ...authzExtension('engine.runtime.process-instances.read', 'GET', '/mission-control-api/process-instances'),
  request: {
    query: z.object({
      processDefinitionKey: z.string().optional(),
      active: z.string().optional(),
      suspended: z.string().optional(),
      withIncidents: z.string().optional(),
      completed: z.string().optional(),
      canceled: z.string().optional(),
      includeActionDecisions: z.enum(['true']).optional(),
    }),
  },
  responses: {
    200: { description: 'List process instances (runtime + historic)', content: { 'application/json': { schema: z.array(MissionControlProcessInstanceSchema) } } },
  },
});

// GET /mission-control-api/process-instances/{id}
registry.registerPath({
  method: 'get',
  path: '/mission-control-api/process-instances/{id}',
  ...authzExtension('engine.runtime.process-instances.read', 'GET', '/mission-control-api/process-instances/{id}'),
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'Process instance details (runtime)', content: { 'application/json': { schema: z.unknown() } } },
    404: { description: 'Not found' },
  },
});

// GET /mission-control-api/process-instances/{id}/variables
registry.registerPath({
  method: 'get',
  path: '/mission-control-api/process-instances/{id}/variables',
  ...authzExtension('engine.runtime.process-instances.variables.read', 'GET', '/mission-control-api/process-instances/{id}/variables'),
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'Process instance variables', content: { 'application/json': { schema: MissionControlVariablesSchema } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/mission-control-api/process-instances/{id}/variable-history',
  ...authzExtension('engine.runtime.process-instances.variable-history.read', 'GET', '/mission-control-api/process-instances/{id}/variable-history'),
  request: {
    params: z.object({ id: z.string() }),
    query: VariableHistoryQueryParams,
  },
  responses: {
    200: { description: 'Variable history timeline for a process instance variable', content: { 'application/json': { schema: z.array(VariableHistoryEntrySchema) } } },
    400: { description: 'Invalid query parameters', content: { 'application/json': { schema: InvalidQueryParametersResponseSchema } } },
  },
});

// GET /mission-control-api/process-instances/{id}/history/activity-instances
registry.registerPath({
  method: 'get',
  path: '/mission-control-api/process-instances/{id}/history/activity-instances',
  ...authzExtension('engine.runtime.process-instances.activity-history.read', 'GET', '/mission-control-api/process-instances/{id}/history/activity-instances'),
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'Historic activity instances', content: { 'application/json': { schema: z.array(MissionControlActivityInstanceSchema) } } },
  },
});

// GET /mission-control-api/process-instances/{id}/execution-details
registry.registerPath({
  method: 'get',
  path: '/mission-control-api/process-instances/{id}/execution-details',
  ...authzExtension('engine.runtime.process-instances.execution-details.read', 'GET', '/mission-control-api/process-instances/{id}/execution-details'),
  request: {
    params: z.object({ id: z.string() }),
    query: z.object({
      activityInstanceId: z.string(),
      executionId: z.string().optional(),
      taskId: z.string().optional(),
    }),
  },
  responses: {
    200: { description: 'Lazy execution details for a process instance activity', content: { 'application/json': { schema: z.unknown() } } },
    400: { description: 'Invalid query parameters', content: { 'application/json': { schema: InvalidQueryParametersResponseSchema } } },
  },
});

// GET /mission-control-api/process-instances/{id}/incidents
registry.registerPath({
  method: 'get',
  path: '/mission-control-api/process-instances/{id}/incidents',
  ...authzExtension('engine.runtime.process-instances.incidents.read', 'GET', '/mission-control-api/process-instances/{id}/incidents'),
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'Incidents for an instance', content: { 'application/json': { schema: z.array(z.unknown()) } } },
  },
});

// PUT /mission-control-api/process-instances/{id}/suspend
registry.registerPath({
  method: 'put',
  path: '/mission-control-api/process-instances/{id}/suspend',
  ...authzExtension('engine.runtime.process-instances.suspension.update', 'PUT', '/mission-control-api/process-instances/{id}/suspend'),
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: { description: 'Suspended' },
  },
});

// PUT /mission-control-api/process-instances/{id}/activate
registry.registerPath({
  method: 'put',
  path: '/mission-control-api/process-instances/{id}/activate',
  ...authzExtension('engine.runtime.process-instances.suspension.update', 'PUT', '/mission-control-api/process-instances/{id}/activate'),
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: { description: 'Activated' },
  },
});

// POST /mission-control-api/process-instances/{id}/retry (retry failed jobs)
registry.registerPath({
  method: 'post',
  path: '/mission-control-api/process-instances/{id}/retry',
  ...authzExtension('engine.runtime.process-instances.retry', 'POST', '/mission-control-api/process-instances/{id}/retry'),
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: 'Jobs retried',
      content: { 'application/json': { schema: z.object({ retriedJobs: z.number() }) } },
    },
  },
});

// DELETE /mission-control-api/process-instances/{id} (delete instance)
registry.registerPath({
  method: 'delete',
  path: '/mission-control-api/process-instances/{id}',
  ...authzExtension('engine.runtime.process-instances.delete', 'DELETE', '/mission-control-api/process-instances/{id}'),
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: { description: 'Deleted' },
  },
});

// GET /mission-control-api/history/process-instances (list historic instances)
registry.registerPath({
  method: 'get',
  path: '/mission-control-api/history/process-instances',
  ...authzExtension('engine.runtime.history.process-instances.read', 'GET', '/mission-control-api/history/process-instances'),
  request: {
    query: z.object({
      superProcessInstanceId: z.string().optional(),
      processDefinitionKey: z.string().optional(),
    }).passthrough(),
  },
  responses: {
    200: {
      description: 'List historic process instances',
      content: { 'application/json': { schema: z.array(MissionControlProcessInstanceSchema) } },
    },
  },
});

// GET /mission-control-api/history/process-instances/{id} (get historic instance)
registry.registerPath({
  method: 'get',
  path: '/mission-control-api/history/process-instances/{id}',
  ...authzExtension('engine.runtime.history.process-instances.read', 'GET', '/mission-control-api/history/process-instances/{id}'),
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: 'Historic process instance details',
      content: { 'application/json': { schema: MissionControlProcessInstanceSchema } },
    },
    404: { description: 'Not found' },
  },
});

// GET /mission-control-api/history/variable-instances (historic variables)
registry.registerPath({
  method: 'get',
  path: '/mission-control-api/history/variable-instances',
  ...authzExtension('engine.runtime.history.variables.read', 'GET', '/mission-control-api/history/variable-instances'),
  request: {
    query: z.object({
      processInstanceId: z.string().optional(),
      variableName: z.string().optional(),
    }).passthrough(),
  },
  responses: {
    200: {
      description: 'Historic variable instances',
      content: { 'application/json': { schema: z.array(z.unknown()) } },
    },
  },
});

// -----------------------------
// Engines API: Engines & Saved Filters
// -----------------------------
registry.register('Engine', EngineSchema)
registry.register('EngineConnectionMode', EngineConnectionModeSchema)
registry.register('EngineTransportDiagnostics', EngineTransportDiagnosticsSchema)
registry.register('EndpointAuthenticationPolicyError', EndpointAuthenticationPolicyErrorSchema)
registry.register('CreateEngineRequest', CreateEngineRequestSchema)
registry.register('UpdateEngineRequest', UpdateEngineRequestSchema)
registry.register('ExternalEngineRegistrationRequest', ExternalEngineRegistrationRequestSchema)

const ExternalRegistrationHealthSchema = z.object({
  status: z.enum(['connected','disconnected','unknown']),
  latencyMs: z.number().nullable().optional(),
  message: z.string().nullable().optional(),
  version: z.string().nullable().optional(),
  checkedAt: z.number(),
  transport: EngineTransportDiagnosticsSchema.optional(),
})
const ExternalEngineRegistrationResponseSchema = z.object({
  created: z.boolean(),
  engine: EngineSchema,
  health: ExternalRegistrationHealthSchema.nullable().optional(),
})
registry.register('ExternalEngineRegistrationResponse', ExternalEngineRegistrationResponseSchema)
const ExternalProjectEngineTargetModeFlagsSchema = z.object({
  allowManualDeploy: z.boolean().optional(),
  allowCiDeploy: z.boolean().optional(),
  allowApiDeploy: z.boolean().optional(),
  allowImport: z.boolean().optional(),
})
const ExternalProjectEngineTargetUpsertRequestSchema = ExternalProjectEngineTargetModeFlagsSchema.extend({
  externalSystemId: z.string(),
  projectId: z.string(),
  engineId: z.string().optional(),
  externalEngineId: z.string().optional(),
  externalProjectId: z.string().optional(),
  externalTargetId: z.string().optional(),
  status: z.enum(['active', 'disabled']).optional(),
  approvalStatus: z.enum(['not_required', 'pending', 'approved', 'rejected']).optional(),
  policyTags: z.array(z.string()).optional(),
  diagnostics: z.record(z.string(), z.unknown()).nullable().optional(),
})
const ExternalProjectEngineTargetDecommissionRequestSchema = z.object({
  externalSystemId: z.string(),
  projectId: z.string(),
  engineId: z.string().optional(),
  externalEngineId: z.string().optional(),
  externalProjectId: z.string().optional(),
  externalTargetId: z.string().optional(),
})

registry.registerPath({
  method: 'get',
  path: '/engines-api/engines',
  ...authzExtension('engine.inventory.read', 'GET', '/engines-api/engines'),
  responses: {
    200: { description: 'List engines', content: { 'application/json': { schema: z.array(EngineSchema) } } },
  },
})

registry.registerPath({
  method: 'post',
  path: '/engines-api/engines',
  ...authzExtension('engine.inventory.create', 'POST', '/engines-api/engines'),
  request: { body: { content: { 'application/json': { schema: CreateEngineRequestSchema } } } },
  responses: {
    201: { description: 'Created', content: { 'application/json': { schema: EngineSchema } } },
    400: { description: 'Endpoint authentication policy rejected the engine registration', content: { 'application/json': { schema: EndpointAuthenticationPolicyErrorSchema } } },
  },
})

registry.registerPath({
  method: 'post',
  path: '/engines-api/external/engines',
  ...authzExtension('engine.external-registration.upsert', 'POST', '/engines-api/external/engines'),
  request: {
    body: {
      content: {
        'application/json': {
          schema: ExternalEngineRegistrationRequestSchema,
        },
      },
    },
  },
  responses: {
    201: { description: 'External engine registered', content: { 'application/json': { schema: ExternalEngineRegistrationResponseSchema } } },
    200: { description: 'External engine updated', content: { 'application/json': { schema: ExternalEngineRegistrationResponseSchema } } },
    400: { description: 'Endpoint authentication policy rejected the external registration', content: { 'application/json': { schema: EndpointAuthenticationPolicyErrorSchema } } },
  },
})

registry.registerPath({
  method: 'post',
  path: '/engines-api/external/engines/decommission',
  ...authzExtension('engine.external-registration.decommission', 'POST', '/engines-api/external/engines/decommission'),
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            externalId: z.string(),
            externalSystemId: z.string().nullable().optional(),
            reason: z.string().nullable().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'External engine decommissioned',
      content: {
        'application/json': {
          schema: z.object({
            decommissioned: z.boolean(),
            engineId: z.string(),
            externalId: z.string(),
            lifecycleStatus: z.literal('decommissioned'),
          }),
        },
      },
    },
  },
})

registry.registerPath({
  method: 'post',
  path: '/engines-api/external/project-engine-targets',
  ...authzExtension('project-engine-target.external-registration.upsert', 'POST', '/engines-api/external/project-engine-targets'),
  request: { body: { content: { 'application/json': { schema: ExternalProjectEngineTargetUpsertRequestSchema } } } },
  responses: {
    201: { description: 'External project-engine target registered', content: { 'application/json': { schema: z.object({ created: z.literal(true), target: z.unknown() }) } } },
    200: { description: 'External project-engine target updated', content: { 'application/json': { schema: z.object({ created: z.literal(false), target: z.unknown() }) } } },
    400: { description: 'Invalid external project-engine target request' },
    403: { description: 'API client is not authorized to manage project-engine targets for this external system' },
    409: { description: 'Project-engine target is already managed by another source' },
  },
})

registry.registerPath({
  method: 'post',
  path: '/engines-api/external/project-engine-targets/decommission',
  ...authzExtension('project-engine-target.external-registration.decommission', 'POST', '/engines-api/external/project-engine-targets/decommission'),
  request: { body: { content: { 'application/json': { schema: ExternalProjectEngineTargetDecommissionRequestSchema } } } },
  responses: {
    200: {
      description: 'External project-engine target archived or reported absent',
      content: { 'application/json': { schema: z.object({ archived: z.boolean(), targetId: z.string().nullable(), reason: z.string().optional() }) } },
    },
    400: { description: 'Invalid external project-engine target decommission request' },
    403: { description: 'API client is not authorized to manage project-engine targets for this external system' },
    409: { description: 'Project-engine target is managed by a different source' },
  },
})

registry.registerPath({
  method: 'get',
  path: '/engines-api/engines/{id}',
  ...authzExtension('engine.inventory.read', 'GET', '/engines-api/engines/{id}'),
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: 'Engine', content: { 'application/json': { schema: EngineSchema } } }, 404: { description: 'Not found' } },
})

registry.registerPath({
  method: 'put',
  path: '/engines-api/engines/{id}',
  ...authzExtension('engine.inventory.update', 'PUT', '/engines-api/engines/{id}'),
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: UpdateEngineRequestSchema } } } },
  responses: {
    200: { description: 'Updated', content: { 'application/json': { schema: EngineSchema } } },
    400: { description: 'Endpoint authentication policy rejected the engine update', content: { 'application/json': { schema: EndpointAuthenticationPolicyErrorSchema } } },
  },
})

registry.registerPath({
  method: 'delete',
  path: '/engines-api/engines/{id}',
  ...authzExtension('engine.inventory.delete', 'DELETE', '/engines-api/engines/{id}'),
  request: { params: z.object({ id: z.string() }) },
  responses: { 204: { description: 'Deleted' } },
})

// Engine health
const EngineHealthSchema = z.object({
  id: z.string().optional(),
  engineId: z.string().optional(),
  status: z.enum(['connected','disconnected','unknown']),
  latencyMs: z.number().nullable().optional(),
  message: z.string().nullable().optional(),
  version: z.string().nullable().optional(),
  checkedAt: z.number(),
  transport: EngineTransportDiagnosticsSchema.optional(),
})
registry.register('EngineHealth', EngineHealthSchema)

registry.registerPath({
  method: 'post',
  path: '/engines-api/engines/{id}/test',
  ...authzExtension('engine.inventory.update', 'POST', '/engines-api/engines/{id}/test'),
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: 'Health test result', content: { 'application/json': { schema: EngineHealthSchema } } } },
})

registry.registerPath({
  method: 'get',
  path: '/engines-api/engines/{id}/health',
  ...authzExtension('engine.inventory.read', 'GET', '/engines-api/engines/{id}/health'),
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: 'Last recorded health or null', content: { 'application/json': { schema: EngineHealthSchema.nullable() } } } },
})

registry.register('SavedFilter', SavedFilterSchema)

registry.registerPath({
  method: 'get',
  path: '/engines-api/saved-filters',
  ...authzExtension('engine.saved-filters.read', 'GET', '/engines-api/saved-filters'),
  responses: { 200: { description: 'List saved filters', content: { 'application/json': { schema: z.array(SavedFilterSchema) } } } },
})

registry.registerPath({
  method: 'post',
  path: '/engines-api/saved-filters',
  ...authzExtension('engine.saved-filters.manage', 'POST', '/engines-api/saved-filters'),
  request: { body: { content: { 'application/json': { schema: SavedFilterSchemaRaw.partial({ id: true, createdAt: true }) } } } },
  responses: { 201: { description: 'Created', content: { 'application/json': { schema: SavedFilterSchema } } } },
})

registry.registerPath({
  method: 'get',
  path: '/engines-api/saved-filters/{id}',
  ...authzExtension('engine.saved-filters.read', 'GET', '/engines-api/saved-filters/{id}'),
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: 'Saved filter', content: { 'application/json': { schema: SavedFilterSchema } } }, 404: { description: 'Not found' } },
})

registry.registerPath({
  method: 'put',
  path: '/engines-api/saved-filters/{id}',
  ...authzExtension('engine.saved-filters.manage', 'PUT', '/engines-api/saved-filters/{id}'),
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: SavedFilterSchemaRaw.partial() } } } },
  responses: { 200: { description: 'Updated', content: { 'application/json': { schema: SavedFilterSchema } } } },
})

registry.registerPath({
  method: 'delete',
  path: '/engines-api/saved-filters/{id}',
  ...authzExtension('engine.saved-filters.manage', 'DELETE', '/engines-api/saved-filters/{id}'),
  request: { params: z.object({ id: z.string() }) },
  responses: { 204: { description: 'Deleted' } },
})

// -----------------------------
// Engines API - Deployments (Camunda 7 passthrough)
// -----------------------------
const DeployResources = z.object({
  fileIds: z.array(z.string()).optional(),
  folderId: z.string().optional(),
  projectId: z.string().optional(),
  recursive: z.boolean().optional(),
})
const DeployOptions = z.object({
  deploymentName: z.string().optional(),
  enableDuplicateFiltering: z.boolean().optional(),
  deployChangedOnly: z.boolean().optional(),
  tenantId: z.string().optional(),
})
const DeployRequest = z.object({ resources: DeployResources.optional(), options: DeployOptions.optional() })
const PreviewResponse = z.object({ count: z.number(), resources: z.array(z.string()), warnings: z.array(z.string()), errors: z.array(z.string()) })
const DeployResponse = z.object({ engineId: z.string(), engineBaseUrl: z.string(), raw: z.unknown() })

registry.register('EnginesDeployRequest', DeployRequest)
registry.register('EnginesDeployPreviewResponse', PreviewResponse)
registry.register('EnginesDeployResponse', DeployResponse)

registry.registerPath({
  method: 'post',
  path: '/engines-api/engines/{engineId}/deployments/preview',
  ...authzExtension('project-engine-target.deploy.use', 'POST', '/engines-api/engines/:engineId/deployments/preview'),
  request: { params: z.object({ engineId: z.string() }), body: { content: { 'application/json': { schema: DeployRequest } } } },
  responses: { 200: { description: 'Preview of resources to deploy', content: { 'application/json': { schema: PreviewResponse } } } },
})

registry.registerPath({
  method: 'post',
  path: '/engines-api/engines/{engineId}/deployments',
  ...authzExtension('project-engine-target.deploy.use', 'POST', '/engines-api/engines/:engineId/deployments'),
  request: { params: z.object({ engineId: z.string() }), body: { content: { 'application/json': { schema: DeployRequest } } } },
  responses: { 201: { description: 'Deployment created', content: { 'application/json': { schema: DeployResponse } } } },
})

registry.registerPath({
  method: 'post',
  path: '/engines-api/external/engines/{engineId}/deployments',
  ...authzExtension('project-engine-target.deploy.use', 'POST', '/engines-api/external/engines/:engineId/deployments'),
  request: { params: z.object({ engineId: z.string() }), body: { content: { 'application/json': { schema: DeployRequest } } } },
  responses: {
    201: { description: 'API-client deployment created', content: { 'application/json': { schema: DeployResponse } } },
    401: { description: 'API client bearer token required' },
    403: { description: 'API deployment is not allowed' },
  },
})

const {
  DeploymentReceiptCreateSchema,
  DeploymentReceiptResponseSchema,
  DeploymentReceiptViewSchema,
  DeploymentHistoryViewSchema,
  DeploymentLineageViewSchema,
  EngineMetadataReconciliationResultSchema,
} = await import('./platform-admin/deployment-receipt.js');
registry.registerPath({
  method: 'post',
  path: '/engines-api/external/engines/{engineId}/deployment-receipts',
  ...authzExtension('engine.deployment-receipts.create', 'POST', '/engines-api/external/engines/{engineId}/deployment-receipts'),
  request: {
    params: z.object({ engineId: z.string() }),
    body: { content: { 'application/json': { schema: DeploymentReceiptCreateSchema } } },
  },
  responses: {
    200: { description: 'Existing idempotent deployment receipt', content: { 'application/json': { schema: DeploymentReceiptResponseSchema } } },
    201: { description: 'Deployment receipt recorded', content: { 'application/json': { schema: DeploymentReceiptResponseSchema } } },
    401: { description: 'API client bearer token required' },
    403: { description: 'API deployment is not allowed' },
  },
})
registry.registerPath({
  method: 'get',
  path: '/engines-api/engines/{engineId}/deployment-receipts',
  ...authzExtension('engine.deployments.read', 'GET', '/engines-api/engines/{engineId}/deployment-receipts'),
  request: { params: z.object({ engineId: z.string() }), query: z.object({ limit: z.coerce.number().int().min(1).max(500).optional() }) },
  responses: { 200: { description: 'Sanitized external deployment receipt lineage', content: { 'application/json': { schema: z.array(DeploymentReceiptViewSchema) } } } },
})
registry.registerPath({
  method: 'get',
  path: '/engines-api/engines/{engineId}/deployment-history',
  ...authzExtension('engine.deployments.read', 'GET', '/engines-api/engines/{engineId}/deployment-history'),
  request: { params: z.object({ engineId: z.string() }), query: z.object({ limit: z.coerce.number().int().min(1).max(200).optional() }) },
  responses: { 200: { description: 'Sanitized canonical deployment history for an engine', content: { 'application/json': { schema: z.array(DeploymentHistoryViewSchema) } } } },
})
registry.registerPath({
  method: 'get',
  path: '/engines-api/engines/{engineId}/deployments/{deploymentId}/lineage',
  ...authzExtension('engine.deployments.read', 'GET', '/engines-api/engines/{engineId}/deployments/{deploymentId}/lineage'),
  request: { params: z.object({ engineId: z.string(), deploymentId: z.string() }) },
  responses: {
    200: { description: 'Sanitized canonical deployment lineage and runtime artifact references', content: { 'application/json': { schema: DeploymentLineageViewSchema } } },
    404: { description: 'Canonical deployment lineage was not found' },
  },
})

registry.registerPath({
  method: 'get',
  path: '/engines-api/engines/{engineId}/deployments',
  ...authzExtension('engine.deployments.read', 'GET', '/engines-api/engines/{engineId}/deployments'),
  request: { params: z.object({ engineId: z.string() }) },
  responses: { 200: { description: 'List engine deployments (raw engine shape)', content: { 'application/json': { schema: z.unknown() } } } },
})

registry.registerPath({
  method: 'get',
  path: '/engines-api/engines/{engineId}/deployments/{id}',
  ...authzExtension('engine.deployments.read', 'GET', '/engines-api/engines/{engineId}/deployments/{id}'),
  request: { params: z.object({ engineId: z.string(), id: z.string() }) },
  responses: { 200: { description: 'Engine deployment detail (raw engine shape)', content: { 'application/json': { schema: z.unknown() } } }, 404: { description: 'Not found' } },
})

registry.registerPath({
  method: 'delete',
  path: '/engines-api/engines/{engineId}/deployments/{id}',
  ...authzExtension('engine.deployments.delete', 'DELETE', '/engines-api/engines/{engineId}/deployments/{id}'),
  request: { params: z.object({ engineId: z.string(), id: z.string() }) },
  responses: { 204: { description: 'Deleted' } },
})

// -----------------------------
// Batches (async operations)
// -----------------------------
registry.register('Batch', BatchSchema)

const CreateBatchResponse = z.object({ id: z.string(), camundaBatchId: z.string().optional(), type: z.string() })
registry.register('CreateBatchResponse', CreateBatchResponse)

const CreateDeleteBatchRequest = z.object({
  processInstanceIds: z.array(z.string()).optional(),
  processInstanceQuery: z.record(z.string(), z.any()).optional(),
  deleteReason: z.string().optional(),
  skipCustomListeners: z.boolean().optional(),
  skipIoMappings: z.boolean().optional(),
  failIfNotExists: z.boolean().optional(),
  skipSubprocesses: z.boolean().optional(),
})
registry.register('CreateDeleteBatchRequest', CreateDeleteBatchRequest)

const CreateSuspendActivateBatchRequest = z.object({
  processInstanceIds: z.array(z.string()).optional(),
  processInstanceQuery: z.record(z.string(), z.any()).optional(),
  suspended: z.boolean().optional(),
})
registry.register('CreateSuspendActivateBatchRequest', CreateSuspendActivateBatchRequest)

const CreateRetriesBatchRequest = z.object({
  retries: z.number().min(0),
  jobIds: z.array(z.string()).optional(),
  processInstanceIds: z.array(z.string()).optional(),
})
registry.register('CreateRetriesBatchRequest', CreateRetriesBatchRequest)

const BatchDetailSchema = z.object({
  batch: BatchSchema,
  engine: z.unknown().nullable().optional(),
  statistics: z.unknown().nullable().optional(),
})
registry.register('BatchDetail', BatchDetailSchema)

// Create: delete instances (async)
registry.registerPath({
  method: 'post',
  path: '/mission-control-api/batches/process-instances/delete',
  ...authzExtension('engine.runtime.batches.process-instances.delete', 'POST', '/mission-control-api/batches/process-instances/delete'),
  request: { body: { content: { 'application/json': { schema: CreateDeleteBatchRequest } } } },
  responses: { 201: { description: 'Created', content: { 'application/json': { schema: CreateBatchResponse } } } },
})

// Create: suspend instances (async)
registry.registerPath({
  method: 'post',
  path: '/mission-control-api/batches/process-instances/suspend',
  ...authzExtension('engine.runtime.batches.process-instances.suspend', 'POST', '/mission-control-api/batches/process-instances/suspend'),
  request: { body: { content: { 'application/json': { schema: CreateSuspendActivateBatchRequest } } } },
  responses: { 201: { description: 'Created', content: { 'application/json': { schema: CreateBatchResponse } } } },
})

// Create: activate instances (async)
registry.registerPath({
  method: 'post',
  path: '/mission-control-api/batches/process-instances/activate',
  ...authzExtension('engine.runtime.batches.process-instances.activate', 'POST', '/mission-control-api/batches/process-instances/activate'),
  request: { body: { content: { 'application/json': { schema: CreateSuspendActivateBatchRequest } } } },
  responses: { 201: { description: 'Created', content: { 'application/json': { schema: CreateBatchResponse } } } },
})

// Create: set job retries (async)
registry.registerPath({
  method: 'post',
  path: '/mission-control-api/batches/jobs/retries',
  ...authzExtension('engine.runtime.batches.jobs.retry', 'POST', '/mission-control-api/batches/jobs/retries'),
  request: { body: { content: { 'application/json': { schema: CreateRetriesBatchRequest } } } },
  responses: { 201: { description: 'Created', content: { 'application/json': { schema: CreateBatchResponse } } } },
})

// List batches
registry.registerPath({
  method: 'get',
  path: '/mission-control-api/batches',
  ...authzExtension('engine.runtime.batches.read', 'GET', '/mission-control-api/batches'),
  responses: { 200: { description: 'List batches', content: { 'application/json': { schema: z.array(BatchSchema) } } } },
})

// Suspend or resume batch
registry.registerPath({
  method: 'put',
  path: '/mission-control-api/batches/{id}/suspended',
  ...authzExtension('engine.runtime.batches.suspension.update', 'PUT', '/mission-control-api/batches/{id}/suspended'),
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: z.object({ suspended: z.boolean() }) } } } },
  responses: { 204: { description: 'Suspension state updated' }, 404: { description: 'Not found' } },
})

// Batch detail
registry.registerPath({
  method: 'get',
  path: '/mission-control-api/batches/{id}',
  ...authzExtension('engine.runtime.batches.read', 'GET', '/mission-control-api/batches/{id}'),
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: 'Batch detail', content: { 'application/json': { schema: BatchDetailSchema } } }, 404: { description: 'Not found' } },
})

// Cancel batch
registry.registerPath({
  method: 'delete',
  path: '/mission-control-api/batches/{id}',
  ...authzExtension('engine.runtime.batches.cancel', 'DELETE', '/mission-control-api/batches/{id}'),
  request: { params: z.object({ id: z.string() }) },
  responses: { 204: { description: 'Canceled' }, 404: { description: 'Not found' } },
})

// Delete local batch record
registry.registerPath({
  method: 'delete',
  path: '/mission-control-api/batches/{id}/record',
  ...authzExtension('engine.runtime.batches.record.delete', 'DELETE', '/mission-control-api/batches/{id}/record'),
  request: { params: z.object({ id: z.string() }) },
  responses: { 204: { description: 'Deleted' }, 404: { description: 'Not found' } },
})
// -----------------------------
// Migration (async batch)
// -----------------------------
const MigrationInstructionSchema = z.object({
  sourceActivityIds: z.array(z.string()),
  targetActivityId: z.string(),
  updateEventTrigger: z.boolean().optional(),
})
const MigrationPlanSchema = z.object({
  sourceProcessDefinitionId: z.string(),
  targetProcessDefinitionId: z.string(),
  instructions: z.array(MigrationInstructionSchema).default([]),
  updateEventTriggers: z.boolean().optional(),
})
registry.register('MigrationPlan', MigrationPlanSchema)

const MigrationGenerateInput = z.object({
  sourceDefinitionId: z.string(),
  targetDefinitionId: z.string(),
  updateEventTriggers: z.boolean().optional(),
  overrides: z
    .array(
      z.object({
        sourceActivityIds: z.array(z.string()).optional(),
        sourceActivityId: z.string().optional(),
        targetActivityId: z.string().optional(),
        targetActivityIds: z.array(z.string()).optional(),
        updateEventTrigger: z.boolean().optional(),
      })
    )
    .optional(),
})
registry.register('MigrationGenerateInput', MigrationGenerateInput)

const MigrationValidateRequest = z.object({ plan: MigrationPlanSchema })
registry.register('MigrationValidateRequest', MigrationValidateRequest)

const MigrationExecuteRequest = z.object({
  plan: MigrationPlanSchema,
  processInstanceIds: z.array(z.string()).optional(),
  skipCustomListeners: z.boolean().optional(),
  skipIoMappings: z.boolean().optional(),
  variables: MissionControlVariablesSchema.optional(),
  auditReason: z.string().min(1).max(2000),
})
registry.register('MigrationExecuteRequest', MigrationExecuteRequest)

const MigrationCreateResponse = z.object({ id: z.string(), camundaBatchId: z.string().optional(), type: z.literal('MIGRATE_INSTANCES') })
registry.register('MigrationCreateResponse', MigrationCreateResponse)

const MigrationDirectResponse = z.object({ ok: z.boolean() })
registry.register('MigrationDirectResponse', MigrationDirectResponse)

// POST /mission-control-api/migration/plan/generate
registry.registerPath({
  method: 'post',
  path: '/mission-control-api/migration/plan/generate',
  ...authzExtension('engine.runtime.migrations.plan.generate', 'POST', '/mission-control-api/migration/plan/generate'),
  request: { body: { content: { 'application/json': { schema: MigrationGenerateInput } } } },
  responses: { 200: { description: 'Generated migration plan (engine shape)', content: { 'application/json': { schema: MigrationPlanSchema } } } },
})

// POST /mission-control-api/migration/plan/validate
registry.registerPath({
  method: 'post',
  path: '/mission-control-api/migration/plan/validate',
  ...authzExtension('engine.runtime.migrations.plan.validate', 'POST', '/mission-control-api/migration/plan/validate'),
  request: { body: { content: { 'application/json': { schema: MigrationValidateRequest } } } },
  responses: { 200: { description: 'Validation result', content: { 'application/json': { schema: z.unknown() } } } },
})

// POST /mission-control-api/migration/execute-async
registry.registerPath({
  method: 'post',
  path: '/mission-control-api/migration/execute-async',
  ...authzExtension('engine.runtime.migrations.execute-async', 'POST', '/mission-control-api/migration/execute-async'),
  request: { body: { content: { 'application/json': { schema: MigrationExecuteRequest } } } },
  responses: { 201: { description: 'Created', content: { 'application/json': { schema: MigrationCreateResponse } } } },
})

// POST /mission-control-api/migration/execute-direct
registry.registerPath({
  method: 'post',
  path: '/mission-control-api/migration/execute-direct',
  ...authzExtension('engine.runtime.migrations.execute-direct', 'POST', '/mission-control-api/migration/execute-direct'),
  request: { body: { content: { 'application/json': { schema: MigrationExecuteRequest } } } },
  responses: { 200: { description: 'Executed', content: { 'application/json': { schema: MigrationDirectResponse } } } },
})

// POST /mission-control-api/migration/preview
const MigrationPreviewRequest = z.object({ plan: MigrationPlanSchema.optional(), processInstanceIds: z.array(z.string()).optional() })
const MigrationPreviewResponse = z.object({ count: z.number() })
registry.register('MigrationPreviewRequest', MigrationPreviewRequest)
registry.register('MigrationPreviewResponse', MigrationPreviewResponse)
registry.registerPath({
  method: 'post',
  path: '/mission-control-api/migration/preview',
  ...authzExtension('engine.runtime.migrations.preview', 'POST', '/mission-control-api/migration/preview'),
  request: { body: { content: { 'application/json': { schema: MigrationPreviewRequest } } } },
  responses: { 200: { description: 'Preview affected instances count', content: { 'application/json': { schema: MigrationPreviewResponse } } } },
})

// POST /mission-control-api/migration/active-sources
const ActiveSourcesRequest = z.object({ processInstanceIds: z.array(z.string()) })
const ActiveSourcesResponse = z.record(z.string(), z.number())
registry.register('ActiveSourcesRequest', ActiveSourcesRequest)
registry.register('ActiveSourcesResponse', ActiveSourcesResponse)
registry.registerPath({
  method: 'post',
  path: '/mission-control-api/migration/active-sources',
  ...authzExtension('engine.runtime.migrations.active-sources.read', 'POST', '/mission-control-api/migration/active-sources'),
  request: { body: { content: { 'application/json': { schema: ActiveSourcesRequest } } } },
  responses: { 200: { description: 'Active source activity counts keyed by activityId', content: { 'application/json': { schema: ActiveSourcesResponse } } } },
})

// -----------------------------
// Direct operations (no batch)
// -----------------------------
const DirectIds = z.object({ processInstanceIds: z.array(z.string()), skipCustomListeners: z.boolean().optional(), skipIoMappings: z.boolean().optional(), failIfNotExists: z.boolean().optional(), skipSubprocesses: z.boolean().optional() })
const DirectSuspend = z.object({ processInstanceIds: z.array(z.string()) })
const DirectRetries = z.object({ processInstanceIds: z.array(z.string()), retries: z.number().min(0), onlyFailed: z.boolean().optional() })
const DirectResult = z.object({ total: z.number(), succeeded: z.array(z.string()), failed: z.array(z.object({ id: z.string(), ok: z.boolean(), error: z.string().optional() })) })

registry.registerPath({ method: 'post', path: '/mission-control-api/direct/process-instances/delete', ...authzExtension('engine.runtime.direct.process-instances.delete', 'POST', '/mission-control-api/direct/process-instances/delete'), request: { body: { content: { 'application/json': { schema: DirectIds } } } }, responses: { 200: { description: 'Result', content: { 'application/json': { schema: DirectResult } } } } })
registry.registerPath({ method: 'post', path: '/mission-control-api/direct/process-instances/suspend', ...authzExtension('engine.runtime.direct.process-instances.suspend', 'POST', '/mission-control-api/direct/process-instances/suspend'), request: { body: { content: { 'application/json': { schema: DirectSuspend } } } }, responses: { 200: { description: 'Result', content: { 'application/json': { schema: DirectResult } } } } })
registry.registerPath({ method: 'post', path: '/mission-control-api/direct/process-instances/activate', ...authzExtension('engine.runtime.direct.process-instances.activate', 'POST', '/mission-control-api/direct/process-instances/activate'), request: { body: { content: { 'application/json': { schema: DirectSuspend } } } }, responses: { 200: { description: 'Result', content: { 'application/json': { schema: DirectResult } } } } })
registry.registerPath({ method: 'post', path: '/mission-control-api/direct/jobs/retries', ...authzExtension('engine.runtime.direct.jobs.retry', 'POST', '/mission-control-api/direct/jobs/retries'), request: { body: { content: { 'application/json': { schema: DirectRetries } } } }, responses: { 200: { description: 'Result', content: { 'application/json': { schema: DirectResult } } } } })

// -----------------------------
// Mission Control API - Extended Endpoints
// -----------------------------

// Tasks
registry.register('Task', TaskSchema);
registry.registerPath({ method: 'get', path: '/mission-control-api/tasks', ...authzExtension('engine.runtime.tasks.read', 'GET', '/mission-control-api/tasks'), request: { query: TaskQueryParams.partial() }, responses: { 200: { description: 'Query tasks', content: { 'application/json': { schema: z.array(TaskSchema) } } } } });
registry.registerPath({ method: 'get', path: '/mission-control-api/tasks/count', ...authzExtension('engine.runtime.tasks.read', 'GET', '/mission-control-api/tasks/count'), request: { query: TaskQueryParams.partial() }, responses: { 200: { description: 'Count tasks', content: { 'application/json': { schema: z.object({ count: z.number() }) } } } } });
registry.registerPath({ method: 'get', path: '/mission-control-api/tasks/{id}', ...authzExtension('engine.runtime.tasks.read', 'GET', '/mission-control-api/tasks/{id}'), request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'Get task', content: { 'application/json': { schema: TaskSchema } } }, 404: { description: 'Not found' } } });
registry.registerPath({ method: 'get', path: '/mission-control-api/tasks/{id}/variables', ...authzExtension('engine.runtime.tasks.variables.read', 'GET', '/mission-control-api/tasks/{id}/variables'), request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'Task variables', content: { 'application/json': { schema: MissionControlVariablesSchema } } } } });
registry.registerPath({ method: 'put', path: '/mission-control-api/tasks/{id}/variables', ...authzExtension('engine.runtime.tasks.variables.update', 'PUT', '/mission-control-api/tasks/{id}/variables'), request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: TaskVariablesRequest } } } }, responses: { 200: { description: 'Variables updated', content: { 'application/json': { schema: z.unknown() } } } } });
registry.registerPath({ method: 'get', path: '/mission-control-api/tasks/{id}/form', ...authzExtension('engine.runtime.tasks.read', 'GET', '/mission-control-api/tasks/{id}/form'), request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'Task form', content: { 'application/json': { schema: z.unknown() } } } } });
registry.registerPath({ method: 'post', path: '/mission-control-api/tasks/{id}/claim', ...authzExtension('engine.runtime.tasks.assignment.update', 'POST', '/mission-control-api/tasks/{id}/claim'), request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: ClaimTaskRequest } } } }, responses: { 204: { description: 'Claimed' } } });
registry.registerPath({ method: 'post', path: '/mission-control-api/tasks/{id}/unclaim', ...authzExtension('engine.runtime.tasks.assignment.update', 'POST', '/mission-control-api/tasks/{id}/unclaim'), request: { params: z.object({ id: z.string() }) }, responses: { 204: { description: 'Unclaimed' } } });
registry.registerPath({ method: 'post', path: '/mission-control-api/tasks/{id}/assignee', ...authzExtension('engine.runtime.tasks.assignment.update', 'POST', '/mission-control-api/tasks/{id}/assignee'), request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: SetAssigneeRequest } } } }, responses: { 204: { description: 'Assignee set' } } });
registry.registerPath({ method: 'post', path: '/mission-control-api/tasks/{id}/complete', ...authzExtension('engine.runtime.tasks.complete', 'POST', '/mission-control-api/tasks/{id}/complete'), request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: CompleteTaskRequest.partial() } } } }, responses: { 200: { description: 'Task completed', content: { 'application/json': { schema: z.unknown() } } } } });

// External Tasks
registry.register('ExternalTask', ExternalTaskSchema);
registry.registerPath({ method: 'post', path: '/mission-control-api/external-tasks/fetchAndLock', ...authzExtension('engine.runtime.external-tasks.fetch-and-lock', 'POST', '/mission-control-api/external-tasks/fetchAndLock'), request: { body: { content: { 'application/json': { schema: FetchAndLockRequest } } } }, responses: { 200: { description: 'Locked external tasks', content: { 'application/json': { schema: z.array(ExternalTaskSchema) } } } } });
registry.registerPath({ method: 'get', path: '/mission-control-api/external-tasks', ...authzExtension('engine.runtime.external-tasks.read', 'GET', '/mission-control-api/external-tasks'), request: { query: ExternalTaskQueryParams.partial() }, responses: { 200: { description: 'Query external tasks', content: { 'application/json': { schema: z.array(ExternalTaskSchema) } } } } });
registry.registerPath({ method: 'post', path: '/mission-control-api/external-tasks/{id}/complete', ...authzExtension('engine.runtime.external-tasks.complete', 'POST', '/mission-control-api/external-tasks/{id}/complete'), request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: CompleteExternalTaskRequest } } } }, responses: { 204: { description: 'Completed' } } });
registry.registerPath({ method: 'post', path: '/mission-control-api/external-tasks/{id}/failure', ...authzExtension('engine.runtime.external-tasks.failure', 'POST', '/mission-control-api/external-tasks/{id}/failure'), request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: ExternalTaskFailureRequest } } } }, responses: { 204: { description: 'Failure reported' } } });
registry.registerPath({ method: 'post', path: '/mission-control-api/external-tasks/{id}/bpmnError', ...authzExtension('engine.runtime.external-tasks.bpmn-error', 'POST', '/mission-control-api/external-tasks/{id}/bpmnError'), request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: ExternalTaskBpmnErrorRequest } } } }, responses: { 204: { description: 'BPMN error reported' } } });
registry.registerPath({ method: 'post', path: '/mission-control-api/external-tasks/{id}/extendLock', ...authzExtension('engine.runtime.external-tasks.extend-lock', 'POST', '/mission-control-api/external-tasks/{id}/extendLock'), request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: ExtendLockRequest } } } }, responses: { 204: { description: 'Lock extended' } } });
registry.registerPath({ method: 'post', path: '/mission-control-api/external-tasks/{id}/unlock', ...authzExtension('engine.runtime.external-tasks.unlock', 'POST', '/mission-control-api/external-tasks/{id}/unlock'), request: { params: z.object({ id: z.string() }) }, responses: { 204: { description: 'Unlocked' } } });

// Messages & Signals
registry.register('MessageCorrelationResult', MessageCorrelationResultSchema);
registry.registerPath({ method: 'post', path: '/mission-control-api/messages', ...authzExtension('engine.runtime.messages.correlate', 'POST', '/mission-control-api/messages'), request: { body: { content: { 'application/json': { schema: CorrelateMessageRequest } } } }, responses: { 200: { description: 'Message correlated', content: { 'application/json': { schema: MessageCorrelationResultSchema } } } } });
registry.registerPath({ method: 'post', path: '/mission-control-api/signals', ...authzExtension('engine.runtime.signals.deliver', 'POST', '/mission-control-api/signals'), request: { body: { content: { 'application/json': { schema: SignalEventSchema } } } }, responses: { 204: { description: 'Signal delivered' } } });

// Decisions
registry.register('DecisionDefinition', DecisionDefinitionSchema);
registry.registerPath({ method: 'get', path: '/mission-control-api/decision-definitions', ...authzExtension('engine.runtime.decisions.read', 'GET', '/mission-control-api/decision-definitions'), request: { query: DecisionDefinitionQueryParams.partial() }, responses: { 200: { description: 'List decision definitions', content: { 'application/json': { schema: z.array(DecisionDefinitionSchema) } } } } });
registry.registerPath({ method: 'get', path: '/mission-control-api/decision-definitions/{id}', ...authzExtension('engine.runtime.decisions.read', 'GET', '/mission-control-api/decision-definitions/{id}'), request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'Get decision definition', content: { 'application/json': { schema: DecisionDefinitionSchema } } }, 404: { description: 'Not found' } } });
registry.registerPath({ method: 'get', path: '/mission-control-api/decision-definitions/{id}/xml', ...authzExtension('engine.runtime.decisions.read', 'GET', '/mission-control-api/decision-definitions/{id}/xml'), request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'DMN XML', content: { 'application/json': { schema: z.object({ dmnXml: z.string() }) } } } } });
registry.registerPath({ method: 'post', path: '/mission-control-api/decision-definitions/{id}/evaluate', ...authzExtension('engine.runtime.decisions.evaluate', 'POST', '/mission-control-api/decision-definitions/{id}/evaluate'), request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: EvaluateDecisionRequest } } } }, responses: { 200: { description: 'Decision result', content: { 'application/json': { schema: z.array(z.unknown()) } } } } });
registry.registerPath({ method: 'post', path: '/mission-control-api/decision-definitions/key/{key}/evaluate', ...authzExtension('engine.runtime.decisions.evaluate', 'POST', '/mission-control-api/decision-definitions/key/{key}/evaluate'), request: { params: z.object({ key: z.string() }), body: { content: { 'application/json': { schema: EvaluateDecisionRequest } } } }, responses: { 200: { description: 'Decision result', content: { 'application/json': { schema: z.array(z.unknown()) } } } } });

// GET /mission-control-api/decision-definitions/edit-target (resolve Starbase edit target for a deployed decision version)
const DecisionEditTargetResponse = z.object({
  canShowEditButton: z.boolean(),
  canEdit: z.boolean(),
  engineId: z.string(),
  decisionKey: z.string(),
  decisionVersion: z.number(),
  projectId: z.string(),
  fileId: z.string(),
  engineDeploymentId: z.string().optional(),
  commitId: z.string().nullable().optional(),
  fileVersionNumber: z.number().nullable().optional(),
  mappingSource: z.enum(['git-commit', 'db-timestamp', 'db-latest', 'deployment-timestamp']).optional(),
  artifactCreatedAt: z.number().optional(),
});
registry.register('DecisionEditTarget', DecisionEditTargetResponse);
registry.registerPath({
  method: 'get',
  path: '/mission-control-api/decision-definitions/edit-target',
  ...authzExtension('engine.runtime.decisions.edit-target.read', 'GET', '/mission-control-api/decision-definitions/edit-target'),
  request: {
    query: z.object({
      engineId: z.string(),
      key: z.string(),
      version: z.string(),
      decisionDefinitionId: z.string().optional(),
    }),
  },
  responses: {
    200: { description: 'Starbase file target for the deployed decision version', content: { 'application/json': { schema: DecisionEditTargetResponse } } },
    404: { description: 'No deployed decision mapping found' },
  },
});

// Jobs
registry.register('Job', JobSchema);
registry.register('JobDefinition', JobDefinitionSchema);
registry.registerPath({ method: 'get', path: '/mission-control-api/jobs', ...authzExtension('engine.runtime.jobs.read', 'GET', '/mission-control-api/jobs'), request: { query: JobQueryParams.partial() }, responses: { 200: { description: 'Query jobs', content: { 'application/json': { schema: z.array(JobSchema) } } } } });
registry.registerPath({ method: 'get', path: '/mission-control-api/jobs/{id}', ...authzExtension('engine.runtime.jobs.read', 'GET', '/mission-control-api/jobs/{id}'), request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'Get job', content: { 'application/json': { schema: JobSchema } } }, 404: { description: 'Not found' } } });
registry.registerPath({ method: 'post', path: '/mission-control-api/jobs/{id}/execute', ...authzExtension('engine.runtime.jobs.execute', 'POST', '/mission-control-api/jobs/{id}/execute'), request: { params: z.object({ id: z.string() }) }, responses: { 204: { description: 'Job executed' } } });
registry.registerPath({ method: 'put', path: '/mission-control-api/jobs/{id}/retries', ...authzExtension('engine.runtime.jobs.retries.update', 'PUT', '/mission-control-api/jobs/{id}/retries'), request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: SetJobRetriesRequest } } } }, responses: { 204: { description: 'Retries set' } } });
registry.registerPath({ method: 'put', path: '/mission-control-api/jobs/{id}/suspended', ...authzExtension('engine.runtime.jobs.suspension.update', 'PUT', '/mission-control-api/jobs/{id}/suspended'), request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: SetJobSuspensionStateRequest } } } }, responses: { 204: { description: 'Suspension state updated' } } });
registry.registerPath({ method: 'get', path: '/mission-control-api/job-definitions', ...authzExtension('engine.runtime.job-definitions.read', 'GET', '/mission-control-api/job-definitions'), request: { query: JobDefinitionQueryParams.partial() }, responses: { 200: { description: 'Query job definitions', content: { 'application/json': { schema: z.array(JobDefinitionSchema) } } } } });
registry.registerPath({ method: 'put', path: '/mission-control-api/job-definitions/{id}/retries', ...authzExtension('engine.runtime.job-definitions.retries.update', 'PUT', '/mission-control-api/job-definitions/{id}/retries'), request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: SetJobDefinitionRetriesRequest } } } }, responses: { 204: { description: 'Retries set' } } });
registry.registerPath({ method: 'put', path: '/mission-control-api/job-definitions/{id}/suspended', ...authzExtension('engine.runtime.job-definitions.suspension.update', 'PUT', '/mission-control-api/job-definitions/{id}/suspended'), request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: SetJobDefinitionSuspensionStateRequest } } } }, responses: { 204: { description: 'Suspension state updated' } } });

// Extended History
registry.register('HistoricTaskInstance', HistoricTaskInstanceSchema);
registry.register('HistoricVariableInstance', HistoricVariableInstanceSchema);
registry.register('VariableHistoryEntry', VariableHistoryEntrySchema);
registry.register('HistoricDecisionInstance', HistoricDecisionInstanceSchema);
registry.register('UserOperationLogEntry', UserOperationLogEntrySchema);
registry.registerPath({ method: 'get', path: '/mission-control-api/history/tasks', ...authzExtension('engine.runtime.history.tasks.read', 'GET', '/mission-control-api/history/tasks'), request: { query: HistoricTaskQueryParams.partial() }, responses: { 200: { description: 'Historic task instances', content: { 'application/json': { schema: z.array(HistoricTaskInstanceSchema) } } } } });
registry.registerPath({ method: 'get', path: '/mission-control-api/history/variables', ...authzExtension('engine.runtime.history.variables.read', 'GET', '/mission-control-api/history/variables'), request: { query: HistoricVariableQueryParams.partial() }, responses: { 200: { description: 'Historic variable instances', content: { 'application/json': { schema: z.array(HistoricVariableInstanceSchema) } } } } });
registry.registerPath({ method: 'get', path: '/mission-control-api/history/decisions', ...authzExtension('engine.runtime.history.decisions.read', 'GET', '/mission-control-api/history/decisions'), request: { query: HistoricDecisionQueryParams.partial() }, responses: { 200: { description: 'Historic decision instances', content: { 'application/json': { schema: z.array(HistoricDecisionInstanceSchema) } } } } });
registry.registerPath({ method: 'get', path: '/mission-control-api/history/decisions/{id}/inputs', ...authzExtension('engine.runtime.history.decisions.inputs.read', 'GET', '/mission-control-api/history/decisions/{id}/inputs'), request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'Inputs for a historic decision instance', content: { 'application/json': { schema: z.array(z.unknown()) } } }, 404: { description: 'Not found' } } });
registry.registerPath({ method: 'get', path: '/mission-control-api/history/decisions/{id}/outputs', ...authzExtension('engine.runtime.history.decisions.outputs.read', 'GET', '/mission-control-api/history/decisions/{id}/outputs'), request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'Outputs for a historic decision instance', content: { 'application/json': { schema: z.array(z.unknown()) } } }, 404: { description: 'Not found' } } });
registry.registerPath({ method: 'get', path: '/mission-control-api/history/user-operations', ...authzExtension('engine.runtime.history.user-operations.read', 'GET', '/mission-control-api/history/user-operations'), request: { query: UserOperationLogQueryParams.partial() }, responses: { 200: { description: 'User operation log', content: { 'application/json': { schema: z.array(UserOperationLogEntrySchema) } } } } });

// Metrics
registry.register('Metric', MetricSchema);
registry.registerPath({ method: 'get', path: '/mission-control-api/metrics', ...authzExtension('engine.runtime.metrics.read', 'GET', '/mission-control-api/metrics'), request: { query: MetricsQueryParams.partial() }, responses: { 200: { description: 'Query metrics', content: { 'application/json': { schema: z.array(MetricSchema) } } } } });
registry.registerPath({ method: 'get', path: '/mission-control-api/metrics/{name}', ...authzExtension('engine.runtime.metrics.read', 'GET', '/mission-control-api/metrics/{name}'), request: { params: z.object({ name: z.string() }), query: MetricsQueryParams.partial() }, responses: { 200: { description: 'Get metric by name', content: { 'application/json': { schema: z.array(MetricSchema) } } } } });

// -----------------------------
// Modification & Restart
// -----------------------------
registry.register('ModificationInstruction', ModificationInstructionSchema)
registry.register('ProcessInstanceModificationRequest', ProcessInstanceModificationRequest)
registry.register('ProcessDefinitionModificationAsyncRequest', ProcessDefinitionModificationAsyncRequest)
registry.register('ProcessDefinitionRestartAsyncRequest', ProcessDefinitionRestartAsyncRequest)

// POST /mission-control-api/process-instances/{id}/modify
registry.registerPath({
  method: 'post',
  path: '/mission-control-api/process-instances/{id}/modify',
  ...authzExtension('engine.runtime.process-instances.modify', 'POST', '/mission-control-api/process-instances/{id}/modify'),
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: ProcessInstanceModificationRequest } } } },
  responses: { 204: { description: 'Modified' } },
})

// POST /mission-control-api/process-definitions/{id}/modification/execute-async
registry.registerPath({
  method: 'post',
  path: '/mission-control-api/process-definitions/{id}/modification/execute-async',
  ...authzExtension('engine.runtime.process-definitions.modification.execute-async', 'POST', '/mission-control-api/process-definitions/{id}/modification/execute-async'),
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: ProcessDefinitionModificationAsyncRequest } } } },
  responses: { 201: { description: 'Batch created', content: { 'application/json': { schema: z.object({ id: z.string(), camundaBatchId: z.string().optional(), type: z.literal('MODIFY_INSTANCES') }) } } } },
})

// POST /mission-control-api/process-definitions/{id}/restart/execute-async
registry.registerPath({
  method: 'post',
  path: '/mission-control-api/process-definitions/{id}/restart/execute-async',
  ...authzExtension('engine.runtime.process-definitions.restart.execute-async', 'POST', '/mission-control-api/process-definitions/{id}/restart/execute-async'),
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: ProcessDefinitionRestartAsyncRequest } } } },
  responses: { 201: { description: 'Batch created', content: { 'application/json': { schema: z.object({ id: z.string(), camundaBatchId: z.string().optional(), type: z.literal('RESTART_INSTANCES') }) } } } },
})

// -----------------------------
// Git Versioning API
// -----------------------------

// Register Git schemas
registry.register('Repository', RepositorySelectSchema);
registry.register('InitRepositoryRequest', InitRepositoryRequestSchema);
registry.register('CloneRepositoryRequest', CloneRepositoryRequestSchema);
registry.register('DeployRequest', DeployRequestSchema);
registry.register('RollbackRequest', RollbackRequestSchema);
registry.register('DeploymentResponse', DeploymentResponseSchema);
registry.register('AcquireLockRequest', AcquireLockRequestSchema);
registry.register('LockResponse', LockResponseSchema);

// POST /git-api/repositories/init (initialize new repository)
registry.registerPath({
  method: 'post',
  path: '/git-api/repositories/init',
  ...authzExtension('project.git.repositories.manage', 'POST', '/git-api/repositories/init'),
  request: { body: { content: { 'application/json': { schema: InitRepositoryRequestSchema } } } },
  responses: {
    201: { description: 'Repository initialized', content: { 'application/json': { schema: RepositorySelectSchema } } },
    403: { description: 'Forbidden' },
  },
});

// POST /git-api/repositories/clone (clone existing repository)
registry.registerPath({
  method: 'post',
  path: '/git-api/repositories/clone',
  ...authzExtension('project.git.repositories.manage', 'POST', '/git-api/repositories/clone'),
  request: { body: { content: { 'application/json': { schema: CloneRepositoryRequestSchema } } } },
  responses: {
    201: { description: 'Repository cloned', content: { 'application/json': { schema: RepositorySelectSchema } } },
    403: { description: 'Forbidden' },
  },
});

// GET /git-api/repositories (list user repositories)
registry.registerPath({
  method: 'get',
  path: '/git-api/repositories',
  ...authzExtension('project.git.repositories.read', 'GET', '/git-api/repositories'),
  responses: {
    200: { description: 'List of repositories', content: { 'application/json': { schema: z.array(RepositorySelectSchema) } } },
  },
});

// GET /git-api/repositories/:id (get repository details)
registry.registerPath({
  method: 'get',
  path: '/git-api/repositories/{id}',
  ...authzExtension('project.git.repositories.read', 'GET', '/git-api/repositories/:id'),
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: { description: 'Repository details', content: { 'application/json': { schema: RepositorySelectSchema } } },
    404: { description: 'Repository not found' },
  },
});

// DELETE /git-api/repositories/:id (delete repository)
registry.registerPath({
  method: 'delete',
  path: '/git-api/repositories/{id}',
  ...authzExtension('project.git.repositories.manage', 'DELETE', '/git-api/repositories/:id'),
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    204: { description: 'Repository deleted' },
    404: { description: 'Repository not found' },
  },
});

// POST /git-api/deploy (deploy project)
registry.registerPath({
  method: 'post',
  path: '/git-api/deploy',
  ...authzExtension('project-engine-target.deploy.use', 'POST', '/git-api/deploy'),
  request: { body: { content: { 'application/json': { schema: DeployRequestSchema } } } },
  responses: {
    201: { description: 'Deployment successful', content: { 'application/json': { schema: DeploymentResponseSchema } } },
    403: { description: 'Forbidden' },
  },
});

// POST /git-api/rollback (rollback to commit)
registry.registerPath({
  method: 'post',
  path: '/git-api/rollback',
  ...authzExtension('project.git.rollback', 'POST', '/git-api/rollback'),
  request: { body: { content: { 'application/json': { schema: RollbackRequestSchema } } } },
  responses: {
    200: { description: 'Rollback successful', content: { 'application/json': { schema: z.object({ success: z.boolean(), message: z.string() }) } } },
    403: { description: 'Forbidden' },
  },
});

// GET /git-api/commits (get commit history)
registry.registerPath({
  method: 'get',
  path: '/git-api/commits',
  ...authzExtension('project.deployments.read', 'GET', '/git-api/commits'),
  request: { query: z.object({ projectId: z.string().uuid(), limit: z.string().optional() }) },
  responses: {
    200: { description: 'Commit history', content: { 'application/json': { schema: z.unknown() } } },
    400: { description: 'Bad request' },
  },
});

// POST /git-api/locks (acquire file lock)
registry.registerPath({
  method: 'post',
  path: '/git-api/locks',
  ...authzExtension('project.git.locks.acquire', 'POST', '/git-api/locks'),
  request: { body: { content: { 'application/json': { schema: AcquireLockRequestSchema } } } },
  responses: {
    201: { description: 'Lock acquired', content: { 'application/json': { schema: LockResponseSchema } } },
    409: { description: 'File locked by another user' },
  },
});

// DELETE /git-api/locks/:lockId (release lock)
registry.registerPath({
  method: 'delete',
  path: '/git-api/locks/{lockId}',
  ...authzExtension('project.git.locks.release', 'DELETE', '/git-api/locks/:lockId'),
  request: { params: z.object({ lockId: z.string().uuid() }) },
  responses: {
    204: { description: 'Lock released' },
  },
});

// GET /git-api/locks (list active locks)
registry.registerPath({
  method: 'get',
  path: '/git-api/locks',
  ...authzExtension('project.git.locks.read', 'GET', '/git-api/locks'),
  request: { query: z.object({ projectId: z.string().uuid() }) },
  responses: {
    200: { description: 'Active locks', content: { 'application/json': { schema: z.object({ locks: z.array(LockResponseSchema) }) } } },
    400: { description: 'Bad request' },
  },
});

// -----------------------------
// Platform Admin API
// -----------------------------
const {
  EnvironmentTagSchema,
  CreateEnvironmentTagRequest,
  UpdateEnvironmentTagRequest,
  ReorderEnvironmentTagsRequest,
  PlatformSettingsSchema,
  UpdatePlatformSettingsRequest,
  EngineOnboardingModeSchema,
  EngineRuntimeAuthorizationModeSchema,
  UnsupportedEngineRuntimeAuthorizationModeErrorSchema,
  EnterpriseGlueConfigBundleSchema,
  ConfigEngineSchema,
  ConfigAssignmentsFileSchema,
  ConfigEnginesFileSchema,
  ConfigEngineSetsFileSchema,
  ConfigGroupsFileSchema,
  ConfigIdentityMappingsFileSchema,
  ConfigIdentityProvidersFileSchema,
  ConfigProjectEngineTargetsFileSchema,
  ConfigRolesFileSchema,
  ConfigRuntimeResourceSetsFileSchema,
  ProjectEngineTargetPolicyModeSchema,
  ProjectMemberSchema,
  AddProjectMemberRequest,
  UpdateProjectMemberRoleRequest,
  TransferProjectOwnershipRequest,
  EngineMemberSchema,
  EngineMembersResponseSchema,
  EngineWithDetailsSchema,
  EngineRoleResponse,
  AddEngineMemberRequest,
  UpdateEngineMemberRoleRequest,
  AssignDelegateRequest,
  TransferEngineOwnershipRequest,
  SetEnvironmentRequest,
  SetLockedRequest,
  RequestAccessRequest,
  AssignOwnerRequest,
  UserSearchResultSchema,
  UserListItemSchema,
  SuccessResponseSchema,
} = await import('@enterpriseglue/shared/schemas/platform-admin/index.js');

// Environment Tags
registry.register('EnvironmentTag', EnvironmentTagSchema);
registry.registerPath({
  method: 'get',
  path: '/api/admin/environments',
  ...authzExtension('platform.settings.read', 'GET', '/api/admin/environments'),
  responses: { 200: { description: 'List environment tags', content: { 'application/json': { schema: z.array(EnvironmentTagSchema) } } } },
});

registry.registerPath({
  method: 'post',
  path: '/api/admin/environments',
  ...authzExtension('platform.settings.manage', 'POST', '/api/admin/environments'),
  request: { body: { content: { 'application/json': { schema: CreateEnvironmentTagRequest } } } },
  responses: { 201: { description: 'Created', content: { 'application/json': { schema: EnvironmentTagSchema } } } },
});

registry.registerPath({
  method: 'put',
  path: '/api/admin/environments/{id}',
  ...authzExtension('platform.settings.manage', 'PUT', '/api/admin/environments/{id}'),
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: UpdateEnvironmentTagRequest } } } },
  responses: { 200: { description: 'Updated', content: { 'application/json': { schema: SuccessResponseSchema } } } },
});

registry.registerPath({
  method: 'delete',
  path: '/api/admin/environments/{id}',
  ...authzExtension('platform.settings.manage', 'DELETE', '/api/admin/environments/{id}'),
  request: { params: z.object({ id: z.string() }) },
  responses: { 204: { description: 'Deleted' }, 400: { description: 'In use' } },
});

registry.registerPath({
  method: 'post',
  path: '/api/admin/environments/reorder',
  ...authzExtension('platform.settings.manage', 'POST', '/api/admin/environments/reorder'),
  request: { body: { content: { 'application/json': { schema: ReorderEnvironmentTagsRequest } } } },
  responses: { 200: { description: 'Reordered', content: { 'application/json': { schema: SuccessResponseSchema } } } },
});

// Platform Branding
const PlatformBrandingSchema = z.object({
  logoUrl: z.string().nullable(),
  loginLogoUrl: z.string().nullable(),
  loginTitleVerticalOffset: z.number(),
  loginTitleColor: z.string().nullable(),
  logoTitle: z.string().nullable(),
  logoScale: z.number(),
  titleFontUrl: z.string().nullable(),
  titleFontWeight: z.string(),
  titleFontSize: z.number(),
  titleVerticalOffset: z.number(),
  menuAccentColor: z.string().nullable(),
  faviconUrl: z.string().nullable(),
});
const UpdatePlatformBrandingRequest = PlatformBrandingSchema.partial();
registry.register('PlatformBranding', PlatformBrandingSchema);
registry.registerPath({
  method: 'get',
  path: '/api/admin/branding',
  ...authzExtension('platform.settings.read', 'GET', '/api/admin/branding'),
  responses: { 200: { description: 'Platform branding', content: { 'application/json': { schema: PlatformBrandingSchema } } } },
});

registry.registerPath({
  method: 'put',
  path: '/api/admin/branding',
  ...authzExtension('platform.settings.manage', 'PUT', '/api/admin/branding'),
  request: { body: { content: { 'application/json': { schema: UpdatePlatformBrandingRequest } } } },
  responses: { 200: { description: 'Branding updated', content: { 'application/json': { schema: SuccessResponseSchema } } } },
});

registry.registerPath({
  method: 'delete',
  path: '/api/admin/branding',
  ...authzExtension('platform.settings.manage', 'DELETE', '/api/admin/branding'),
  responses: { 200: { description: 'Branding reset', content: { 'application/json': { schema: SuccessResponseSchema } } } },
});

// Platform Settings
registry.register('EngineRuntimeAuthorizationMode', EngineRuntimeAuthorizationModeSchema);
registry.register('UnsupportedEngineRuntimeAuthorizationModeError', UnsupportedEngineRuntimeAuthorizationModeErrorSchema);
registry.register('PlatformSettings', PlatformSettingsSchema);
const PublicPlatformSettingsSchema = z.object({
  syncPushEnabled: z.boolean(),
  syncPullEnabled: z.boolean(),
  gitProjectTokenSharingEnabled: z.boolean(),
  defaultDeployRoles: z.array(z.string()),
  engineOnboardingMode: EngineOnboardingModeSchema,
  projectEngineTargetMode: ProjectEngineTargetPolicyModeSchema,
  engineRuntimeAuthorizationMode: EngineRuntimeAuthorizationModeSchema,
  ssoAllEnginesAssignmentMappingsEnabled: z.boolean(),
  ssoEngineOwnerAssignmentMappingsEnabled: z.boolean(),
  ssoEngineDelegateAssignmentMappingsEnabled: z.boolean(),
  ssoRegexClaimMappingsEnabled: z.boolean(),
  ssoBroadEntitlementMappingsEnabled: z.boolean(),
  ssoSecretViewMappingsEnabled: z.boolean(),
  ssoUnredactedAuditMappingsEnabled: z.boolean(),
  ssoPermanentDeleteMappingsEnabled: z.boolean(),
});
registry.register('PublicPlatformSettings', PublicPlatformSettingsSchema);
registry.registerPath({
  method: 'get',
  path: '/api/admin/settings',
  ...authzExtension('platform.settings.read', 'GET', '/api/admin/settings'),
  responses: { 200: { description: 'Platform settings', content: { 'application/json': { schema: PlatformSettingsSchema } } } },
});

registry.registerPath({
  method: 'put',
  path: '/api/admin/settings',
  ...authzExtension('platform.settings.manage', 'PUT', '/api/admin/settings'),
  request: { body: { content: { 'application/json': { schema: UpdatePlatformSettingsRequest } } } },
  responses: {
    200: { description: 'Updated', content: { 'application/json': { schema: SuccessResponseSchema } } },
    400: { description: 'Unsupported runtime authorization mode', content: { 'application/json': { schema: UnsupportedEngineRuntimeAuthorizationModeErrorSchema } } },
  },
});

// Admin Governance
const GovernanceProjectSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  ownerEmail: z.string().nullable(),
  ownerName: z.string().nullable(),
  delegateEmail: z.string().nullable(),
  delegateName: z.string().nullable(),
  createdAt: z.number(),
});
const GovernanceEngineSummarySchema = GovernanceProjectSummarySchema.extend({
  type: z.string(),
});
registry.registerPath({
  method: 'get',
  path: '/api/admin/projects',
  ...authzExtension('platform.governance.read', 'GET', '/api/admin/projects'),
  request: { query: z.object({ search: z.string().optional() }) },
  responses: { 200: { description: 'Governance project list', content: { 'application/json': { schema: z.array(GovernanceProjectSummarySchema) } } } },
});

registry.registerPath({
  method: 'get',
  path: '/api/admin/engines',
  ...authzExtension('platform.governance.read', 'GET', '/api/admin/engines'),
  request: { query: z.object({ search: z.string().optional() }) },
  responses: { 200: { description: 'Governance engine list', content: { 'application/json': { schema: z.array(GovernanceEngineSummarySchema) } } } },
});

registry.registerPath({
  method: 'post',
  path: '/api/admin/projects/{projectId}/assign-owner',
  ...authzExtension('platform.governance.manage', 'POST', '/api/admin/projects/{projectId}/assign-owner'),
  request: { params: z.object({ projectId: z.string().uuid() }), body: { content: { 'application/json': { schema: AssignOwnerRequest } } } },
  responses: { 200: { description: 'Owner assigned', content: { 'application/json': { schema: SuccessResponseSchema } } } },
});

registry.registerPath({
  method: 'post',
  path: '/api/admin/projects/{projectId}/assign-delegate',
  ...authzExtension('platform.governance.manage', 'POST', '/api/admin/projects/{projectId}/assign-delegate'),
  request: { params: z.object({ projectId: z.string().uuid() }), body: { content: { 'application/json': { schema: AssignOwnerRequest } } } },
  responses: { 200: { description: 'Delegate assigned', content: { 'application/json': { schema: SuccessResponseSchema } } } },
});

registry.registerPath({
  method: 'post',
  path: '/api/admin/engines/{engineId}/assign-owner',
  ...authzExtension('platform.governance.manage', 'POST', '/api/admin/engines/{engineId}/assign-owner'),
  request: { params: z.object({ engineId: z.string() }), body: { content: { 'application/json': { schema: AssignOwnerRequest } } } },
  responses: { 200: { description: 'Owner assigned', content: { 'application/json': { schema: SuccessResponseSchema } } } },
});

registry.registerPath({
  method: 'post',
  path: '/api/admin/engines/{engineId}/assign-delegate',
  ...authzExtension('platform.governance.manage', 'POST', '/api/admin/engines/{engineId}/assign-delegate'),
  request: { params: z.object({ engineId: z.string() }), body: { content: { 'application/json': { schema: AssignOwnerRequest } } } },
  responses: { 200: { description: 'Delegate assigned', content: { 'application/json': { schema: z.object({ success: z.boolean(), engineId: z.string(), delegateId: z.string().nullable(), previousDelegateId: z.string().nullable() }) } } } },
});

// Admin Users
registry.register('UserSearchResult', UserSearchResultSchema);
registry.register('UserListItem', UserListItemSchema);
registry.registerPath({
  method: 'get',
  path: '/api/admin/users/search',
  ...authzExtension('platform.governance.read', 'GET', '/api/admin/users/search'),
  request: { query: z.object({ q: z.string() }) },
  responses: { 200: { description: 'Search results', content: { 'application/json': { schema: z.array(UserSearchResultSchema) } } } },
});

// SSO Providers
const SsoProviderTypeSchema = z.enum(['microsoft', 'google', 'saml', 'oidc']);
const SsoProviderResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: SsoProviderTypeSchema,
  enabled: z.boolean(),
  clientId: z.string().optional(),
  tenantId: z.string().optional(),
  issuerUrl: z.string().optional(),
  scopes: z.string().optional(),
  callbackUrl: z.string().optional(),
  iconUrl: z.string().optional(),
  buttonLabel: z.string().optional(),
  buttonColor: z.string().optional(),
  displayOrder: z.number(),
  autoProvision: z.boolean(),
  defaultRole: z.enum(['admin', 'user']),
  createdAt: z.number(),
  updatedAt: z.number(),
});
const SsoProviderCreateRequestSchema = z.object({
  name: z.string().min(1).max(100),
  type: SsoProviderTypeSchema,
  enabled: z.boolean().optional(),
  riskAcknowledged: z.boolean().optional(),
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  tenantId: z.string().optional(),
  issuerUrl: z.string().url().optional().or(z.literal('')),
  authorizationUrl: z.string().url().optional().or(z.literal('')),
  tokenUrl: z.string().url().optional().or(z.literal('')),
  userInfoUrl: z.string().url().optional().or(z.literal('')),
  scopes: z.array(z.string()).optional(),
  entityId: z.string().optional(),
  ssoUrl: z.string().url().optional().or(z.literal('')),
  sloUrl: z.string().url().optional().or(z.literal('')),
  certificate: z.string().optional(),
  signatureAlgorithm: z.enum(['sha256', 'sha512']).optional(),
  iconUrl: z.string().url().optional().or(z.literal('')),
  buttonLabel: z.string().optional(),
  buttonColor: z.string().optional(),
  displayOrder: z.number().int().optional(),
  autoProvision: z.boolean().optional(),
});
const SsoProviderUpdateRequestSchema = SsoProviderCreateRequestSchema.partial();
const SsoProviderToggleRequestSchema = z.object({
  riskAcknowledged: z.boolean().optional(),
});
const SsoProviderPublicSchema = SsoProviderResponseSchema.pick({
  id: true,
  name: true,
  type: true,
  buttonLabel: true,
  buttonColor: true,
  iconUrl: true,
});
registry.registerPath({
  method: 'get',
  path: '/api/sso/providers',
  ...authzExtension('platform.sso.providers.read', 'GET', '/api/sso/providers'),
  responses: { 200: { description: 'List SSO providers', content: { 'application/json': { schema: z.array(SsoProviderResponseSchema) } } } },
});

registry.registerPath({
  method: 'get',
  path: '/api/sso/providers/enabled',
  ...authzExemption('GET', '/api/sso/providers/enabled'),
  responses: { 200: { description: 'List enabled public SSO providers', content: { 'application/json': { schema: z.array(SsoProviderPublicSchema) } } } },
});

registry.registerPath({
  method: 'get',
  path: '/api/sso/providers/{id}',
  ...authzExtension('platform.sso.providers.read', 'GET', '/api/sso/providers/{id}'),
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: 'SSO provider', content: { 'application/json': { schema: SsoProviderResponseSchema } } }, 404: { description: 'Provider not found' } },
});

registry.registerPath({
  method: 'post',
  path: '/api/sso/providers',
  ...authzExtension('platform.sso.providers.manage', 'POST', '/api/sso/providers'),
  request: { body: { content: { 'application/json': { schema: SsoProviderCreateRequestSchema } } } },
  responses: { 201: { description: 'SSO provider created', content: { 'application/json': { schema: z.object({ id: z.string() }) } } } },
});

registry.registerPath({
  method: 'put',
  path: '/api/sso/providers/{id}',
  ...authzExtension('platform.sso.providers.manage', 'PUT', '/api/sso/providers/{id}'),
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: SsoProviderUpdateRequestSchema } } } },
  responses: { 200: { description: 'SSO provider updated', content: { 'application/json': { schema: SuccessResponseSchema } } }, 404: { description: 'Provider not found' } },
});

registry.registerPath({
  method: 'delete',
  path: '/api/sso/providers/{id}',
  ...authzExtension('platform.sso.providers.manage', 'DELETE', '/api/sso/providers/{id}'),
  request: { params: z.object({ id: z.string() }) },
  responses: { 204: { description: 'SSO provider deleted' }, 404: { description: 'Provider not found' } },
});

registry.registerPath({
  method: 'post',
  path: '/api/sso/providers/{id}/toggle',
  ...authzExtension('platform.sso.providers.manage', 'POST', '/api/sso/providers/{id}/toggle'),
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: SsoProviderToggleRequestSchema } } } },
  responses: { 200: { description: 'SSO provider enabled state toggled', content: { 'application/json': { schema: z.object({ enabled: z.boolean() }) } } }, 404: { description: 'Provider not found' } },
});

registry.registerPath({
  method: 'post',
  path: '/api/sso/providers/{id}/migrate-default-role',
  ...authzExtension('platform.sso.providers.manage', 'POST', '/api/sso/providers/{id}/migrate-default-role'),
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: z.object({ providerKey: z.string().min(1).max(160), riskAcknowledged: z.boolean().optional() }) } } } },
  responses: { 201: { description: 'Legacy provider default role converted to an explicit identity mapping' }, 400: { description: 'Conversion validation failed' }, 404: { description: 'Provider not found' } },
});

// Provider-neutral identity providers. Configuration holds only references to
// secrets; the values behind those references are never returned by this API.
const identityProviderMigrationSchemas = await import('./platform-admin/authz.js');
registry.register('IdentityProvider', identityProviderMigrationSchemas.IdentityProviderResponseSchema);
registry.registerPath({
  method: 'get',
  path: '/api/identity/providers',
  ...authzExtension('platform.sso.providers.read', 'GET', '/api/identity/providers'),
  responses: { 200: { description: 'List identity providers', content: { 'application/json': { schema: z.array(identityProviderMigrationSchemas.IdentityProviderResponseSchema) } } } },
});
const LegacyIdentityProviderMigrationDraftSchema = z.object({
  legacyProvider: z.object({ id: z.string(), name: z.string(), type: z.enum(['microsoft', 'google', 'oidc', 'saml']), enabled: z.boolean(), clientSecretConfigured: z.boolean().optional(), signingCertificateConfigured: z.boolean().optional() }),
  provider: z.discriminatedUnion('protocol', [
    z.object({ key: z.string(), protocol: z.literal('oidc'), isEnabled: z.literal(false), authenticationMode: z.literal('direct'), directoryTenantId: z.string().nullable(), configuration: z.object({ issuerUrl: z.string().url(), clientId: z.string(), callbackUrl: z.string().url(), scopes: z.array(z.string()), clientSecretRef: z.string().optional() }) }),
    z.object({ key: z.string(), protocol: z.literal('saml'), isEnabled: z.literal(false), authenticationMode: z.literal('direct'), directoryTenantId: z.null(), configuration: z.object({ entityId: z.string(), callbackUrl: z.string().url(), ssoUrl: z.string().url(), signingCertificateRef: z.string(), signatureAlgorithm: z.enum(['sha256', 'sha512']) }) }),
  ]),
  requirements: z.array(z.enum(['client_secret_reference', 'signing_certificate_reference', 'identity_provider_redirect_uri', 'identity_mappings', 'legacy_provider_cutover'])),
  warnings: z.array(z.string()),
});
registry.register('LegacyIdentityProviderMigrationDraft', LegacyIdentityProviderMigrationDraftSchema);
registry.registerPath({
  method: 'get',
  path: '/api/identity/providers/environment-migration-drafts',
  ...authzExtension('platform.sso.providers.manage', 'GET', '/api/identity/providers/environment-migration-drafts'),
  responses: { 200: { description: 'Non-secret disabled provider-neutral drafts for configured legacy environment providers', content: { 'application/json': { schema: z.array(LegacyIdentityProviderMigrationDraftSchema) } } } },
});
registry.registerPath({
  method: 'get',
  path: '/api/identity/providers/legacy-migration-draft/{legacyProviderId}',
  ...authzExtension('platform.sso.providers.manage', 'GET', '/api/identity/providers/legacy-migration-draft/{legacyProviderId}'),
  request: { params: z.object({ legacyProviderId: z.string().min(1).max(128) }) },
  responses: { 200: { description: 'Non-secret disabled provider-neutral draft for a legacy OIDC or SAML provider migration', content: { 'application/json': { schema: LegacyIdentityProviderMigrationDraftSchema } } }, 400: { description: 'Legacy provider cannot be represented as provider-neutral sign-in' }, 404: { description: 'Legacy provider not found' } },
});
registry.registerPath({
  method: 'get',
  path: '/api/identity/providers/migration-readiness',
  ...authzExtension('platform.sso.providers.manage', 'GET', '/api/identity/providers/migration-readiness'),
  request: { query: identityProviderMigrationSchemas.IdentityProviderMigrationReadinessQuerySchema },
  responses: {
    200: {
      description: 'Non-mutating provider-neutral migration readiness and blockers, optionally including the selected legacy provider default-role mapping',
      content: { 'application/json': { schema: identityProviderMigrationSchemas.IdentityProviderMigrationReadinessResponseSchema } },
    },
  },
});
registry.registerPath({
  method: 'post',
  path: '/api/identity/providers/legacy-cutover',
  ...authzExtension('platform.sso.providers.manage', 'POST', '/api/identity/providers/legacy-cutover'),
  request: { body: { content: { 'application/json': { schema: identityProviderMigrationSchemas.LegacyIdentityProviderCutoverRequestSchema } } } },
  responses: { 200: { description: 'Disable a persisted legacy provider after its provider-neutral replacement passes readiness checks', content: { 'application/json': { schema: identityProviderMigrationSchemas.LegacyIdentityProviderCutoverResponseSchema } } }, 400: { description: 'Target provider is not ready or legacy provider is environment-managed' }, 404: { description: 'Legacy provider not found' } },
});
registry.registerPath({
  method: 'post',
  path: '/api/identity/providers/{key}/external-identities/unlink',
  ...authzExtension('platform.sso.providers.manage', 'POST', '/api/identity/providers/{key}/external-identities/unlink'),
  request: {
    params: z.object({ key: z.string().min(1).max(128) }),
    body: { content: { 'application/json': { schema: identityProviderMigrationSchemas.IdentityProviderExternalIdentityUnlinkRequestSchema } } },
  },
  responses: {
    200: { description: 'Explicitly unlink a conflicting provider subject without reassigning it to another account', content: { 'application/json': { schema: identityProviderMigrationSchemas.IdentityProviderExternalIdentityUnlinkResponseSchema } } },
    400: { description: 'The requested link cannot be unlinked' },
    404: { description: 'Identity provider or external identity not found' },
  },
});
registry.registerPath({
  method: 'get',
  path: '/api/identity/providers/{key}',
  ...authzExtension('platform.sso.providers.read', 'GET', '/api/identity/providers/{key}'),
  request: { params: z.object({ key: z.string() }) },
  responses: { 200: { description: 'Identity provider', content: { 'application/json': { schema: identityProviderMigrationSchemas.IdentityProviderResponseSchema } } }, 404: { description: 'Identity provider not found' } },
});
const identityProviderDiagnosticSchemas = await import('./platform-admin/authz.js');
registry.registerPath({
  method: 'get',
  path: '/api/identity/providers/{key}/sync-runs',
  ...authzExtension('platform.sso.providers.read', 'GET', '/api/identity/providers/{key}/sync-runs'),
  request: { params: z.object({ key: z.string() }), query: identityProviderDiagnosticSchemas.IdentityProviderSyncRunsQuerySchema },
  responses: { 200: { description: 'Recent identity provider synchronization runs', content: { 'application/json': { schema: z.array(identityProviderDiagnosticSchemas.SsoSyncRunSchema) } } }, 404: { description: 'Identity provider not found' } },
});
registry.registerPath({
  method: 'get',
  path: '/api/identity/providers/{key}/sync-runs/{runId}/events',
  ...authzExtension('platform.sso.providers.read', 'GET', '/api/identity/providers/{key}/sync-runs/{runId}/events'),
  request: { params: z.object({ key: z.string(), runId: z.string().min(1).max(128) }), query: identityProviderDiagnosticSchemas.IdentityProviderSyncEventsQuerySchema },
  responses: { 200: { description: 'Provider-scoped synchronization events for one run', content: { 'application/json': { schema: z.array(identityProviderDiagnosticSchemas.SsoSyncEventSchema) } } }, 404: { description: 'Identity provider not found' } },
});
registry.registerPath({
  method: 'post',
  path: '/api/identity/providers',
  ...authzExtension('platform.sso.providers.manage', 'POST', '/api/identity/providers'),
  request: { body: { content: { 'application/json': { schema: identityProviderMigrationSchemas.IdentityProviderRequestSchema } } } },
  responses: { 201: { description: 'Identity provider created', content: { 'application/json': { schema: identityProviderMigrationSchemas.IdentityProviderResponseSchema } } } },
});
registry.registerPath({
  method: 'put',
  path: '/api/identity/providers/{key}',
  ...authzExtension('platform.sso.providers.manage', 'PUT', '/api/identity/providers/{key}'),
  request: { params: z.object({ key: z.string() }), body: { content: { 'application/json': { schema: identityProviderMigrationSchemas.IdentityProviderUpdateSchema } } } },
  responses: { 200: { description: 'Identity provider updated', content: { 'application/json': { schema: identityProviderMigrationSchemas.IdentityProviderResponseSchema } } }, 404: { description: 'Identity provider not found' } },
});
registry.registerPath({
  method: 'post',
  path: '/api/identity/providers/{key}/reconcile',
  ...authzExtension('platform.sso.providers.manage', 'POST', '/api/identity/providers/{key}/reconcile'),
  request: { params: z.object({ key: z.string() }) },
  responses: { 200: { description: 'Run one bounded LDAP directory reconciliation page', content: { 'application/json': { schema: z.object({ skipped: z.string().optional(), processed: z.number().int().optional(), runId: z.string().nullable().optional() }) } } } },
});
registry.registerPath({
  method: 'post',
  path: '/api/identity/providers/{key}/reconciliation-preview',
  ...authzExtension('platform.sso.providers.manage', 'POST', '/api/identity/providers/{key}/reconciliation-preview'),
  request: {
    params: z.object({ key: z.string() }),
    body: { content: { 'application/json': { schema: identityProviderDiagnosticSchemas.IdentityProviderMembershipReplayRequestSchema } } },
  },
  responses: { 200: { description: 'Preview stored identity snapshot membership changes without persistence', content: { 'application/json': { schema: identityProviderDiagnosticSchemas.IdentityProviderReconciliationPreviewSchema } } }, 404: { description: 'Identity provider not found' } },
});
registry.registerPath({
  method: 'post',
  path: '/api/identity/providers/{key}/replay-memberships',
  ...authzExtension('platform.sso.providers.manage', 'POST', '/api/identity/providers/{key}/replay-memberships'),
  request: {
    params: z.object({ key: z.string() }),
    body: { content: { 'application/json': { schema: identityProviderDiagnosticSchemas.IdentityProviderMembershipReplayRequestSchema } } },
  },
  responses: {
    200: {
      description: 'Replay stored provider identity memberships',
      content: { 'application/json': { schema: identityProviderDiagnosticSchemas.IdentityProviderMembershipReplayResponseSchema } },
    },
    404: { description: 'Identity provider not found' },
  },
});
registry.registerPath({
  method: 'post',
  path: '/api/identity/providers/{key}/test-connection',
  ...authzExtension('platform.sso.providers.manage', 'POST', '/api/identity/providers/{key}/test-connection'),
  request: { params: z.object({ key: z.string() }) },
  responses: { 200: { description: 'Protocol-specific identity provider connection result', content: { 'application/json': { schema: identityProviderMigrationSchemas.IdentityProviderConnectionTestResponseSchema } } }, 404: { description: 'Identity provider not found' } },
});
registry.registerPath({
  method: 'delete',
  path: '/api/identity/providers/{key}',
  ...authzExtension('platform.sso.providers.manage', 'DELETE', '/api/identity/providers/{key}'),
  request: { params: z.object({ key: z.string() }) },
  responses: { 204: { description: 'Identity provider archived' }, 404: { description: 'Identity provider not found' } },
});

const identityMappingSchemas = await import('./platform-admin/authz.js');
registry.register('IdentityMapping', identityMappingSchemas.IdentityMappingResponseSchema);
registry.registerPath({ method: 'get', path: '/api/identity/mappings', ...authzExtension('platform.sso.group-mappings.read', 'GET', '/api/identity/mappings'), responses: { 200: { description: 'List provider-neutral identity mappings', content: { 'application/json': { schema: z.array(identityMappingSchemas.IdentityMappingResponseSchema) } } } } });
registry.registerPath({ method: 'post', path: '/api/identity/mappings', ...authzExtension('platform.sso.group-mappings.manage', 'POST', '/api/identity/mappings'), request: { body: { content: { 'application/json': { schema: identityMappingSchemas.IdentityMappingRequestSchema } } } }, responses: { 201: { description: 'Identity mapping created', content: { 'application/json': { schema: identityMappingSchemas.IdentityMappingResponseSchema } } } } });
registry.registerPath({ method: 'post', path: '/api/identity/mappings/provision-access', ...authzExtension('platform.sso.group-mappings.manage', 'POST', '/api/identity/mappings/provision-access'), request: { body: { content: { 'application/json': { schema: identityMappingSchemas.IdentityMappingProvisionAccessRequestSchema } } } }, responses: { 201: { description: 'Identity mapping, optional new group, and scoped group access provisioned atomically', content: { 'application/json': { schema: identityMappingSchemas.IdentityMappingProvisionAccessResponseSchema } } } } });
registry.registerPath({ method: 'put', path: '/api/identity/mappings/{id}', ...authzExtension('platform.sso.group-mappings.manage', 'PUT', '/api/identity/mappings/{id}'), request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: identityMappingSchemas.IdentityMappingUpdateSchema } } } }, responses: { 200: { description: 'Identity mapping updated', content: { 'application/json': { schema: identityMappingSchemas.IdentityMappingResponseSchema } } } } });
registry.registerPath({ method: 'delete', path: '/api/identity/mappings/{id}', ...authzExtension('platform.sso.group-mappings.manage', 'DELETE', '/api/identity/mappings/{id}'), request: { params: z.object({ id: z.string() }) }, responses: { 204: { description: 'Identity mapping removed' } } });
registry.registerPath({ method: 'post', path: '/api/identity/mappings/test', ...authzExtension('platform.sso.group-mappings.manage', 'POST', '/api/identity/mappings/test'), request: { body: { content: { 'application/json': { schema: identityMappingSchemas.IdentityMappingTestRequestSchema } } } }, responses: { 200: { description: 'Identity mapping test result', content: { 'application/json': { schema: identityMappingSchemas.IdentityMappingTestResponseSchema } } } } });
registry.registerPath({ method: 'post', path: '/api/identity/mappings/stored-snapshot-preview', ...authzExtension('platform.sso.group-mappings.manage', 'POST', '/api/identity/mappings/stored-snapshot-preview'), request: { body: { content: { 'application/json': { schema: identityMappingSchemas.IdentityMappingStoredSnapshotPreviewRequestSchema } } } }, responses: { 200: { description: 'Aggregate proposed mapping matches from stored normalized identity snapshots', content: { 'application/json': { schema: identityMappingSchemas.IdentityMappingStoredSnapshotPreviewResponseSchema } } } } });

// -----------------------------
// Project Members API
// -----------------------------
registry.register('ProjectMember', ProjectMemberSchema);
const ProjectMemberCandidateSchema = z.object({
  id: z.string(),
  email: z.string(),
  firstName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
});
const ProjectMemberLookupSchema = z.object({
  mode: z.enum(['invite', 'existing-member', 'direct-add']),
  user: ProjectMemberCandidateSchema.optional(),
});
const ProjectMemberCapabilitiesSchema = z.object({
  ssoRequired: z.boolean(),
  emailConfigured: z.boolean(),
});
const UpdateProjectDeployGrantRequestSchema = z.object({ allowed: z.boolean() });
const ProjectDeployGrantResponseSchema = z.object({ allowed: z.boolean() });
const ReissuedManualProjectInvitationSchema = z.object({
  invited: z.boolean(),
  emailSent: z.boolean(),
  inviteUrl: z.string().optional(),
  oneTimePassword: z.string().optional(),
});

registry.registerPath({
  method: 'get',
  path: '/starbase-api/projects/{projectId}/members/user-search',
  ...authzExtension('project.members.search', 'GET', '/starbase-api/projects/{projectId}/members/user-search'),
  request: { params: z.object({ projectId: z.string().uuid() }), query: z.object({ q: z.string().optional() }) },
  responses: { 200: { description: 'Project member search results', content: { 'application/json': { schema: z.array(ProjectMemberCandidateSchema) } } } },
});

registry.registerPath({
  method: 'get',
  path: '/starbase-api/projects/{projectId}/members/lookup',
  ...authzExtension('project.members.search', 'GET', '/starbase-api/projects/{projectId}/members/lookup'),
  request: { params: z.object({ projectId: z.string().uuid() }), query: z.object({ email: z.string().email().optional() }) },
  responses: { 200: { description: 'Project member candidate lookup', content: { 'application/json': { schema: ProjectMemberLookupSchema } } } },
});

registry.registerPath({
  method: 'get',
  path: '/starbase-api/projects/{projectId}/members/capabilities',
  ...authzExtension('project.members.invite', 'GET', '/starbase-api/projects/{projectId}/members/capabilities'),
  request: { params: z.object({ projectId: z.string().uuid() }) },
  responses: { 200: { description: 'Project member invitation capabilities', content: { 'application/json': { schema: ProjectMemberCapabilitiesSchema } } } },
});

registry.registerPath({
  method: 'put',
  path: '/starbase-api/projects/{projectId}/members/{userId}/deploy-permission',
  ...authzExtension('project.members.deploy-grant.manage', 'PUT', '/starbase-api/projects/{projectId}/members/{userId}/deploy-permission'),
  request: { params: z.object({ projectId: z.string().uuid(), userId: z.string().uuid() }), body: { content: { 'application/json': { schema: UpdateProjectDeployGrantRequestSchema } } } },
  responses: { 200: { description: 'Deploy permission grant updated', content: { 'application/json': { schema: ProjectDeployGrantResponseSchema } } } },
});

registry.registerPath({
  method: 'get',
  path: '/starbase-api/projects/{projectId}/members',
  ...authzExtension('project.members.read', 'GET', '/starbase-api/projects/{projectId}/members'),
  request: { params: z.object({ projectId: z.string().uuid() }) },
  responses: { 200: { description: 'Project members', content: { 'application/json': { schema: z.array(ProjectMemberSchema) } } } },
});

registry.registerPath({
  method: 'post',
  path: '/starbase-api/projects/{projectId}/pending-invites/{invitationId}/reissue',
  ...authzExtension('project.members.invite', 'POST', '/starbase-api/projects/{projectId}/pending-invites/{invitationId}/reissue'),
  request: { params: z.object({ projectId: z.string().uuid(), invitationId: z.string().uuid() }) },
  responses: { 200: { description: 'Manual project invitation reissued', content: { 'application/json': { schema: ReissuedManualProjectInvitationSchema } } } },
});

registry.registerPath({
  method: 'post',
  path: '/starbase-api/projects/{projectId}/members',
  ...authzExtension('project.members.add', 'POST', '/starbase-api/projects/{projectId}/members'),
  request: { params: z.object({ projectId: z.string().uuid() }), body: { content: { 'application/json': { schema: AddProjectMemberRequest } } } },
  responses: { 201: { description: 'Member added', content: { 'application/json': { schema: ProjectMemberSchema } } } },
});

registry.registerPath({
  method: 'patch',
  path: '/starbase-api/projects/{projectId}/members/{userId}',
  ...authzExtension('project.members.update-role', 'PATCH', '/starbase-api/projects/{projectId}/members/{userId}'),
  request: { params: z.object({ projectId: z.string().uuid(), userId: z.string().uuid() }), body: { content: { 'application/json': { schema: UpdateProjectMemberRoleRequest } } } },
  responses: { 200: { description: 'Role updated', content: { 'application/json': { schema: z.object({ message: z.string() }) } } } },
});

registry.registerPath({
  method: 'delete',
  path: '/starbase-api/projects/{projectId}/members/{userId}',
  ...authzExtension('project.members.remove', 'DELETE', '/starbase-api/projects/{projectId}/members/{userId}'),
  request: { params: z.object({ projectId: z.string().uuid(), userId: z.string().uuid() }) },
  responses: { 204: { description: 'Member removed' } },
});

registry.registerPath({
  method: 'post',
  path: '/starbase-api/projects/{projectId}/transfer-ownership',
  ...authzExtension('project.ownership.transfer', 'POST', '/starbase-api/projects/{projectId}/transfer-ownership'),
  request: { params: z.object({ projectId: z.string().uuid() }), body: { content: { 'application/json': { schema: TransferProjectOwnershipRequest } } } },
  responses: { 200: { description: 'Ownership transferred', content: { 'application/json': { schema: z.object({ message: z.string() }) } } } },
});

registry.registerPath({
  method: 'get',
  path: '/starbase-api/projects/{projectId}/members/me',
  ...authzExemption('GET', '/starbase-api/projects/{projectId}/members/me'),
  request: { params: z.object({ projectId: z.string().uuid() }) },
  responses: { 200: { description: 'My membership', content: { 'application/json': { schema: ProjectMemberSchema.nullable() } } } },
});

// -----------------------------
// Engine Management API
// -----------------------------
registry.register('EngineMember', EngineMemberSchema);
registry.register('EngineWithDetails', EngineWithDetailsSchema);

registry.registerPath({
  method: 'get',
  path: '/engines-api/my-engines',
  ...authzExemption('GET', '/engines-api/my-engines'),
  responses: { 200: { description: 'Engines user has access to', content: { 'application/json': { schema: z.array(EngineWithDetailsSchema) } } } },
});

registry.registerPath({
  method: 'get',
  path: '/engines-api/engines/{engineId}/my-role',
  ...authzExtension('engine.members.read', 'GET', '/engines-api/engines/{engineId}/my-role'),
  request: { params: z.object({ engineId: z.string() }) },
  responses: { 200: { description: 'My role on engine', content: { 'application/json': { schema: EngineRoleResponse } } } },
});

registry.registerPath({
  method: 'get',
  path: '/engines-api/engines/{engineId}/members',
  ...authzExtension('engine.members.read', 'GET', '/engines-api/engines/{engineId}/members'),
  request: { params: z.object({ engineId: z.string() }) },
  responses: { 200: { description: 'Engine members', content: { 'application/json': { schema: EngineMembersResponseSchema } } } },
});

registry.registerPath({
  method: 'get',
  path: '/engines-api/engines/{engineId}/members/capabilities',
  ...authzExtension('engine.members.invite', 'GET', '/engines-api/engines/{engineId}/members/capabilities'),
  request: { params: z.object({ engineId: z.string() }) },
  responses: { 200: { description: 'Engine member invitation capabilities', content: { 'application/json': { schema: z.object({ ssoRequired: z.boolean(), emailConfigured: z.boolean() }) } } } },
});

registry.registerPath({
  method: 'get',
  path: '/engines-api/engines/{engineId}/members/lookup',
  ...authzExtension('engine.members.lookup', 'GET', '/engines-api/engines/{engineId}/members/lookup'),
  request: { params: z.object({ engineId: z.string() }), query: z.object({ email: z.string().email().optional(), role: z.enum(['delegate', 'operator', 'deployer']).optional() }) },
  responses: { 200: { description: 'Engine member lookup result', content: { 'application/json': { schema: z.unknown() } } } },
});

registry.registerPath({
  method: 'post',
  path: '/engines-api/engines/{engineId}/members',
  ...authzExtension('engine.members.add', 'POST', '/engines-api/engines/{engineId}/members'),
  request: { params: z.object({ engineId: z.string() }), body: { content: { 'application/json': { schema: AddEngineMemberRequest } } } },
  responses: { 201: { description: 'Member added', content: { 'application/json': { schema: EngineMemberSchema } } } },
});

registry.registerPath({
  method: 'patch',
  path: '/engines-api/engines/{engineId}/members/{userId}',
  ...authzExtension('engine.members.update-role', 'PATCH', '/engines-api/engines/{engineId}/members/{userId}'),
  request: { params: z.object({ engineId: z.string(), userId: z.string().uuid() }), body: { content: { 'application/json': { schema: UpdateEngineMemberRoleRequest } } } },
  responses: { 200: { description: 'Role updated', content: { 'application/json': { schema: z.object({ message: z.string() }) } } } },
});

registry.registerPath({
  method: 'delete',
  path: '/engines-api/engines/{engineId}/members/{userId}',
  ...authzExtension('engine.members.remove', 'DELETE', '/engines-api/engines/{engineId}/members/{userId}'),
  request: { params: z.object({ engineId: z.string(), userId: z.string().uuid() }) },
  responses: { 204: { description: 'Member removed' } },
});

registry.registerPath({
  method: 'post',
  path: '/engines-api/engines/{engineId}/pending-invites/{invitationId}/reissue',
  ...authzExtension('engine.members.invite', 'POST', '/engines-api/engines/{engineId}/pending-invites/{invitationId}/reissue'),
  request: { params: z.object({ engineId: z.string(), invitationId: z.string().uuid() }) },
  responses: { 200: { description: 'Manual invitation reissued', content: { 'application/json': { schema: z.object({ invited: z.boolean(), emailSent: z.boolean(), inviteUrl: z.string().optional(), oneTimePassword: z.string().optional() }) } } } },
});

registry.registerPath({
  method: 'post',
  path: '/engines-api/engines/{engineId}/delegate',
  ...authzExtension('engine.delegate.manage', 'POST', '/engines-api/engines/{engineId}/delegate'),
  request: { params: z.object({ engineId: z.string() }), body: { content: { 'application/json': { schema: AssignDelegateRequest } } } },
  responses: { 200: { description: 'Delegate assigned', content: { 'application/json': { schema: z.object({ message: z.string() }) } } } },
});

registry.registerPath({
  method: 'post',
  path: '/engines-api/engines/{engineId}/transfer-ownership',
  ...authzExtension('engine.ownership.transfer', 'POST', '/engines-api/engines/{engineId}/transfer-ownership'),
  request: { params: z.object({ engineId: z.string() }), body: { content: { 'application/json': { schema: TransferEngineOwnershipRequest } } } },
  responses: { 200: { description: 'Ownership transferred', content: { 'application/json': { schema: z.object({ message: z.string() }) } } } },
});

registry.registerPath({
  method: 'post',
  path: '/engines-api/engines/{engineId}/environment',
  ...authzExtension('engine.environment.set', 'POST', '/engines-api/engines/{engineId}/environment'),
  request: { params: z.object({ engineId: z.string() }), body: { content: { 'application/json': { schema: SetEnvironmentRequest } } } },
  responses: { 200: { description: 'Environment set', content: { 'application/json': { schema: z.object({ message: z.string() }) } } } },
});

registry.registerPath({
  method: 'post',
  path: '/engines-api/engines/{engineId}/lock',
  ...authzExtension('engine.environment.lock', 'POST', '/engines-api/engines/{engineId}/lock'),
  request: { params: z.object({ engineId: z.string() }), body: { content: { 'application/json': { schema: SetLockedRequest } } } },
  responses: { 200: { description: 'Lock state changed', content: { 'application/json': { schema: z.object({ message: z.string() }) } } } },
});

registry.registerPath({
  method: 'get',
  path: '/engines-api/environment-tags',
  ...authzExemption('GET', '/engines-api/environment-tags'),
  responses: { 200: { description: 'Environment tags for engine views', content: { 'application/json': { schema: z.array(EnvironmentTagSchema) } } } },
});

registry.registerPath({
  method: 'post',
  path: '/engines-api/engines/{engineId}/request-access',
  ...authzExtension('project-engine-target.access.request', 'POST', '/engines-api/engines/{engineId}/request-access'),
  request: { params: z.object({ engineId: z.string() }), body: { content: { 'application/json': { schema: RequestAccessRequest } } } },
  responses: { 200: { description: 'Access request result', content: { 'application/json': { schema: z.object({ status: z.string(), autoApproved: z.boolean().optional(), requestId: z.string().optional() }) } } } },
});

registry.registerPath({
  method: 'get',
  path: '/engines-api/engines/{engineId}/access-requests',
  ...authzExtension('engine.project-access.requests.read', 'GET', '/engines-api/engines/{engineId}/access-requests'),
  request: { params: z.object({ engineId: z.string() }) },
  responses: { 200: { description: 'Pending engine access requests', content: { 'application/json': { schema: z.array(z.unknown()) } } } },
});

registry.registerPath({
  method: 'post',
  path: '/engines-api/engines/{engineId}/access-requests/{requestId}/approve',
  ...authzExtension('engine.project-access.requests.approve', 'POST', '/engines-api/engines/{engineId}/access-requests/{requestId}/approve'),
  request: { params: z.object({ engineId: z.string(), requestId: z.string() }) },
  responses: { 200: { description: 'Access request approved', content: { 'application/json': { schema: z.object({ message: z.string() }) } } } },
});

registry.registerPath({
  method: 'post',
  path: '/engines-api/engines/{engineId}/access-requests/{requestId}/deny',
  ...authzExtension('engine.project-access.requests.deny', 'POST', '/engines-api/engines/{engineId}/access-requests/{requestId}/deny'),
  request: { params: z.object({ engineId: z.string(), requestId: z.string() }) },
  responses: { 200: { description: 'Access request denied', content: { 'application/json': { schema: z.object({ message: z.string() }) } } } },
});

registry.registerPath({
  method: 'delete',
  path: '/engines-api/engines/{engineId}/projects/{projectId}',
  ...authzExtension('engine.project-access.revoke', 'DELETE', '/engines-api/engines/{engineId}/projects/{projectId}'),
  request: { params: z.object({ engineId: z.string(), projectId: z.string() }) },
  responses: { 204: { description: 'Project engine access revoked' } },
});

// -----------------------------
// Starbase API - Folders
// -----------------------------
registry.register('Folder', FolderSchema);
registry.register('FolderSummary', FolderSummarySchema);

// GET /starbase-api/projects/:projectId/contents (project contents tree)
registry.register('ProjectContents', ProjectContentsSchema);
registry.registerPath({
  method: 'get',
  path: '/starbase-api/projects/{projectId}/contents',
  ...authzExtension('project.files.read', 'GET', '/starbase-api/projects/{projectId}/contents'),
  request: { params: z.object({ projectId: z.string() }), query: z.object({ folderId: z.string().optional() }) },
  responses: { 200: { description: 'Project contents (folders + files)', content: { 'application/json': { schema: ProjectContentsSchema } } } },
});

// GET /starbase-api/projects/:projectId/folders (flat folder list)
registry.registerPath({
  method: 'get',
  path: '/starbase-api/projects/{projectId}/folders',
  ...authzExtension('project.files.read', 'GET', '/starbase-api/projects/{projectId}/folders'),
  request: { params: z.object({ projectId: z.string() }) },
  responses: { 200: { description: 'List all folders in project', content: { 'application/json': { schema: z.array(FolderSummarySchema) } } } },
});

// POST /starbase-api/projects/:projectId/folders (create folder)
registry.register('CreateFolderRequest', CreateFolderRequest);
registry.registerPath({
  method: 'post',
  path: '/starbase-api/projects/{projectId}/folders',
  ...authzExtension('project.files.create', 'POST', '/starbase-api/projects/{projectId}/folders'),
  request: { params: z.object({ projectId: z.string() }), body: { content: { 'application/json': { schema: CreateFolderRequest } } } },
  responses: { 201: { description: 'Folder created', content: { 'application/json': { schema: FolderSchema } } } },
});

// PATCH /starbase-api/folders/:folderId (rename/move folder)
registry.register('UpdateFolderRequest', UpdateFolderRequest);
registry.registerPath({
  method: 'patch',
  path: '/starbase-api/folders/{folderId}',
  ...authzExtension('project.files.update', 'PATCH', '/starbase-api/folders/{folderId}'),
  request: { params: z.object({ folderId: z.string() }), body: { content: { 'application/json': { schema: UpdateFolderRequest } } } },
  responses: { 200: { description: 'Folder updated', content: { 'application/json': { schema: z.object({ id: z.string(), name: z.string(), parentFolderId: z.string().nullable(), updatedAt: z.number() }) } } } },
});

// GET /starbase-api/folders/:folderId/delete-preview
registry.register('FolderDeletePreview', FolderDeletePreviewSchema);
registry.registerPath({
  method: 'get',
  path: '/starbase-api/folders/{folderId}/delete-preview',
  ...authzExtension('project.files.delete', 'GET', '/starbase-api/folders/{folderId}/delete-preview'),
  request: { params: z.object({ folderId: z.string() }) },
  responses: { 200: { description: 'Preview of folder deletion impact', content: { 'application/json': { schema: FolderDeletePreviewSchema } } } },
});

// DELETE /starbase-api/folders/:folderId
registry.registerPath({
  method: 'delete',
  path: '/starbase-api/folders/{folderId}',
  ...authzExtension('project.files.delete', 'DELETE', '/starbase-api/folders/{folderId}'),
  request: { params: z.object({ folderId: z.string() }) },
  responses: { 204: { description: 'Folder deleted' } },
});

// GET /starbase-api/folders/:folderId/download (zip)
registry.registerPath({
  method: 'get',
  path: '/starbase-api/folders/{folderId}/download',
  ...authzExtension('project.files.read', 'GET', '/starbase-api/folders/{folderId}/download'),
  request: { params: z.object({ folderId: z.string() }) },
  responses: { 200: { description: 'ZIP archive of folder contents with manifest', content: { 'application/zip': { schema: z.string() } } }, 204: { description: 'Empty folder' } },
});

// GET /starbase-api/projects/:projectId/download (zip)
registry.registerPath({
  method: 'get',
  path: '/starbase-api/projects/{projectId}/download',
  ...authzExtension('project.files.read', 'GET', '/starbase-api/projects/{projectId}/download'),
  request: { params: z.object({ projectId: z.string() }) },
  responses: { 200: { description: 'ZIP archive of project with manifest', content: { 'application/zip': { schema: z.string() } } }, 204: { description: 'Empty project' } },
});

// POST /starbase-api/projects/:projectId/import-zip
registry.registerPath({
  method: 'post',
  path: '/starbase-api/projects/{projectId}/import-zip',
  ...authzExtension('project.files.create', 'POST', '/starbase-api/projects/{projectId}/import-zip'),
  request: {
    params: z.object({ projectId: z.string() }),
    body: { content: { 'application/zip': { schema: z.string() }, 'application/octet-stream': { schema: z.string() } } },
  },
  responses: {
    201: {
      description: 'Project archive imported',
      content: { 'application/json': { schema: z.unknown() } },
    },
  },
});

// POST /starbase-api/projects/:projectId/download-selection (zip)
registry.registerPath({
  method: 'post',
  path: '/starbase-api/projects/{projectId}/download-selection',
  ...authzExtension('project.files.read', 'POST', '/starbase-api/projects/{projectId}/download-selection'),
  request: {
    params: z.object({ projectId: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            fileIds: z.array(z.string()).default([]),
            folderIds: z.array(z.string()).default([]),
          })
        }
      }
    },
  },
  responses: { 200: { description: 'ZIP archive of selected files and folders with manifest', content: { 'application/zip': { schema: z.string() } } }, 204: { description: 'Empty selection' } },
});

// GET /starbase-api/files/:fileId/download (XML attachment)
registry.registerPath({
  method: 'get',
  path: '/starbase-api/files/{fileId}/download',
  ...authzExtension('project.files.read', 'GET', '/starbase-api/files/{fileId}/download'),
  request: { params: z.object({ fileId: z.string() }) },
  responses: { 200: { description: 'File XML download', content: { 'application/xml': { schema: z.string() } } }, 404: { description: 'Not found' } },
});

// POST /starbase-api/files/:fileId/restore-from-commit
registry.registerPath({
  method: 'post',
  path: '/starbase-api/files/{fileId}/restore-from-commit',
  ...authzExtension('project.files.restore', 'POST', '/starbase-api/files/{fileId}/restore-from-commit'),
  request: {
    params: z.object({ fileId: z.string() }),
    body: { content: { 'application/json': { schema: z.object({ commitId: z.string().optional(), fileVersionNumber: z.number().optional() }) } } },
  },
  responses: { 200: { description: 'File restored', content: { 'application/json': { schema: z.object({ restored: z.boolean(), fileId: z.string(), commitId: z.string(), fileVersionNumber: z.number().nullable(), updatedAt: z.number() }) } } } },
});

const DeploymentEligibilityCheckOpenApiSchema = z.object({
  id: z.string(),
  allowed: z.boolean(),
  reason: z.string(),
  remediation: z.string().optional(),
});

const ProjectEngineAccessResponseOpenApiSchema = z.object({
  accessedEngines: z.array(z.object({
    engineId: z.string(),
    engineName: z.string(),
    baseUrl: z.string().optional(),
    environment: z.object({
      name: z.string(),
      color: z.string(),
    }).nullable(),
    deploymentTarget: z.object({
      id: z.string(),
      status: z.string(),
      source: z.string(),
      sourceRef: z.string().nullable(),
      allowManualDeploy: z.boolean(),
      allowCiDeploy: z.boolean(),
      allowApiDeploy: z.boolean(),
      allowImport: z.boolean(),
      lastSeenAt: z.number().nullable(),
      createdAt: z.number(),
      updatedAt: z.number(),
    }).optional(),
    manualDeployAllowed: z.boolean().optional(),
    manualDeployDeniedReasons: z.array(z.string()).optional(),
    ciDeployAllowed: z.boolean().optional(),
    ciDeployDeniedReasons: z.array(z.string()).optional(),
    deploymentEligibility: z.object({
      diagnosticsVisible: z.boolean().optional(),
      manual: z.object({
        allowed: z.boolean(),
        reasons: z.array(z.string()),
        checks: z.array(DeploymentEligibilityCheckOpenApiSchema).optional(),
      }),
      ci: z.object({
        allowed: z.boolean(),
        reasons: z.array(z.string()),
        checks: z.array(DeploymentEligibilityCheckOpenApiSchema).optional(),
      }).optional(),
    }).optional(),
    health: z.object({
      status: z.string(),
      latencyMs: z.number().nullable(),
    }).nullable(),
    grantedAt: z.number(),
    isLegacy: z.boolean().optional(),
  })),
  pendingRequests: z.array(z.object({
    requestId: z.string(),
    engineId: z.string(),
    engineName: z.string(),
    requestedAt: z.number(),
  })),
  availableEngines: z.array(z.object({
    id: z.string(),
    name: z.string(),
  })),
});

registry.register('ProjectEngineAccessResponse', ProjectEngineAccessResponseOpenApiSchema);

// GET /starbase-api/projects/:projectId/engine-access
registry.registerPath({
  method: 'get',
  path: '/starbase-api/projects/{projectId}/engine-access',
  ...authzExtension('project.deployment-options.read', 'GET', '/starbase-api/projects/:projectId/engine-access'),
  request: { params: z.object({ projectId: z.string() }) },
  responses: { 200: { description: 'Engine access status and deployment eligibility for project', content: { 'application/json': { schema: ProjectEngineAccessResponseOpenApiSchema } } } },
});

// GET /starbase-api/projects/:projectId/engine-deployments
registry.registerPath({
  method: 'get',
  path: '/starbase-api/projects/{projectId}/engine-deployments',
  ...authzExtension('project.deployments.read', 'GET', '/starbase-api/projects/:projectId/engine-deployments'),
  request: { params: z.object({ projectId: z.string() }), query: z.object({ limit: z.string().optional() }) },
  responses: { 200: { description: 'Engine deployments for project', content: { 'application/json': { schema: z.array(z.unknown()) } } } },
});

// GET /starbase-api/projects/:projectId/engine-deployments/latest
registry.registerPath({
  method: 'get',
  path: '/starbase-api/projects/{projectId}/engine-deployments/latest',
  ...authzExtension('project.deployments.read', 'GET', '/starbase-api/projects/:projectId/engine-deployments/latest'),
  request: { params: z.object({ projectId: z.string() }) },
  responses: { 200: { description: 'Latest engine deployments per file', content: { 'application/json': { schema: z.unknown() } } } },
});

// GET /starbase-api/projects/:projectId/files/:fileId/deployments
registry.registerPath({
  method: 'get',
  path: '/starbase-api/projects/{projectId}/files/{fileId}/deployments',
  ...authzExtension('project.deployments.read', 'GET', '/starbase-api/projects/:projectId/files/:fileId/deployments'),
  request: { params: z.object({ projectId: z.string(), fileId: z.string() }) },
  responses: { 200: { description: 'Deployments for a specific file', content: { 'application/json': { schema: z.array(z.unknown()) } } } },
});

// GET /starbase-api/projects/:projectId/files/:fileId/deployments/history
registry.registerPath({
  method: 'get',
  path: '/starbase-api/projects/{projectId}/files/{fileId}/deployments/history',
  ...authzExtension('project.deployments.read', 'GET', '/starbase-api/projects/:projectId/files/:fileId/deployments/history'),
  request: { params: z.object({ projectId: z.string(), fileId: z.string() }) },
  responses: { 200: { description: 'Full deployment history for a file', content: { 'application/json': { schema: z.array(z.unknown()) } } } },
});

// -----------------------------
// Mission Control API - Additional Endpoints
// -----------------------------

// GET /mission-control-api/process-definitions/{id}/activity-counts-by-state
registry.registerPath({
  method: 'get',
  path: '/mission-control-api/process-definitions/{id}/activity-counts-by-state',
  ...authzExtension('engine.runtime.process-definitions.read', 'GET', '/mission-control-api/process-definitions/{id}/activity-counts-by-state'),
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: 'Activity counts grouped by state', content: { 'application/json': { schema: z.unknown() } } } },
});

// POST /mission-control-api/process-definitions/key/{key}/start
registry.registerPath({
  method: 'post',
  path: '/mission-control-api/process-definitions/key/{key}/start',
  ...authzExtension('engine.runtime.process-definitions.start', 'POST', '/mission-control-api/process-definitions/key/{key}/start'),
  request: { params: z.object({ key: z.string() }), body: { content: { 'application/json': { schema: z.object({ variables: z.record(z.string(), z.unknown()).optional(), businessKey: z.string().optional() }) } } } },
  responses: { 200: { description: 'Process instance started', content: { 'application/json': { schema: z.unknown() } } } },
});

// GET /mission-control-api/process-definitions/key/{key}/statistics
registry.registerPath({
  method: 'get',
  path: '/mission-control-api/process-definitions/key/{key}/statistics',
  ...authzExtension('engine.runtime.process-definitions.read', 'GET', '/mission-control-api/process-definitions/key/{key}/statistics'),
  request: { params: z.object({ key: z.string() }) },
  responses: { 200: { description: 'Process definition statistics', content: { 'application/json': { schema: z.unknown() } } } },
});

// GET /mission-control-api/process-instances/{id}/activity-instances (runtime)
registry.registerPath({
  method: 'get',
  path: '/mission-control-api/process-instances/{id}/activity-instances',
  ...authzExtension('engine.runtime.process-instances.activity-tree.read', 'GET', '/mission-control-api/process-instances/{id}/activity-instances'),
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: 'Runtime activity instance tree', content: { 'application/json': { schema: z.unknown() } } } },
});

// GET /mission-control-api/process-instances/{id}/jobs
registry.registerPath({
  method: 'get',
  path: '/mission-control-api/process-instances/{id}/jobs',
  ...authzExtension('engine.runtime.jobs.read', 'GET', '/mission-control-api/process-instances/{id}/jobs'),
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: 'Jobs for process instance', content: { 'application/json': { schema: z.array(JobSchema) } } } },
});

// GET /mission-control-api/process-instances/{id}/failed-external-tasks
registry.registerPath({
  method: 'get',
  path: '/mission-control-api/process-instances/{id}/failed-external-tasks',
  ...authzExtension('engine.runtime.external-tasks.read', 'GET', '/mission-control-api/process-instances/{id}/failed-external-tasks'),
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: 'Failed external tasks for instance', content: { 'application/json': { schema: z.array(ExternalTaskSchema) } } } },
});

// POST /mission-control-api/process-instances/{id}/variables (modify)
registry.registerPath({
  method: 'post',
  path: '/mission-control-api/process-instances/{id}/variables',
  ...authzExtension('engine.runtime.process-instances.variables.update', 'POST', '/mission-control-api/process-instances/{id}/variables'),
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: z.object({ modifications: z.record(z.string(), z.unknown()) }) } } } },
  responses: { 204: { description: 'Variables modified' } },
});

// POST /mission-control-api/decision-definitions/key/{key}/evaluate
registry.registerPath({
  method: 'post',
  path: '/mission-control-api/decision-definitions/key/{key}/evaluate',
  ...authzExtension('engine.runtime.decisions.evaluate', 'POST', '/mission-control-api/decision-definitions/key/{key}/evaluate'),
  request: { params: z.object({ key: z.string() }), body: { content: { 'application/json': { schema: EvaluateDecisionRequest } } } },
  responses: { 200: { description: 'Decision result', content: { 'application/json': { schema: z.array(z.unknown()) } } } },
});

// PUT /mission-control-api/batches/{id}/suspended
registry.registerPath({
  method: 'put',
  path: '/mission-control-api/batches/{id}/suspended',
  ...authzExtension('engine.runtime.batches.suspension.update', 'PUT', '/mission-control-api/batches/{id}/suspended'),
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: z.object({ suspended: z.boolean() }) } } } },
  responses: { 204: { description: 'Batch suspension state changed' } },
});

// DELETE /mission-control-api/batches/{id}/record
registry.registerPath({
  method: 'delete',
  path: '/mission-control-api/batches/{id}/record',
  ...authzExtension('engine.runtime.batches.record.delete', 'DELETE', '/mission-control-api/batches/{id}/record'),
  request: { params: z.object({ id: z.string() }) },
  responses: { 204: { description: 'Batch record deleted' } },
});

// POST /mission-control-api/migration/generate (engine auto-mapping - actual path without /plan/)
registry.registerPath({
  method: 'post',
  path: '/mission-control-api/migration/generate',
  ...authzExtension('engine.runtime.migrations.plan.generate', 'POST', '/mission-control-api/migration/generate'),
  request: { body: { content: { 'application/json': { schema: z.object({ sourceDefinitionId: z.string(), targetDefinitionId: z.string(), updateEventTriggers: z.boolean().optional() }) } } } },
  responses: { 200: { description: 'Generated migration plan', content: { 'application/json': { schema: z.unknown() } } } },
});

// -----------------------------
// VCS (Version Control) API
// -----------------------------

// GET /vcs-api/projects/uncommitted-status (batch)
registry.registerPath({
  method: 'get',
  path: '/vcs-api/projects/uncommitted-status',
  ...authzExtension('project.vcs.status.read', 'GET', '/vcs-api/projects/uncommitted-status'),
  request: { query: z.object({ projectIds: z.string() }) },
  responses: { 200: { description: 'Batch uncommitted status', content: { 'application/json': { schema: z.object({ statuses: z.record(z.string(), z.object({ hasUncommittedChanges: z.boolean(), dirtyFileCount: z.number() })) }) } } } },
});

// POST /vcs-api/projects/:projectId/commit
registry.registerPath({
  method: 'post',
  path: '/vcs-api/projects/{projectId}/commit',
  ...authzExtension('project.vcs.commit.create', 'POST', '/vcs-api/projects/{projectId}/commit'),
  request: {
    params: z.object({ projectId: z.string().uuid() }),
    body: { content: { 'application/json': { schema: z.object({ message: z.string(), fileIds: z.array(z.string()).optional(), hotfixFromCommitId: z.string().optional(), hotfixFromFileVersion: z.number().optional() }) } } },
  },
  responses: { 200: { description: 'Commit created', content: { 'application/json': { schema: z.object({ commitId: z.string(), message: z.string(), fileCount: z.number(), createdAt: z.number() }) } } } },
});

// POST /vcs-api/projects/:projectId/publish
registry.registerPath({
  method: 'post',
  path: '/vcs-api/projects/{projectId}/publish',
  ...authzExtension('project.vcs.publish', 'POST', '/vcs-api/projects/{projectId}/publish'),
  request: { params: z.object({ projectId: z.string().uuid() }) },
  responses: { 200: { description: 'Draft merged to main', content: { 'application/json': { schema: z.object({ success: z.boolean(), mergeCommitId: z.string(), filesChanged: z.number() }) } } } },
});

// GET /vcs-api/projects/:projectId/commits
registry.registerPath({
  method: 'get',
  path: '/vcs-api/projects/{projectId}/commits',
  ...authzExtension('project.vcs.commits.read', 'GET', '/vcs-api/projects/{projectId}/commits'),
  request: { params: z.object({ projectId: z.string().uuid() }), query: z.object({ branch: z.enum(['draft', 'main', 'all']).optional(), fileId: z.string().optional() }) },
  responses: { 200: { description: 'Commit history', content: { 'application/json': { schema: z.object({ commits: z.array(z.unknown()) }) } } } },
});

// GET /vcs-api/projects/:projectId/status
registry.registerPath({
  method: 'get',
  path: '/vcs-api/projects/{projectId}/status',
  ...authzExtension('project.vcs.status.read', 'GET', '/vcs-api/projects/{projectId}/status'),
  request: { params: z.object({ projectId: z.string().uuid() }) },
  responses: { 200: { description: 'VCS status', content: { 'application/json': { schema: z.object({ initialized: z.boolean(), draftBranchId: z.string().optional(), mainBranchId: z.string().optional(), hasUnpublishedCommits: z.boolean().optional(), lastDraftCommit: z.unknown().nullable().optional(), lastMainCommit: z.unknown().nullable().optional() }) } } } },
});

// GET /vcs-api/projects/:projectId/uncommitted-files
registry.registerPath({
  method: 'get',
  path: '/vcs-api/projects/{projectId}/uncommitted-files',
  ...authzExtension('project.vcs.status.read', 'GET', '/vcs-api/projects/{projectId}/uncommitted-files'),
  request: { params: z.object({ projectId: z.string().uuid() }), query: z.object({ baseline: z.enum(['main', 'draft']).optional() }) },
  responses: { 200: { description: 'Uncommitted file IDs', content: { 'application/json': { schema: z.object({ hasUncommittedChanges: z.boolean(), uncommittedFileIds: z.array(z.string()), uncommittedFolderIds: z.array(z.string()) }) } } } },
});

// GET /vcs-api/projects/:projectId/commits/:commitId/files
registry.registerPath({
  method: 'get',
  path: '/vcs-api/projects/{projectId}/commits/{commitId}/files',
  ...authzExtension('project.vcs.commits.read', 'GET', '/vcs-api/projects/{projectId}/commits/{commitId}/files'),
  request: { params: z.object({ projectId: z.string().uuid(), commitId: z.string() }) },
  responses: { 200: { description: 'File snapshots for commit', content: { 'application/json': { schema: z.object({ files: z.array(z.unknown()) }) } } } },
});

// POST /vcs-api/projects/:projectId/commits/:commitId/restore
registry.registerPath({
  method: 'post',
  path: '/vcs-api/projects/{projectId}/commits/{commitId}/restore',
  ...authzExtension('project.vcs.commit.restore', 'POST', '/vcs-api/projects/{projectId}/commits/{commitId}/restore'),
  request: { params: z.object({ projectId: z.string().uuid(), commitId: z.string() }) },
  responses: { 200: { description: 'Files restored from commit', content: { 'application/json': { schema: z.object({ success: z.boolean(), filesRestored: z.number(), newCommitId: z.string() }) } } } },
});

// -----------------------------
// Auth API
// -----------------------------

const authenticatedSessionContextSchema = z.object({
  principal: z.object({ type: z.literal('user'), id: z.string() }),
  tenant: z.object({ id: z.string().nullable() }),
});

const authenticatedSessionUserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  session: authenticatedSessionContextSchema,
}).passthrough();

// POST /api/auth/login
registry.registerPath({
  method: 'post',
  path: '/api/auth/login',
  ...authzExemption('POST', '/api/auth/login'),
  request: { body: { content: { 'application/json': { schema: z.object({ email: z.string().email(), password: z.string() }) } } } },
  responses: { 200: { description: 'Login successful', content: { 'application/json': { schema: z.object({ user: authenticatedSessionUserSchema, expiresIn: z.number(), emailVerificationRequired: z.boolean().optional() }) } } }, 401: { description: 'Invalid credentials' } },
});

// POST /api/auth/complete-onboarding
registry.registerPath({
  method: 'post',
  path: '/api/auth/complete-onboarding',
  ...authzExemption('POST', '/api/auth/complete-onboarding'),
  request: { body: { content: { 'application/json': { schema: z.object({ firstName: z.string().min(1).max(100), lastName: z.string().min(1).max(100), newPassword: z.string().min(8) }) } } } },
  responses: { 200: { description: 'Onboarding completed and session established', content: { 'application/json': { schema: z.object({ user: authenticatedSessionUserSchema, expiresIn: z.number(), emailVerificationRequired: z.literal(false) }) } } }, 400: { description: 'Invalid onboarding input or token' }, 401: { description: 'Invalid onboarding token' } },
});

// POST /api/auth/logout
registry.registerPath({
  method: 'post',
  path: '/api/auth/logout',
  ...authzExemption('POST', '/api/auth/logout'),
  responses: { 200: { description: 'Logged out' } },
});

// POST /api/auth/refresh
registry.registerPath({
  method: 'post',
  path: '/api/auth/refresh',
  ...authzExemption('POST', '/api/auth/refresh'),
  responses: { 200: { description: 'Token refreshed', content: { 'application/json': { schema: z.object({ user: z.unknown() }) } } }, 401: { description: 'Not authenticated' } },
});

// GET /api/auth/me
registry.registerPath({
  method: 'get',
  path: '/api/auth/me',
  ...authzExemption('GET', '/api/auth/me'),
  responses: { 200: { description: 'Current user profile', content: { 'application/json': { schema: authenticatedSessionUserSchema } } }, 401: { description: 'Not authenticated' } },
});

// PATCH /api/auth/me
registry.registerPath({
  method: 'patch',
  path: '/api/auth/me',
  ...authzExemption('PATCH', '/api/auth/me'),
  request: { body: { content: { 'application/json': { schema: z.object({ firstName: z.string().optional(), lastName: z.string().optional() }) } } } },
  responses: { 200: { description: 'Profile updated', content: { 'application/json': { schema: authenticatedSessionUserSchema } } } },
});

// POST /api/auth/change-password
registry.registerPath({
  method: 'post',
  path: '/api/auth/change-password',
  ...authzExemption('POST', '/api/auth/change-password'),
  request: { body: { content: { 'application/json': { schema: z.object({ currentPassword: z.string(), newPassword: z.string() }) } } } },
  responses: { 200: { description: 'Password changed' }, 400: { description: 'Invalid current password' } },
});

// POST /api/auth/forgot-password
registry.registerPath({
  method: 'post',
  path: '/api/auth/forgot-password',
  ...authzExemption('POST', '/api/auth/forgot-password'),
  request: { body: { content: { 'application/json': { schema: z.object({ email: z.string().email() }) } } } },
  responses: { 200: { description: 'Reset email sent (always returns 200)' } },
});

// POST /api/auth/reset-password
registry.registerPath({
  method: 'post',
  path: '/api/auth/reset-password',
  ...authzExemption('POST', '/api/auth/reset-password'),
  request: { body: { content: { 'application/json': { schema: z.object({ token: z.string(), password: z.string() }) } } } },
  responses: { 200: { description: 'Password reset' }, 400: { description: 'Invalid or expired token' } },
});

// POST /api/auth/reset-password-with-token
registry.registerPath({
  method: 'post',
  path: '/api/auth/reset-password-with-token',
  ...authzExemption('POST', '/api/auth/reset-password-with-token'),
  request: { body: { content: { 'application/json': { schema: z.object({ token: z.string(), password: z.string() }) } } } },
  responses: { 200: { description: 'Password reset with token' }, 400: { description: 'Invalid token' } },
});

// GET /api/auth/verify-reset-token
registry.registerPath({
  method: 'get',
  path: '/api/auth/verify-reset-token',
  ...authzExemption('GET', '/api/auth/verify-reset-token'),
  request: { query: z.object({ token: z.string() }) },
  responses: { 200: { description: 'Token valid' }, 400: { description: 'Invalid or expired token' } },
});

// POST /api/auth/resend-verification
registry.registerPath({
  method: 'post',
  path: '/api/auth/resend-verification',
  ...authzExemption('POST', '/api/auth/resend-verification'),
  request: { body: { content: { 'application/json': { schema: z.object({ email: z.string().email() }) } } } },
  responses: { 200: { description: 'Verification email resent' } },
});

// GET /api/auth/verify-email
registry.registerPath({
  method: 'get',
  path: '/api/auth/verify-email',
  ...authzExemption('GET', '/api/auth/verify-email'),
  request: { query: z.object({ token: z.string() }) },
  responses: { 200: { description: 'Email verified' }, 400: { description: 'Invalid token' } },
});

// GET /api/auth/branding
registry.registerPath({
  method: 'get',
  path: '/api/auth/branding',
  ...authzExemption('GET', '/api/auth/branding'),
  responses: { 200: { description: 'Platform branding config', content: { 'application/json': { schema: z.unknown() } } } },
});

// GET /api/auth/platform-settings (authenticated UI)
registry.registerPath({
  method: 'get',
  path: '/api/auth/platform-settings',
  ...authzExemption('GET', '/api/auth/platform-settings'),
  responses: { 200: { description: 'Public platform settings', content: { 'application/json': { schema: PublicPlatformSettingsSchema } } } },
});

// SSO - Google
registry.registerPath({ method: 'get', path: '/api/auth/google/start', ...authzExemption('GET', '/api/auth/google/start'), responses: { 302: { description: 'Redirect to Google OAuth' } } });
registry.registerPath({ method: 'get', path: '/api/auth/google', ...authzExemption('GET', '/api/auth/google'), responses: { 302: { description: 'Redirect to Google OAuth' } } });
registry.registerPath({ method: 'get', path: '/api/auth/google/callback', ...authzExemption('GET', '/api/auth/google/callback'), responses: { 302: { description: 'Google OAuth callback redirect' } } });
registry.registerPath({ method: 'get', path: '/api/auth/google/status', ...authzExemption('GET', '/api/auth/google/status'), responses: { 200: { description: 'Google SSO config status', content: { 'application/json': { schema: z.object({ enabled: z.boolean() }) } } } } });

// SSO - Microsoft
registry.registerPath({ method: 'get', path: '/api/auth/microsoft/start', ...authzExemption('GET', '/api/auth/microsoft/start'), responses: { 302: { description: 'Redirect to Microsoft OAuth' } } });
registry.registerPath({ method: 'get', path: '/api/auth/microsoft', ...authzExemption('GET', '/api/auth/microsoft'), responses: { 302: { description: 'Redirect to Microsoft OAuth' } } });
registry.registerPath({ method: 'get', path: '/api/auth/microsoft/callback', ...authzExemption('GET', '/api/auth/microsoft/callback'), responses: { 302: { description: 'Microsoft OAuth callback redirect' } } });
registry.registerPath({ method: 'get', path: '/api/auth/microsoft/status', ...authzExemption('GET', '/api/auth/microsoft/status'), responses: { 200: { description: 'Microsoft SSO config status', content: { 'application/json': { schema: z.object({ enabled: z.boolean() }) } } } } });

// SSO - SAML
registry.registerPath({ method: 'get', path: '/api/auth/saml/start', ...authzExemption('GET', '/api/auth/saml/start'), responses: { 302: { description: 'Redirect to SAML IdP' } } });
registry.registerPath({ method: 'get', path: '/api/auth/saml', ...authzExemption('GET', '/api/auth/saml'), responses: { 302: { description: 'Redirect to SAML IdP' } } });
registry.registerPath({ method: 'post', path: '/api/auth/saml/callback', ...authzExemption('POST', '/api/auth/saml/callback'), responses: { 302: { description: 'SAML assertion callback redirect' } } });
registry.registerPath({ method: 'get', path: '/api/auth/saml/metadata', ...authzExemption('GET', '/api/auth/saml/metadata'), responses: { 200: { description: 'SAML SP metadata XML', content: { 'application/xml': { schema: z.string() } } } } });
registry.registerPath({ method: 'get', path: '/api/auth/saml/status', ...authzExemption('GET', '/api/auth/saml/status'), responses: { 200: { description: 'SAML config status', content: { 'application/json': { schema: z.object({ enabled: z.boolean() }) } } } } });
registry.registerPath({ method: 'get', path: '/api/auth/identity/{key}/start', ...authzExemption('GET', '/api/auth/identity/{key}/start'), request: { params: z.object({ key: z.string() }) }, responses: { 302: { description: 'Redirect to the selected OIDC identity provider' } } });
registry.registerPath({ method: 'get', path: '/api/auth/identity/callback', ...authzExemption('GET', '/api/auth/identity/callback'), responses: { 302: { description: 'Provider-neutral OIDC callback redirect' } } });
registry.registerPath({ method: 'post', path: '/api/auth/identity/{key}/ldap/login', ...authzExemption('POST', '/api/auth/identity/{key}/ldap/login'), request: { params: z.object({ key: z.string() }), body: { content: { 'application/json': { schema: z.object({ username: z.string(), password: z.string() }) } } } }, responses: { 200: { description: 'LDAP identity login', content: { 'application/json': { schema: z.object({ user: authenticatedSessionUserSchema, expiresIn: z.number() }) } } }, 401: { description: 'Invalid directory credentials' } } });
registry.registerPath({ method: 'get', path: '/api/auth/providers/enabled', ...authzExemption('GET', '/api/auth/providers/enabled'), responses: { 200: { description: 'Enabled provider-neutral direct-login options', content: { 'application/json': { schema: z.array(z.object({ id: z.string(), key: z.string(), protocol: z.enum(['oidc', 'saml', 'ldap']), loginMethod: z.enum(['redirect', 'password']) })) } } } } });
registry.registerPath({ method: 'get', path: '/api/auth/providers/{providerId}/start', ...authzExemption('GET', '/api/auth/providers/{providerId}/start'), request: { params: z.object({ providerId: z.string() }) }, responses: { 302: { description: 'Redirect to the selected provider-neutral OIDC or SAML identity provider' }, 404: { description: 'Identity provider not found' } } });
registry.registerPath({ method: 'post', path: '/api/auth/providers/{providerId}/login', ...authzExemption('POST', '/api/auth/providers/{providerId}/login'), request: { params: z.object({ providerId: z.string() }), body: { content: { 'application/json': { schema: z.object({ username: z.string(), password: z.string() }) } } } }, responses: { 200: { description: 'Provider-neutral LDAP identity login', content: { 'application/json': { schema: z.object({ user: authenticatedSessionUserSchema, expiresIn: z.number() }) } } }, 401: { description: 'Invalid directory credentials' } } });
registry.registerPath({ method: 'post', path: '/api/auth/providers/saml/callback', ...authzExemption('POST', '/api/auth/providers/saml/callback'), request: { body: { content: { 'application/x-www-form-urlencoded': { schema: z.object({ SAMLResponse: z.string(), RelayState: z.string() }) } } } }, responses: { 302: { description: 'Provider-neutral SAML callback redirect' }, 401: { description: 'Invalid identity provider state' } } });

// Tenant SSO config
registry.registerPath({
  method: 'get',
  path: '/api/t/{tenantSlug}/auth/sso-config',
  ...authzExemption('GET', '/api/t/{tenantSlug}/auth/sso-config'),
  request: { params: z.object({ tenantSlug: z.string() }) },
  responses: { 200: { description: 'SSO config for tenant', content: { 'application/json': { schema: z.unknown() } } } },
});

// Invitations
registry.registerPath({
  method: 'get',
  path: '/api/t/{tenantSlug}/invitations/capabilities',
  ...authzExemption('GET', '/api/t/:tenantSlug/invitations/capabilities'),
  request: { params: z.object({ tenantSlug: z.string() }) },
  responses: {
    200: {
      description: 'Invitation readiness flags for the authenticated tenant UI',
      content: { 'application/json': { schema: z.object({ ssoRequired: z.boolean(), emailConfigured: z.boolean() }) } },
    },
  },
});
registry.registerPath({
  method: 'post',
  path: '/api/t/{tenantSlug}/invitations',
  ...authzExtension('invitations.create', 'POST', '/api/t/:tenantSlug/invitations'),
  request: {
    params: z.object({ tenantSlug: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            email: z.string().email(),
            resourceType: z.enum(['tenant', 'project', 'engine']),
            resourceId: z.string().optional(),
            resourceName: z.string().optional(),
            role: z.string().optional(),
            deliveryMethod: z.enum(['email', 'manual']).optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Invitation created. Manual delivery may include reveal-once onboarding details.',
      content: {
        'application/json': {
          schema: z.object({
            invited: z.boolean(),
            emailSent: z.boolean(),
            emailError: z.string().optional(),
            inviteUrl: z.string().optional(),
            oneTimePassword: z.string().optional(),
          }),
        },
      },
    },
    403: { description: 'Forbidden' },
  },
});

// -----------------------------
// Admin API - Setup & Email
// -----------------------------

// GET /api/admin/setup-status
registry.registerPath({
  method: 'get',
  path: '/api/admin/setup-status',
  ...authzExtension('platform.settings.read', 'GET', '/api/admin/setup-status'),
  responses: { 200: { description: 'Platform setup status', content: { 'application/json': { schema: z.object({ setupComplete: z.boolean() }) } } } },
});

// POST /api/admin/mark-setup-complete
registry.registerPath({
  method: 'post',
  path: '/api/admin/mark-setup-complete',
  ...authzExtension('platform.settings.manage', 'POST', '/api/admin/mark-setup-complete'),
  responses: { 200: { description: 'Setup marked complete' } },
});

// Email configs
registry.registerPath({
  method: 'get',
  path: '/api/admin/email-configs',
  ...authzExtension('platform.settings.read', 'GET', '/api/admin/email-configs'),
  responses: { 200: { description: 'List email configs', content: { 'application/json': { schema: z.array(z.unknown()) } } } },
});
registry.registerPath({
  method: 'get',
  path: '/api/admin/email-configs/{id}',
  ...authzExtension('platform.settings.read', 'GET', '/api/admin/email-configs/{id}'),
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: 'Get email config', content: { 'application/json': { schema: z.unknown() } } } },
});
registry.registerPath({
  method: 'post',
  path: '/api/admin/email-configs',
  ...authzExtension('platform.settings.manage', 'POST', '/api/admin/email-configs'),
  request: { body: { content: { 'application/json': { schema: z.unknown() } } } },
  responses: { 201: { description: 'Created', content: { 'application/json': { schema: z.unknown() } } } },
});
registry.registerPath({
  method: 'patch',
  path: '/api/admin/email-configs/{id}',
  ...authzExtension('platform.settings.manage', 'PATCH', '/api/admin/email-configs/{id}'),
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: z.unknown() } } } },
  responses: { 200: { description: 'Updated', content: { 'application/json': { schema: z.unknown() } } } },
});
registry.registerPath({
  method: 'delete',
  path: '/api/admin/email-configs/{id}',
  ...authzExtension('platform.settings.manage', 'DELETE', '/api/admin/email-configs/{id}'),
  request: { params: z.object({ id: z.string() }) },
  responses: { 204: { description: 'Deleted' } },
});
registry.registerPath({
  method: 'post',
  path: '/api/admin/email-configs/{id}/set-default',
  ...authzExtension('platform.settings.manage', 'POST', '/api/admin/email-configs/{id}/set-default'),
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: 'Set as default' } },
});
registry.registerPath({
  method: 'post',
  path: '/api/admin/email-configs/{id}/test',
  ...authzExtension('platform.settings.manage', 'POST', '/api/admin/email-configs/{id}/test'),
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: z.object({ to: z.string().email() }) } } } },
  responses: { 200: { description: 'Test email sent' } },
});

// Email platform name
registry.registerPath({
  method: 'get',
  path: '/api/admin/email-platform-name',
  ...authzExtension('platform.settings.read', 'GET', '/api/admin/email-platform-name'),
  responses: { 200: { description: 'Platform email name', content: { 'application/json': { schema: z.object({ emailPlatformName: z.string() }) } } } },
});
registry.registerPath({
  method: 'put',
  path: '/api/admin/email-platform-name',
  ...authzExtension('platform.settings.manage', 'PUT', '/api/admin/email-platform-name'),
  request: { body: { content: { 'application/json': { schema: z.object({ name: z.string() }) } } } },
  responses: { 200: { description: 'Platform name updated' } },
});

// Email templates
registry.registerPath({
  method: 'get',
  path: '/api/admin/email-templates',
  ...authzExtension('platform.settings.read', 'GET', '/api/admin/email-templates'),
  responses: { 200: { description: 'List email templates', content: { 'application/json': { schema: z.array(z.unknown()) } } } },
});
registry.registerPath({
  method: 'get',
  path: '/api/admin/email-templates/{id}',
  ...authzExtension('platform.settings.read', 'GET', '/api/admin/email-templates/{id}'),
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: 'Get email template', content: { 'application/json': { schema: z.unknown() } } } },
});
registry.registerPath({
  method: 'patch',
  path: '/api/admin/email-templates/{id}',
  ...authzExtension('platform.settings.manage', 'PATCH', '/api/admin/email-templates/{id}'),
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: z.unknown() } } } },
  responses: { 200: { description: 'Template updated', content: { 'application/json': { schema: z.unknown() } } } },
});
registry.registerPath({
  method: 'post',
  path: '/api/admin/email-templates/{id}/preview',
  ...authzExtension('platform.settings.read', 'POST', '/api/admin/email-templates/{id}/preview'),
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: 'Template preview HTML', content: { 'application/json': { schema: z.object({ html: z.string() }) } } } },
});
registry.registerPath({
  method: 'post',
  path: '/api/admin/email-templates/{id}/reset',
  ...authzExtension('platform.settings.manage', 'POST', '/api/admin/email-templates/{id}/reset'),
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: 'Template reset to default' } },
});

// -----------------------------
// Authorization (Authz) API
// -----------------------------
const {
  ApiClientCreateSchema,
  ApiClientSchema,
  ApiClientWithTokenSchema,
  AuthzPrincipalTypeSchema,
  AuthzGroupCreateSchema,
  AuthzGroupMembershipCreateSchema,
  AuthzGroupMembershipSchema,
  AuthzGroupSchema,
  AuthzGroupUpdateSchema,
  AuthzResourceTypeSchema,
  CurrentUserPermissionsSchema,
  CustomPermissionCreateSchema,
  CustomRoleCreateSchema,
  CustomRoleUpdateSchema,
  EffectiveAccessEvaluateRequestSchema,
  EffectiveAccessEvaluateResponseSchema,
  EngineSetCreateSchema,
  EngineSetDetailSchema,
  EngineSetMaterializationResultSchema,
  EngineSetPreviewSchema,
  EngineSetSelectorSchema,
  EngineSetSummarySchema,
  EngineCapabilityStatusSchema,
  EngineLifecycleStatusSchema,
  ExternalEngineCapabilityDiagnosticsSchema,
  ExternalEngineDecommissionResponseSchema,
  ExternalEngineMaterializationDiagnosticsSchema,
  ExternalEngineReactivateResponseSchema,
  ExternalEngineReconcileResponseSchema,
  ExternalEngineRegistrationAuditEntrySchema,
  ExternalEngineRegistrationSchema,
  ExternalEngineSystemCreateSchema,
  ExternalEngineSystemSchema,
  ExternalEngineSystemUpdateSchema,
  IdentityMappingProvisionAccessRequestSchema,
  IdentityMappingProvisionAccessResponseSchema,
  IdentityMappingRequestSchema,
  IdentityMappingResponseSchema,
  IdentityMappingStoredSnapshotPreviewRequestSchema,
  IdentityMappingStoredSnapshotPreviewResponseSchema,
  IdentityMappingTestRequestSchema,
  IdentityMappingTestResponseSchema,
  IdentityMappingUpdateSchema,
  PermissionCatalogEntrySchema,
  ProjectEngineTargetCreateSchema,
  ProjectEngineTargetSchema,
  ProjectEngineTargetUpdateSchema,
  DeploymentEligibilityEvaluateRequestSchema,
  DeploymentEligibilityEvaluateResponseSchema,
  RoleAssignmentCreateSchema,
  RoleAssignmentSchema,
  RoleDetailSchema,
  RoleSummarySchema,
  RuntimeResourceQuerySchema,
  RuntimeResourceSchema,
  RuntimeResourceSetMaterializationResultSchema,
  RuntimeResourceSetQuerySchema,
  RuntimeResourceSetSchema,
  ServiceAccountCreateSchema,
  ServiceAccountSchema,
  ServiceAccountWithTokenSchema,
  SsoAssignmentMappingInsertSchema,
  SsoAssignmentMappingSchema,
  SsoEngineAccessSnapshotQuerySchema,
  SsoEngineAccessSnapshotSchema,
  SsoSyncDiagnosticsRunRequestSchema,
  SsoSyncDiagnosticsScanResultSchema,
  SsoSyncEventSchema,
  SsoSyncEventsQuerySchema,
  SsoSyncRunSchema,
  SsoSyncRunsQuerySchema,
  EngineAccessTransitionCleanupApplyRequestSchema,
  EngineAccessTransitionCleanupApplyResponseSchema,
  EngineAccessTransitionCleanupPreviewSchema,
  BridgeDecisionRequestSchema,
  BridgeDecisionResponseSchema,
  SsoGroupMappingInsertSchema,
  SsoGroupMappingSchema,
} = await import('./platform-admin/authz.js');

registry.registerPath({
  method: 'get',
  path: '/engines-api/engines/{id}/project-targets',
  ...authzExtension('engine.project-access.requests.read', 'GET', '/engines-api/engines/{id}/project-targets'),
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: 'Project-engine deployment targets for an engine', content: { 'application/json': { schema: z.array(ProjectEngineTargetSchema) } } } },
});
const AuthzPolicyResponseSchema = z.object({
  id: z.string(),
  tenantId: z.string().nullable().optional(),
  name: z.string(),
  description: z.string().nullable().optional(),
  effect: z.enum(['allow', 'deny']),
  priority: z.number(),
  resourceType: z.string().optional(),
  action: z.string().optional(),
  conditions: z.unknown().optional(),
  isActive: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
  createdById: z.string().optional(),
});

const AuthzPolicyCreateRequestSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  effect: z.enum(['allow', 'deny']),
  resourceType: z.string().optional(),
  action: z.string().optional(),
  conditions: z.record(z.string(), z.unknown()).optional(),
  priority: z.number().int().min(0).optional(),
});

const AuthzPolicyUpdateRequestSchema = AuthzPolicyCreateRequestSchema.partial();

const AuthzAuditQueryOpenApiSchema = z.object({
  userId: z.string().optional(),
  resourceType: z.string().optional(),
  resourceId: z.string().optional(),
  decision: z.enum(['allow', 'deny']).optional(),
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().min(0).optional(),
});

const AuthzAuditLogResponseSchema = z.object({
  id: z.string(),
  tenantId: z.string().nullable().optional(),
  userId: z.string(),
  action: z.string(),
  resourceType: z.string().optional(),
  resourceId: z.string().optional(),
  decision: z.enum(['allow', 'deny']),
  reason: z.string().nullable(),
  policyId: z.string().optional(),
  context: z.unknown().optional(),
  ipAddress: z.string().optional(),
  userAgent: z.string().optional(),
  timestamp: z.number(),
});

const SsoClaimsMappingSchemaOpenApi = z.object({
  id: z.string(),
  providerId: z.string().optional(),
  claimType: z.enum(['group', 'role', 'email_domain', 'custom']),
  claimKey: z.string(),
  claimValue: z.string(),
  claimOperator: z.enum([
    'equals',
    'not_equals',
    'contains',
    'not_contains',
    'contains_any',
    'not_contains_any',
    'contains_all',
    'not_contains_all',
    'matches_regex',
    'not_matches_regex',
    'exists',
    'not_exists',
  ]).nullable().optional(),
  targetRole: z.enum(['admin', 'user']),
  priority: z.number(),
  isActive: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const SsoClaimsMappingCreateRequestSchema = z.object({
  providerId: z.string().min(1).optional(),
  claimType: z.enum(['group', 'role', 'email_domain', 'custom']),
  claimKey: z.string().min(1),
  claimValue: z.string().optional(),
  claimOperator: z.enum([
    'equals',
    'not_equals',
    'contains',
    'not_contains',
    'contains_any',
    'not_contains_any',
    'contains_all',
    'not_contains_all',
    'matches_regex',
    'not_matches_regex',
    'exists',
    'not_exists',
  ]).nullable().optional(),
  targetRole: z.enum(['admin', 'user']),
  priority: z.number().int().optional(),
  isActive: z.boolean().optional(),
  riskAcknowledged: z.boolean().optional(),
});

const SsoClaimsMappingUpdateRequestSchema = SsoClaimsMappingCreateRequestSchema.partial();

const SsoMappingTestRequestSchema = z.object({
  claims: z.record(z.string(), z.unknown()),
  providerId: z.string().min(1).optional(),
});

const SsoMappingTestResponseSchema = z.object({
  matches: z.array(z.unknown()),
  resolvedRole: z.enum(['admin', 'user']).optional(),
});

const SsoAssignmentMappingTestResponseSchema = z.object({
  matches: z.array(z.unknown()),
  assignments: z.array(z.unknown()),
});

const SsoGroupMappingTestResponseSchema = z.object({
  matchedMappings: z.array(SsoGroupMappingSchema),
  memberships: z.array(z.object({
    groupId: z.string(),
    mappingId: z.string(),
  })),
});

const ConfigBundleFilesOpenApiSchema = z.object({
  './roles.json': ConfigRolesFileSchema.optional(),
  './groups.json': ConfigGroupsFileSchema.optional(),
  './engines.json': ConfigEnginesFileSchema.optional(),
  './engine-sets.json': ConfigEngineSetsFileSchema.optional(),
  './runtime-resource-sets.json': ConfigRuntimeResourceSetsFileSchema.optional(),
  './assignments.json': ConfigAssignmentsFileSchema.optional(),
  './project-engine-targets.json': ConfigProjectEngineTargetsFileSchema.optional(),
  './identity-providers.json': ConfigIdentityProvidersFileSchema.optional(),
  './identity-mappings.json': ConfigIdentityMappingsFileSchema.optional(),
}).strict();
registry.register('ConfigEngineRegistration', ConfigEngineSchema);

const ConfigBundleRequestOpenApiSchema = z.object({
  bundle: EnterpriseGlueConfigBundleSchema,
  files: ConfigBundleFilesOpenApiSchema,
});

const ConfigBundleValidationIssueOpenApiSchema = z.object({
  path: z.string(),
  message: z.string(),
  severity: z.literal('error'),
  remediation: z.string(),
  objectKey: z.string().optional(),
});

const ConfigBundlePreviewResponseOpenApiSchema = z.object({
  valid: z.boolean(),
  canonicalHash: z.string().optional(),
  errors: z.array(ConfigBundleValidationIssueOpenApiSchema),
  counts: z.record(z.string(), z.number().int().nonnegative()),
  expandedRolePermissions: z.record(z.string(), z.array(z.string())).optional(),
  roleTemplateBaselines: z.record(z.string(), z.object({ copyFromRoleKey: z.string(), fingerprint: z.string(), permissions: z.array(z.string()) })).optional(),
});

const ConfigBundleSecretPreflightResponseOpenApiSchema = z.object({
  valid: z.boolean(),
  canonicalHash: z.string().optional(),
  availabilityHash: z.string().optional(),
  available: z.boolean(),
  errors: z.array(ConfigBundleValidationIssueOpenApiSchema),
  references: z.array(z.object({
    reference: z.string(),
    locations: z.array(z.string()),
    available: z.boolean(),
    reason: z.enum(['file_provider_not_configured', 'file_outside_root', 'file_unavailable', 'environment_variable_missing']).optional(),
  })),
});

const ConfigBundleDiffChangeOpenApiSchema = z.object({
  objectType: z.enum(['role', 'group', 'engine', 'engine_set', 'runtime_resource_set', 'identity_provider', 'identity_mapping', 'project_engine_target', 'assignment']),
  key: z.string(),
  operation: z.enum(['create', 'update', 'noop', 'archive', 'conflict']),
  reason: z.string(),
  currentId: z.string().optional(),
  permissionChanges: z.object({
    additions: z.array(z.string()),
    removals: z.array(z.string()),
    effectivePermissions: z.array(z.string()),
  }).optional(),
  affectedAssignmentCount: z.number().int().nonnegative().optional(),
  runtimeResourceChanges: z.object({
    matchedCount: z.number().int().nonnegative(),
    unmatchedCount: z.number().int().nonnegative(),
    currentlyMaterialized: z.array(z.object({ resourceKind: z.string(), resourceKey: z.string(), runtimeTenantId: z.string().nullable() })),
    newlyMatched: z.array(z.object({ resourceKind: z.string(), resourceKey: z.string(), runtimeTenantId: z.string().nullable() })),
    noLongerMatched: z.array(z.object({ resourceKind: z.string(), resourceKey: z.string(), runtimeTenantId: z.string().nullable() })),
    unmatchedSelectors: z.array(z.string()),
    detailsTruncated: z.boolean(),
  }).optional(),
  identitySnapshotPreview: z.object({ scanned: z.number().int().nonnegative(), matches: z.number().int().nonnegative(), nonMatches: z.number().int().nonnegative(), failed: z.number().int().nonnegative(), truncated: z.boolean(), latestSnapshotAt: z.number().nullable(), warnings: z.array(z.string()) }).optional(),
});

const ConfigBundleDiffResponseOpenApiSchema = ConfigBundlePreviewResponseOpenApiSchema.extend({
  changes: z.array(ConfigBundleDiffChangeOpenApiSchema),
  warnings: z.array(z.object({ id: z.string(), message: z.string(), acknowledgementId: z.string().optional() })),
  requiredAcknowledgements: z.array(z.string()),
  affectedPrincipals: z.object({
    affectedGroupCount: z.number().int().nonnegative(),
    affectedUserCount: z.number().int().nonnegative(),
    externalIdentityMappingChangeCount: z.number().int().nonnegative(),
  }),
});

const ConfigBundleApplyRequestOpenApiSchema = ConfigBundleRequestOpenApiSchema.extend({
  expectedPreviewHash: z.string().min(1),
  expectedSecretPreflightHash: z.string().min(1).max(255).optional(),
  acknowledgements: z.array(z.string()).max(100).optional(),
  idempotencyKey: z.string().min(8).max(160).optional(),
  expectedTenantScope: z.string().min(1).max(255).optional(),
  identityReconciliationMode: z.enum(['none', 'preview', 'apply']).optional(),
});

const ConfigBundleApplyResponseOpenApiSchema = z.object({
  canonicalHash: z.string(),
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  archived: z.number().int().nonnegative(),
  changes: z.array(ConfigBundleDiffChangeOpenApiSchema),
  reconciliation: z.object({
    status: z.literal('completed'),
    engineSetCount: z.number().int().nonnegative(),
    runtimeResourceSetCount: z.number().int().nonnegative(),
    engineCount: z.number().int().nonnegative(),
    identitySnapshot: z.object({
      mode: z.enum(['none', 'preview', 'apply']),
      status: z.enum(['not_needed', 'skipped', 'previewed', 'completed', 'truncated', 'failed']),
      providerCount: z.number().int().nonnegative(),
      scanned: z.number().int().nonnegative(),
      created: z.number().int().nonnegative(),
      removed: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative(),
    }),
    runtimeReconciliation: z.object({
      status: z.enum(['not_needed', 'queued', 'completed', 'failed']),
      taskId: z.string().nullable(),
      engineSetCount: z.number().int().nonnegative(),
      runtimeResourceSetCount: z.number().int().nonnegative(),
      engineCount: z.number().int().nonnegative(),
    }),
  }),
  idempotent: z.boolean().optional(),
  applyRunId: z.string().optional(),
});

const ConfigBundleApplyRunOpenApiSchema = z.object({
  id: z.string(),
  bundleKey: z.string(),
  bundleApiVersion: z.string().nullable(),
  idempotencyKey: z.string().nullable(),
  actorId: z.string().nullable(),
  status: z.enum(['pending', 'succeeded', 'failed']),
  errorMessage: z.string().nullable(),
  completedAt: z.number().nullable(),
  createdAt: z.number(),
  canonicalHash: z.string().optional(),
  created: z.number().int().nonnegative().optional(),
  updated: z.number().int().nonnegative().optional(),
  archived: z.number().int().nonnegative().optional(),
  reconciliation: z.object({
    status: z.literal('completed'),
    engineSetCount: z.number().int().nonnegative(),
    runtimeResourceSetCount: z.number().int().nonnegative(),
    engineCount: z.number().int().nonnegative(),
    identitySnapshot: z.object({
      mode: z.enum(['none', 'preview', 'apply']),
      status: z.enum(['not_needed', 'skipped', 'previewed', 'completed', 'truncated', 'failed']),
      providerCount: z.number().int().nonnegative(),
      scanned: z.number().int().nonnegative(),
      created: z.number().int().nonnegative(),
      removed: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative(),
    }),
    runtimeReconciliation: z.object({
      status: z.enum(['not_needed', 'queued', 'completed', 'failed']),
      taskId: z.string().nullable(),
      engineSetCount: z.number().int().nonnegative(),
      runtimeResourceSetCount: z.number().int().nonnegative(),
      engineCount: z.number().int().nonnegative(),
    }),
  }).optional(),
  mode: z.enum(['additive', 'authoritative', 'preview_only']).nullable().optional(),
  changes: z.array(ConfigBundleDiffChangeOpenApiSchema).optional(),
  bootstrap: ConfigBootstrapStatusOpenApiSchema.optional(),
});

// POST /api/authz/check
registry.registerPath({
  method: 'post',
  path: '/api/authz/check',
  ...authzExemption('POST', '/api/authz/check'),
  request: { body: { content: { 'application/json': { schema: z.object({ resource: z.string(), action: z.string(), resourceId: z.string().optional() }) } } } },
  responses: { 200: { description: 'Authorization check result', content: { 'application/json': { schema: z.object({ allowed: z.boolean() }) } } } },
});

// POST /api/authz/check-batch
registry.registerPath({
  method: 'post',
  path: '/api/authz/check-batch',
  ...authzExemption('POST', '/api/authz/check-batch'),
  request: { body: { content: { 'application/json': { schema: z.object({ checks: z.array(z.object({ resource: z.string(), action: z.string(), resourceId: z.string().optional() })) }) } } } },
  responses: { 200: { description: 'Batch authorization results', content: { 'application/json': { schema: z.object({ results: z.array(z.object({ allowed: z.boolean() })) }) } } } },
});

// Authz policies
registry.registerPath({ method: 'get', path: '/api/authz/me/permissions', ...authzExemption('GET', '/api/authz/me/permissions'), responses: { 200: { description: 'Current user effective permissions', content: { 'application/json': { schema: CurrentUserPermissionsSchema } } } } });
registry.registerPath({ method: 'get', path: '/api/authz/permissions', ...authzExtension('platform.authz.permissions.read', 'GET', '/api/authz/permissions'), responses: { 200: { description: 'Permission catalog', content: { 'application/json': { schema: z.array(PermissionCatalogEntrySchema) } } } } });
registry.registerPath({ method: 'post', path: '/api/authz/permissions', ...authzExtension('platform.authz.roles.manage', 'POST', '/api/authz/permissions'), request: { body: { content: { 'application/json': { schema: CustomPermissionCreateSchema } } } }, responses: { 201: { description: 'Custom permission created', content: { 'application/json': { schema: z.object({ id: z.string(), key: z.string() }) } } } } });
registry.registerPath({ method: 'get', path: '/api/authz/roles', ...authzExtension('platform.authz.roles.read', 'GET', '/api/authz/roles'), responses: { 200: { description: 'List roles', content: { 'application/json': { schema: z.array(RoleSummarySchema) } } } } });
registry.registerPath({ method: 'get', path: '/api/authz/roles/{id}', ...authzExtension('platform.authz.roles.read', 'GET', '/api/authz/roles/{id}'), request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'Get role details', content: { 'application/json': { schema: RoleDetailSchema } } } } });
registry.registerPath({ method: 'post', path: '/api/authz/roles', ...authzExtension('platform.authz.roles.manage', 'POST', '/api/authz/roles'), request: { body: { content: { 'application/json': { schema: CustomRoleCreateSchema } } } }, responses: { 201: { description: 'Custom role created', content: { 'application/json': { schema: z.object({ id: z.string() }) } } } } });
registry.registerPath({ method: 'put', path: '/api/authz/roles/{id}', ...authzExtension('platform.authz.roles.manage', 'PUT', '/api/authz/roles/{id}'), request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: CustomRoleUpdateSchema } } } }, responses: { 200: { description: 'Custom role updated', content: { 'application/json': { schema: z.object({ success: z.boolean() }) } } } } });
registry.registerPath({ method: 'delete', path: '/api/authz/roles/{id}', ...authzExtension('platform.authz.roles.manage', 'DELETE', '/api/authz/roles/{id}'), request: { params: z.object({ id: z.string() }) }, responses: { 204: { description: 'Custom role archived' } } });
registry.registerPath({ method: 'post', path: '/api/authz/config-bundles/import-zip', ...authzExtension('platform.config-bundles.preview', 'POST', '/api/authz/config-bundles/import-zip'), request: { body: { content: { 'application/zip': { schema: z.string() }, 'application/octet-stream': { schema: z.string() } } } }, responses: { 200: { description: 'Convert a validated folder-style configuration ZIP into the standard bundle envelope', content: { 'application/json': { schema: ConfigBundleRequestOpenApiSchema } } }, 422: { description: 'Invalid configuration ZIP archive' } } });
registry.registerPath({ method: 'post', path: '/api/authz/config-bundles/preview', ...authzExtension('platform.config-bundles.preview', 'POST', '/api/authz/config-bundles/preview'), request: { body: { content: { 'application/json': { schema: ConfigBundleRequestOpenApiSchema } } } }, responses: { 200: { description: 'Validated config bundle preview', content: { 'application/json': { schema: ConfigBundlePreviewResponseOpenApiSchema } } }, 422: { description: 'Invalid config bundle preview', content: { 'application/json': { schema: ConfigBundlePreviewResponseOpenApiSchema } } } } });
registry.registerPath({ method: 'post', path: '/api/authz/config-bundles/validate-secret-refs', ...authzExtension('platform.config-bundles.preview', 'POST', '/api/authz/config-bundles/validate-secret-refs'), request: { body: { content: { 'application/json': { schema: ConfigBundleRequestOpenApiSchema } } } }, responses: { 200: { description: 'Secret-reference availability without secret values', content: { 'application/json': { schema: ConfigBundleSecretPreflightResponseOpenApiSchema } } }, 422: { description: 'Invalid configuration bundle', content: { 'application/json': { schema: ConfigBundleSecretPreflightResponseOpenApiSchema } } } } });
registry.registerPath({ method: 'post', path: '/api/authz/config-bundles/diff', ...authzExtension('platform.config-bundles.preview', 'POST', '/api/authz/config-bundles/diff'), request: { body: { content: { 'application/json': { schema: ConfigBundleRequestOpenApiSchema } } } }, responses: { 200: { description: 'Persisted config bundle diff', content: { 'application/json': { schema: ConfigBundleDiffResponseOpenApiSchema } } }, 422: { description: 'Invalid config bundle input', content: { 'application/json': { schema: ConfigBundleDiffResponseOpenApiSchema } } } } });
registry.registerPath({ method: 'post', path: '/api/authz/config-bundles/apply', ...authzExtension('platform.config-bundles.apply', 'POST', '/api/authz/config-bundles/apply'), request: { body: { content: { 'application/json': { schema: ConfigBundleApplyRequestOpenApiSchema } } } }, responses: { 200: { description: 'Applied config bundle with all requested reconciliation complete', content: { 'application/json': { schema: ConfigBundleApplyResponseOpenApiSchema } } }, 202: { description: 'Applied config bundle with durable identity or runtime reconciliation queued; inspect applyRunId and task receipts', content: { 'application/json': { schema: ConfigBundleApplyResponseOpenApiSchema } } }, 409: { description: 'Preview hash or ownership conflict' }, 422: { description: 'Invalid or unsupported config bundle' } } });
registry.registerPath({ method: 'get', path: '/api/authz/config-bundles/runs', ...authzExtension('platform.config-bundles.view', 'GET', '/api/authz/config-bundles/runs'), request: { query: z.object({ limit: z.coerce.number().int().min(1).max(100).optional() }) }, responses: { 200: { description: 'Recent hash-bound configuration bundle applies', content: { 'application/json': { schema: z.array(ConfigBundleApplyRunOpenApiSchema) } } } } });
registry.registerPath({ method: 'get', path: '/api/authz/config-bundles/runs/{id}', ...authzExtension('platform.config-bundles.view', 'GET', '/api/authz/config-bundles/runs/{id}'), request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'One hash-bound configuration bundle apply receipt', content: { 'application/json': { schema: ConfigBundleApplyRunOpenApiSchema } } }, 404: { description: 'Configuration bundle apply run not found' } } });
registry.registerPath({ method: 'get', path: '/api/authz/config-bundles/runs/{id}/identity-replay-tasks', ...authzExtension('platform.config-bundles.view', 'GET', '/api/authz/config-bundles/runs/{id}/identity-replay-tasks'), request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'Durable stored identity replay continuation tasks for one configuration apply, cross-linked to their SSO sync runs', content: { 'application/json': { schema: z.array(z.object({ id: z.string(), providerId: z.string(), syncRunId: z.string().nullable(), status: z.enum(['queued', 'running', 'completed', 'cancelled']), attempts: z.number().int().nonnegative(), nextAttemptAt: z.number().int().nullable(), scanned: z.number().int().nonnegative(), created: z.number().int().nonnegative(), removed: z.number().int().nonnegative(), failed: z.number().int().nonnegative(), lastError: z.string().nullable(), completedAt: z.number().int().nullable(), createdAt: z.number().int(), updatedAt: z.number().int() })) } } }, 404: { description: 'Configuration bundle apply run not found' } } });
registry.registerPath({ method: 'get', path: '/api/authz/config-bundles/runs/{id}/runtime-reconciliation-tasks', ...authzExtension('platform.config-bundles.view', 'GET', '/api/authz/config-bundles/runs/{id}/runtime-reconciliation-tasks'), request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'Durable post-apply Engine Set and runtime-resource reconciliation tasks for one configuration apply', content: { 'application/json': { schema: z.array(z.object({ id: z.string(), status: z.enum(['queued', 'running', 'completed']), attempts: z.number().int().nonnegative(), nextAttemptAt: z.number().int().nullable(), engineSetIds: z.array(z.string()), runtimeResourceSetIds: z.array(z.string()), engineIds: z.array(z.string()), lastError: z.string().nullable(), completedAt: z.number().int().nullable(), createdAt: z.number().int(), updatedAt: z.number().int() })) } } }, 404: { description: 'Configuration bundle apply run not found' } } });
registry.registerPath({ method: 'get', path: '/api/authz/config-bundles/export', ...authzExtension('platform.config-bundles.export', 'GET', '/api/authz/config-bundles/export'), request: { query: z.object({ bundleKey: z.string(), tenantKey: z.string().optional() }) }, responses: { 200: { description: 'Export all apply-supported config-owned authorization, identity, engine, and deployment-target records for a bundle key', content: { 'application/json': { schema: ConfigBundleRequestOpenApiSchema } } } } });
registry.registerPath({
  method: 'get',
  path: '/api/authz/role-assignments',
  ...authzExtension('platform.authz.assignments.read', 'GET', '/api/authz/role-assignments'),
  request: {
    query: z.object({
      principalType: AuthzPrincipalTypeSchema.optional(),
      principalId: z.string().optional(),
      resourceType: AuthzResourceTypeSchema.optional(),
      resourceId: z.string().optional(),
      scopeType: AuthzResourceTypeSchema.optional(),
      scopeId: z.string().optional(),
      engineId: z.string().optional(),
    }),
  },
  responses: { 200: { description: 'List role assignments', content: { 'application/json': { schema: z.array(RoleAssignmentSchema) } } } },
});
registry.registerPath({ method: 'post', path: '/api/authz/role-assignments', ...authzExtension('platform.authz.assignments.create', 'POST', '/api/authz/role-assignments'), request: { body: { content: { 'application/json': { schema: RoleAssignmentCreateSchema } } } }, responses: { 201: { description: 'Role assignment created', content: { 'application/json': { schema: z.object({ id: z.string(), warnings: z.array(z.string()) }) } } } } });
registry.registerPath({ method: 'delete', path: '/api/authz/role-assignments/{id}', ...authzExtension('platform.authz.assignments.delete', 'DELETE', '/api/authz/role-assignments/:id'), request: { params: z.object({ id: z.string() }) }, responses: { 204: { description: 'Manual role assignment removed' } } });
registry.registerPath({ method: 'get', path: '/api/authz/groups', ...authzExtension('platform.authz.groups.read', 'GET', '/api/authz/groups'), request: { query: z.object({ includeArchived: z.enum(['true', 'false']).optional() }) }, responses: { 200: { description: 'List authorization groups', content: { 'application/json': { schema: z.array(AuthzGroupSchema) } } } } });
registry.registerPath({ method: 'post', path: '/api/authz/groups', ...authzExtension('platform.authz.groups.manage', 'POST', '/api/authz/groups'), request: { body: { content: { 'application/json': { schema: AuthzGroupCreateSchema } } } }, responses: { 201: { description: 'Authorization group created', content: { 'application/json': { schema: z.object({ id: z.string() }) } } } } });
registry.registerPath({ method: 'put', path: '/api/authz/groups/{id}', ...authzExtension('platform.authz.groups.manage', 'PUT', '/api/authz/groups/:id'), request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: AuthzGroupUpdateSchema } } } }, responses: { 200: { description: 'Authorization group updated', content: { 'application/json': { schema: z.object({ success: z.boolean() }) } } } } });
registry.registerPath({ method: 'delete', path: '/api/authz/groups/{id}', ...authzExtension('platform.authz.groups.manage', 'DELETE', '/api/authz/groups/:id'), request: { params: z.object({ id: z.string() }) }, responses: { 204: { description: 'Authorization group archived' } } });
registry.registerPath({ method: 'get', path: '/api/authz/group-memberships', ...authzExtension('platform.authz.groups.read', 'GET', '/api/authz/group-memberships'), request: { query: z.object({ groupId: z.string().optional(), userId: z.string().optional() }) }, responses: { 200: { description: 'List authorization group memberships', content: { 'application/json': { schema: z.array(AuthzGroupMembershipSchema) } } } } });
registry.registerPath({ method: 'post', path: '/api/authz/group-memberships', ...authzExtension('platform.authz.groups.manage', 'POST', '/api/authz/group-memberships'), request: { body: { content: { 'application/json': { schema: AuthzGroupMembershipCreateSchema } } } }, responses: { 201: { description: 'Authorization group membership created', content: { 'application/json': { schema: z.object({ id: z.string() }) } } } } });
registry.registerPath({ method: 'delete', path: '/api/authz/group-memberships/{id}', ...authzExtension('platform.authz.groups.manage', 'DELETE', '/api/authz/group-memberships/:id'), request: { params: z.object({ id: z.string() }) }, responses: { 204: { description: 'Authorization group membership removed' } } });
registry.registerPath({ method: 'post', path: '/api/authz/evaluate', ...authzExtension('platform.authz.evaluate', 'POST', '/api/authz/evaluate'), request: { body: { content: { 'application/json': { schema: EffectiveAccessEvaluateRequestSchema } } } }, responses: { 200: { description: 'Effective access result', content: { 'application/json': { schema: EffectiveAccessEvaluateResponseSchema } } } } });
registry.registerPath({ method: 'get', path: '/api/authz/api-clients', ...authzExtension('platform.api-clients.read', 'GET', '/api/authz/api-clients'), responses: { 200: { description: 'List API clients', content: { 'application/json': { schema: z.array(ApiClientSchema) } } } } });
registry.registerPath({ method: 'post', path: '/api/authz/api-clients', ...authzExtension('platform.api-clients.manage', 'POST', '/api/authz/api-clients'), request: { body: { content: { 'application/json': { schema: ApiClientCreateSchema } } } }, responses: { 201: { description: 'API client created', content: { 'application/json': { schema: ApiClientWithTokenSchema } } } } });
registry.registerPath({ method: 'post', path: '/api/authz/api-clients/{id}/rotate', ...authzExtension('platform.api-clients.manage', 'POST', '/api/authz/api-clients/{id}/rotate'), request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'API client secret rotated', content: { 'application/json': { schema: ApiClientWithTokenSchema } } } } });
registry.registerPath({ method: 'delete', path: '/api/authz/api-clients/{id}', ...authzExtension('platform.api-clients.manage', 'DELETE', '/api/authz/api-clients/{id}'), request: { params: z.object({ id: z.string() }) }, responses: { 204: { description: 'API client revoked' } } });
registry.registerPath({ method: 'get', path: '/api/authz/service-accounts', ...authzExtension('platform.service-accounts.read', 'GET', '/api/authz/service-accounts'), responses: { 200: { description: 'List service accounts', content: { 'application/json': { schema: z.array(ServiceAccountSchema) } } } } });
registry.registerPath({ method: 'post', path: '/api/authz/service-accounts', ...authzExtension('platform.service-accounts.manage', 'POST', '/api/authz/service-accounts'), request: { body: { content: { 'application/json': { schema: ServiceAccountCreateSchema } } } }, responses: { 201: { description: 'Service account created', content: { 'application/json': { schema: ServiceAccountWithTokenSchema } } } } });
registry.registerPath({ method: 'post', path: '/api/authz/service-accounts/{id}/rotate', ...authzExtension('platform.service-accounts.manage', 'POST', '/api/authz/service-accounts/{id}/rotate'), request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'Service account token rotated', content: { 'application/json': { schema: ServiceAccountWithTokenSchema } } } } });
registry.registerPath({ method: 'delete', path: '/api/authz/service-accounts/{id}', ...authzExtension('platform.service-accounts.manage', 'DELETE', '/api/authz/service-accounts/{id}'), request: { params: z.object({ id: z.string() }) }, responses: { 204: { description: 'Service account revoked' } } });
registry.registerPath({ method: 'get', path: '/api/authz/external-engine-systems', ...authzExtension('platform.external-engine-systems.read', 'GET', '/api/authz/external-engine-systems'), responses: { 200: { description: 'List external engine source systems', content: { 'application/json': { schema: z.array(ExternalEngineSystemSchema) } } } } });
registry.registerPath({ method: 'post', path: '/api/authz/external-engine-systems', ...authzExtension('platform.external-engine-systems.manage', 'POST', '/api/authz/external-engine-systems'), request: { body: { content: { 'application/json': { schema: ExternalEngineSystemCreateSchema } } } }, responses: { 201: { description: 'External engine source system created', content: { 'application/json': { schema: ExternalEngineSystemSchema } } } } });
registry.registerPath({ method: 'put', path: '/api/authz/external-engine-systems/{id}', ...authzExtension('platform.external-engine-systems.manage', 'PUT', '/api/authz/external-engine-systems/{id}'), request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: ExternalEngineSystemUpdateSchema } } } }, responses: { 200: { description: 'External engine source system updated', content: { 'application/json': { schema: ExternalEngineSystemSchema } } } } });
registry.registerPath({ method: 'delete', path: '/api/authz/external-engine-systems/{id}', ...authzExtension('platform.external-engine-systems.manage', 'DELETE', '/api/authz/external-engine-systems/{id}'), request: { params: z.object({ id: z.string() }) }, responses: { 204: { description: 'External engine source system archived' } } });
registry.registerPath({ method: 'get', path: '/api/authz/external-engines', ...authzExtension('platform.external-engines.read', 'GET', '/api/authz/external-engines'), responses: { 200: { description: 'List externally registered engines', content: { 'application/json': { schema: z.array(ExternalEngineRegistrationSchema) } } } } });
registry.registerPath({ method: 'get', path: '/api/authz/external-engines/{id}/audit', ...authzExtension('platform.external-engines.audit.read', 'GET', '/api/authz/external-engines/{id}/audit'), request: { params: z.object({ id: z.string() }), query: z.object({ action: z.enum(['all', 'engine.external_registration.create', 'engine.external_registration.update', 'engine.external_registration.decommission', 'engine.external_registration.reactivate', 'engine.external_registration.reconcile']).optional(), limit: z.string().optional() }) }, responses: { 200: { description: 'List external engine registration audit entries', content: { 'application/json': { schema: z.array(ExternalEngineRegistrationAuditEntrySchema) } } } } });
registry.registerPath({ method: 'post', path: '/api/authz/external-engines/{id}/decommission', ...authzExtension('platform.external-engines.lifecycle.manage', 'POST', '/api/authz/external-engines/{id}/decommission'), request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: z.object({ reason: z.string().optional() }).partial() } } } }, responses: { 200: { description: 'Externally registered engine decommissioned by platform admin', content: { 'application/json': { schema: ExternalEngineDecommissionResponseSchema } } } } });
registry.registerPath({ method: 'post', path: '/api/authz/external-engines/{id}/reactivate', ...authzExtension('platform.external-engines.lifecycle.manage', 'POST', '/api/authz/external-engines/{id}/reactivate'), request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: z.object({ reason: z.string().optional() }).partial() } } } }, responses: { 200: { description: 'Externally registered engine reactivated by platform admin', content: { 'application/json': { schema: ExternalEngineReactivateResponseSchema } } } } });
registry.registerPath({ method: 'post', path: '/api/authz/external-engines/{id}/reconcile', ...authzExtension('platform.external-engines.reconcile', 'POST', '/api/authz/external-engines/{id}/reconcile'), request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'Reconcile external engine capability and Engine Set materialization state', content: { 'application/json': { schema: ExternalEngineReconcileResponseSchema } } } } });
registry.registerPath({ method: 'get', path: '/api/authz/engine-sets', ...authzExtension('platform.engine-sets.read', 'GET', '/api/authz/engine-sets'), request: { query: z.object({ includeArchived: z.enum(['true', 'false']).optional() }) }, responses: { 200: { description: 'List Engine Sets', content: { 'application/json': { schema: z.array(EngineSetSummarySchema) } } } } });
registry.registerPath({ method: 'post', path: '/api/authz/engine-sets/preview', ...authzExtension('platform.engine-sets.manage', 'POST', '/api/authz/engine-sets/preview'), request: { body: { content: { 'application/json': { schema: z.object({ selector: EngineSetSelectorSchema }) } } } }, responses: { 200: { description: 'Preview Engine Set selector matches', content: { 'application/json': { schema: EngineSetPreviewSchema } } } } });
registry.registerPath({ method: 'post', path: '/api/authz/engine-sets', ...authzExtension('platform.engine-sets.manage', 'POST', '/api/authz/engine-sets'), request: { body: { content: { 'application/json': { schema: EngineSetCreateSchema } } } }, responses: { 201: { description: 'Engine Set created', content: { 'application/json': { schema: z.object({ id: z.string() }) } } } } });
registry.registerPath({ method: 'get', path: '/api/authz/engine-sets/{id}', ...authzExtension('platform.engine-sets.read', 'GET', '/api/authz/engine-sets/:id'), request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'Get Engine Set details', content: { 'application/json': { schema: EngineSetDetailSchema } } } } });
registry.registerPath({ method: 'put', path: '/api/authz/engine-sets/{id}', ...authzExtension('platform.engine-sets.manage', 'PUT', '/api/authz/engine-sets/:id'), request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: EngineSetCreateSchema.partial() } } } }, responses: { 200: { description: 'Engine Set updated', content: { 'application/json': { schema: z.object({ success: z.boolean() }) } } } } });
registry.registerPath({ method: 'delete', path: '/api/authz/engine-sets/{id}', ...authzExtension('platform.engine-sets.manage', 'DELETE', '/api/authz/engine-sets/:id'), request: { params: z.object({ id: z.string() }) }, responses: { 204: { description: 'Engine Set archived' } } });
registry.registerPath({ method: 'post', path: '/api/authz/engine-sets/{id}/materialize', ...authzExtension('platform.engine-sets.manage', 'POST', '/api/authz/engine-sets/:id/materialize'), request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'Refresh Engine Set materialization', content: { 'application/json': { schema: EngineSetMaterializationResultSchema } } } } });
registry.registerPath({ method: 'get', path: '/api/authz/runtime-resources', ...authzExtension('platform.engine-sets.read', 'GET', '/api/authz/runtime-resources'), request: { query: RuntimeResourceQuerySchema }, responses: { 200: { description: 'List persisted runtime resource inventory for an engine', content: { 'application/json': { schema: z.array(RuntimeResourceSchema) } } } } });
registry.registerPath({ method: 'get', path: '/api/authz/runtime-resource-sets', ...authzExtension('platform.engine-sets.read', 'GET', '/api/authz/runtime-resource-sets'), request: { query: RuntimeResourceSetQuerySchema }, responses: { 200: { description: 'List Runtime Resource Sets', content: { 'application/json': { schema: z.array(RuntimeResourceSetSchema) } } } } });
registry.registerPath({ method: 'post', path: '/api/authz/runtime-resource-sets/{id}/materialize', ...authzExtension('platform.engine-sets.manage', 'POST', '/api/authz/runtime-resource-sets/:id/materialize'), request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'Refresh Runtime Resource Set materialization', content: { 'application/json': { schema: RuntimeResourceSetMaterializationResultSchema } } } } });
registry.registerPath({ method: 'post', path: '/api/authz/runtime-resources/{id}/reconcile', ...authzExtension('platform.engine-sets.manage', 'POST', '/api/authz/runtime-resources/:id/reconcile'), request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'Discover runtime definitions and deployments, deactivate absent resources, and refresh Runtime Resource Set materializations', content: { 'application/json': { schema: EngineMetadataReconciliationResultSchema } } } } });
registry.registerPath({ method: 'get', path: '/engines-api/engines/{id}/runtime-resources', ...authzExtension('engine.inventory.read', 'GET', '/engines-api/engines/{id}/runtime-resources'), request: { params: z.object({ id: z.string() }), query: z.object({ resourceKind: z.enum(['process_definition', 'decision_definition']).optional(), includeInactive: z.enum(['true', 'false']).optional() }) }, responses: { 200: { description: 'Sanitized runtime resource inventory for one engine', content: { 'application/json': { schema: z.array(RuntimeResourceSchema) } } } } });
registry.registerPath({ method: 'post', path: '/engines-api/engines/{id}/runtime-resources/reconcile', ...authzExtension('engine.inventory.update', 'POST', '/engines-api/engines/{id}/runtime-resources/reconcile'), request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'Reconcile runtime and deployment metadata for one engine', content: { 'application/json': { schema: EngineMetadataReconciliationResultSchema } } } } });
registry.registerPath({ method: 'get', path: '/api/authz/project-engine-targets', ...authzExtension('platform.project-engine-targets.read', 'GET', '/api/authz/project-engine-targets'), request: { query: z.object({ projectId: z.string().optional(), engineId: z.string().optional(), status: z.enum(['active', 'disabled', 'archived', 'all']).optional(), source: z.enum(['manual', 'legacy', 'ci', 'api', 'import', 'deployment_history', 'external', 'system', 'automation', 'config']).optional() }) }, responses: { 200: { description: 'List project-engine targets', content: { 'application/json': { schema: z.array(ProjectEngineTargetSchema) } } } } });
registry.registerPath({ method: 'post', path: '/api/authz/project-engine-targets/evaluate', ...authzExtension('project.deployment-eligibility.evaluate', 'POST', '/api/authz/project-engine-targets/evaluate'), request: { body: { content: { 'application/json': { schema: DeploymentEligibilityEvaluateRequestSchema } } } }, responses: { 200: { description: 'Deployment eligibility evaluation', content: { 'application/json': { schema: DeploymentEligibilityEvaluateResponseSchema } } } } });
registry.registerPath({ method: 'post', path: '/api/authz/project-engine-targets/sync-legacy', ...authzExtension('platform.project-engine-targets.manage', 'POST', '/api/authz/project-engine-targets/sync-legacy'), request: { body: { content: { 'application/json': { schema: z.object({ projectId: z.string().min(1) }) } } } }, responses: { 200: { description: 'Legacy project-engine access mirrored into targets', content: { 'application/json': { schema: z.object({ createdOrUpdated: z.number() }) } } } } });
registry.registerPath({ method: 'post', path: '/api/authz/project-engine-targets', ...authzExtension('platform.project-engine-targets.manage', 'POST', '/api/authz/project-engine-targets'), request: { body: { content: { 'application/json': { schema: ProjectEngineTargetCreateSchema } } } }, responses: { 201: { description: 'Project-engine target created', content: { 'application/json': { schema: z.object({ id: z.string() }) } } } } });
registry.registerPath({ method: 'get', path: '/api/authz/project-engine-targets/{id}', ...authzExtension('platform.project-engine-targets.read', 'GET', '/api/authz/project-engine-targets/:id'), request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'Get project-engine target', content: { 'application/json': { schema: ProjectEngineTargetSchema } } } } });
registry.registerPath({ method: 'put', path: '/api/authz/project-engine-targets/{id}', ...authzExtension('platform.project-engine-targets.manage', 'PUT', '/api/authz/project-engine-targets/:id'), request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: ProjectEngineTargetUpdateSchema } } } }, responses: { 200: { description: 'Project-engine target updated', content: { 'application/json': { schema: z.object({ success: z.boolean() }) } } } } });
registry.registerPath({ method: 'delete', path: '/api/authz/project-engine-targets/{id}', ...authzExtension('platform.project-engine-targets.manage', 'DELETE', '/api/authz/project-engine-targets/:id'), request: { params: z.object({ id: z.string() }) }, responses: { 204: { description: 'Project-engine target archived' } } });
registry.registerPath({ method: 'get', path: '/starbase-api/projects/{projectId}/deployment-targets', ...authzExtension('project.deployment-targets.read', 'GET', '/starbase-api/projects/{projectId}/deployment-targets'), request: { params: z.object({ projectId: z.string() }), query: z.object({ status: z.enum(['active', 'disabled', 'archived', 'all']).optional(), source: z.enum(['manual', 'legacy', 'ci', 'api', 'import', 'deployment_history', 'external', 'system', 'automation', 'config']).optional() }) }, responses: { 200: { description: 'List deployment targets for one project', content: { 'application/json': { schema: z.array(ProjectEngineTargetSchema) } } } } });
registry.registerPath({ method: 'post', path: '/starbase-api/projects/{projectId}/deployment-targets/sync-legacy', ...authzExtension('project.deployment-targets.manage', 'POST', '/starbase-api/projects/{projectId}/deployment-targets/sync-legacy'), request: { params: z.object({ projectId: z.string() }) }, responses: { 200: { description: 'Legacy project-engine access mirrored into project targets', content: { 'application/json': { schema: z.object({ createdOrUpdated: z.number() }) } } } } });
registry.registerPath({ method: 'post', path: '/starbase-api/projects/{projectId}/deployment-targets', ...authzExtension('project.deployment-targets.manage', 'POST', '/starbase-api/projects/{projectId}/deployment-targets'), request: { params: z.object({ projectId: z.string() }), body: { content: { 'application/json': { schema: ProjectEngineTargetCreateSchema.omit({ projectId: true, source: true, sourceRef: true, externalSystemId: true, externalProjectId: true, externalEngineId: true, externalTargetId: true, approvedById: true, approvalStatus: true, approvedAt: true, policyTags: true, diagnostics: true }).partial({ status: true, allowManualDeploy: true, allowCiDeploy: true, allowApiDeploy: true, allowImport: true }).required({ engineId: true }) } } } }, responses: { 201: { description: 'Project deployment target created', content: { 'application/json': { schema: z.object({ id: z.string() }) } } } } });
registry.registerPath({ method: 'put', path: '/starbase-api/projects/{projectId}/deployment-targets/{targetId}', ...authzExtension('project.deployment-targets.manage', 'PUT', '/starbase-api/projects/{projectId}/deployment-targets/{targetId}'), request: { params: z.object({ projectId: z.string(), targetId: z.string() }), body: { content: { 'application/json': { schema: ProjectEngineTargetUpdateSchema.omit({ source: true, sourceRef: true, externalSystemId: true, externalProjectId: true, externalEngineId: true, externalTargetId: true, approvedById: true, approvalStatus: true, approvedAt: true, policyTags: true, diagnostics: true }) } } } }, responses: { 200: { description: 'Project deployment target updated', content: { 'application/json': { schema: z.object({ success: z.boolean() }) } } } } });
registry.registerPath({ method: 'delete', path: '/starbase-api/projects/{projectId}/deployment-targets/{targetId}', ...authzExtension('project.deployment-targets.manage', 'DELETE', '/starbase-api/projects/{projectId}/deployment-targets/{targetId}'), request: { params: z.object({ projectId: z.string(), targetId: z.string() }) }, responses: { 204: { description: 'Project deployment target archived' } } });
registry.registerPath({ method: 'get', path: '/api/authz/policies', ...authzExtension('platform.authz.policies.read', 'GET', '/api/authz/policies'), responses: { 200: { description: 'List policies', content: { 'application/json': { schema: z.array(AuthzPolicyResponseSchema) } } } } });
registry.registerPath({ method: 'post', path: '/api/authz/policies', ...authzExtension('platform.authz.policies.manage', 'POST', '/api/authz/policies'), request: { body: { content: { 'application/json': { schema: AuthzPolicyCreateRequestSchema } } } }, responses: { 201: { description: 'Policy created', content: { 'application/json': { schema: AuthzPolicyResponseSchema } } } } });
registry.registerPath({ method: 'put', path: '/api/authz/policies/{id}', ...authzExtension('platform.authz.policies.manage', 'PUT', '/api/authz/policies/{id}'), request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: AuthzPolicyUpdateRequestSchema } } } }, responses: { 200: { description: 'Policy updated', content: { 'application/json': { schema: AuthzPolicyResponseSchema } } } } });
registry.registerPath({ method: 'delete', path: '/api/authz/policies/{id}', ...authzExtension('platform.authz.policies.manage', 'DELETE', '/api/authz/policies/{id}'), request: { params: z.object({ id: z.string() }) }, responses: { 204: { description: 'Policy deleted' } } });

// Authz audit
registry.registerPath({ method: 'get', path: '/api/authz/audit', ...authzExtension('platform.audit.read', 'GET', '/api/authz/audit'), request: { query: AuthzAuditQueryOpenApiSchema }, responses: { 200: { description: 'Authorization audit log', content: { 'application/json': { schema: z.array(AuthzAuditLogResponseSchema) } } } } });

// SSO mappings
registry.registerPath({ method: 'get', path: '/api/authz/sso-mappings', ...authzExtension('platform.sso.platform-role-mappings.read', 'GET', '/api/authz/sso-mappings'), responses: { 200: { description: 'List SSO role mappings', content: { 'application/json': { schema: z.array(SsoClaimsMappingSchemaOpenApi) } } } } });
registry.registerPath({ method: 'post', path: '/api/authz/sso-mappings', ...authzExtension('platform.sso.platform-role-mappings.manage', 'POST', '/api/authz/sso-mappings'), request: { body: { content: { 'application/json': { schema: SsoClaimsMappingCreateRequestSchema } } } }, responses: { 201: { description: 'Mapping created', content: { 'application/json': { schema: SsoClaimsMappingSchemaOpenApi } } } } });
registry.registerPath({ method: 'post', path: '/api/authz/sso-mappings/{id}/migrate-provider-neutral', ...authzExtension('platform.sso.platform-role-mappings.manage', 'POST', '/api/authz/sso-mappings/{id}/migrate-provider-neutral'), request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: z.object({ providerKey: z.string().min(1).max(128), targetGroupKey: z.string().min(1).max(160).optional(), newGroup: z.object({ key: z.string().min(1).max(255), name: z.string().min(1).max(255), description: z.string().max(2000).nullable().optional() }).optional() }).refine((value) => Boolean(value.targetGroupKey) !== Boolean(value.newGroup), { message: 'Provide exactly one of targetGroupKey or newGroup' }) } } } }, responses: { 200: { description: 'Existing equivalent provider-neutral mapping and platform group role assignment', content: { 'application/json': { schema: z.object({ legacyMappingId: z.string(), created: z.boolean(), mapping: IdentityMappingResponseSchema, assignment: z.object({ id: z.string() }).passthrough(), createdGroup: z.object({ id: z.string(), key: z.string() }).passthrough().nullable() }) } } }, 201: { description: 'Global provider-neutral identity mapping and platform group role assignment created while retaining the legacy mapping', content: { 'application/json': { schema: z.object({ legacyMappingId: z.string(), created: z.boolean(), mapping: IdentityMappingResponseSchema, assignment: z.object({ id: z.string() }).passthrough(), createdGroup: z.object({ id: z.string(), key: z.string() }).passthrough().nullable() }) } } }, 400: { description: 'Legacy mapping cannot be migrated safely' }, 404: { description: 'Legacy mapping, global identity provider, or global authorization group not found' } } });
registry.registerPath({ method: 'put', path: '/api/authz/sso-mappings/{id}', ...authzExtension('platform.sso.platform-role-mappings.manage', 'PUT', '/api/authz/sso-mappings/{id}'), request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: SsoClaimsMappingUpdateRequestSchema } } } }, responses: { 200: { description: 'Mapping updated', content: { 'application/json': { schema: SsoClaimsMappingSchemaOpenApi } } } } });
registry.registerPath({ method: 'delete', path: '/api/authz/sso-mappings/{id}', ...authzExtension('platform.sso.platform-role-mappings.manage', 'DELETE', '/api/authz/sso-mappings/{id}'), request: { params: z.object({ id: z.string() }) }, responses: { 204: { description: 'Mapping deleted' } } });
registry.registerPath({ method: 'post', path: '/api/authz/sso-mappings/test', ...authzExtension('platform.sso.platform-role-mappings.manage', 'POST', '/api/authz/sso-mappings/test'), request: { body: { content: { 'application/json': { schema: SsoMappingTestRequestSchema } } } }, responses: { 200: { description: 'Test SSO mapping result', content: { 'application/json': { schema: SsoMappingTestResponseSchema } } } } });

// SSO engine assignment mappings
registry.registerPath({ method: 'get', path: '/api/authz/sso-assignment-mappings', ...authzExtension('platform.sso.engine-assignments.read', 'GET', '/api/authz/sso-assignment-mappings'), responses: { 200: { description: 'List SSO engine assignment mappings', content: { 'application/json': { schema: z.array(SsoAssignmentMappingSchema) } } } } });
registry.registerPath({ method: 'get', path: '/api/authz/legacy-mapping-coverage', ...authzExtension('platform.sso.group-mappings.read', 'GET', '/api/authz/legacy-mapping-coverage'), responses: { 200: { description: 'Legacy SSO mapping replacement candidate diagnostics', content: { 'application/json': { schema: z.array(z.object({ id: z.string(), family: z.enum(['platform_role', 'group', 'engine_assignment']), status: z.enum(['replacement_candidate', 'manual_redesign_required', 'no_replacement_candidate']), reason: z.string(), candidateIdentityMappingIds: z.array(z.string()), verification: z.object({ candidateIdentityMappingId: z.string(), verifiedById: z.string().nullable(), verifiedAt: z.number(), note: z.string() }).nullable() })) } } } } });
registry.registerPath({ method: 'get', path: '/api/authz/legacy-mapping-retirement-readiness', ...authzExtension('platform.sso.group-mappings.read', 'GET', '/api/authz/legacy-mapping-retirement-readiness'), responses: { 200: { description: 'Fail-closed readiness gate for legacy mapping evaluator retirement', content: { 'application/json': { schema: z.object({ ready: z.boolean(), activeLegacyMappingCount: z.number().int().nonnegative(), verifiedReplacementCount: z.number().int().nonnegative(), blockers: z.array(z.object({ id: z.string(), family: z.enum(['platform_role', 'group', 'engine_assignment']), reason: z.string() })) }) } } } } });
registry.registerPath({ method: 'post', path: '/api/authz/legacy-mapping-coverage/{id}/verify', ...authzExtension('platform.sso.group-mappings.manage', 'POST', '/api/authz/legacy-mapping-coverage/{id}/verify'), request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: z.object({ family: z.enum(['platform_role', 'group', 'engine_assignment']), candidateIdentityMappingId: z.string().min(1), note: z.string().min(3).max(2000) }) } } } }, responses: { 204: { description: 'Representative replacement verification recorded in the authorization audit log' }, 400: { description: 'Selected replacement is not a current candidate or verification note is invalid' } } });
registry.registerPath({ method: 'post', path: '/api/authz/legacy-mapping-retirement/disable', ...authzExtension('platform.sso.group-mappings.manage', 'POST', '/api/authz/legacy-mapping-retirement/disable'), request: { body: { content: { 'application/json': { schema: z.object({ confirmation: z.literal('RETIRE_LEGACY_MAPPINGS') }) } } } }, responses: { 200: { description: 'All covered legacy mapping rows disabled after the readiness gate passed', content: { 'application/json': { schema: z.object({ platformRoleMappingsDisabled: z.number().int().nonnegative(), groupMappingsDisabled: z.number().int().nonnegative(), engineAssignmentMappingsDisabled: z.number().int().nonnegative() }) } } }, 403: { description: 'Legacy mapping retirement readiness gate did not pass' } } });
registry.registerPath({ method: 'post', path: '/api/authz/legacy-mapping-retirement/disable-global', ...authzExtension('platform.sso.platform-role-mappings.manage', 'POST', '/api/authz/legacy-mapping-retirement/disable-global'), request: { body: { content: { 'application/json': { schema: z.object({ confirmation: z.literal('RETIRE_GLOBAL_LEGACY_MAPPINGS') }) } } } }, responses: { 200: { description: 'Globally scoped covered legacy mapping rows disabled after the readiness gate passed', content: { 'application/json': { schema: z.object({ platformRoleMappingsDisabled: z.number().int().nonnegative(), groupMappingsDisabled: z.number().int().nonnegative(), engineAssignmentMappingsDisabled: z.number().int().nonnegative() }) } } }, 403: { description: 'Missing global mapping management permission or retirement readiness gate did not pass' } } });
registry.registerPath({ method: 'post', path: '/api/authz/sso-assignment-mappings', ...authzExtension('platform.sso.engine-assignments.manage', 'POST', '/api/authz/sso-assignment-mappings'), request: { body: { content: { 'application/json': { schema: SsoAssignmentMappingInsertSchema } } } }, responses: { 201: { description: 'SSO engine assignment mapping created', content: { 'application/json': { schema: z.object({ id: z.string() }) } } } } });
registry.registerPath({ method: 'post', path: '/api/authz/sso-assignment-mappings/{id}/migrate-provider-neutral', ...authzExtension('platform.sso.engine-assignments.manage', 'POST', '/api/authz/sso-assignment-mappings/{id}/migrate-provider-neutral'), request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: z.object({ providerKey: z.string().min(1).max(128), targetGroupKey: z.string().min(1).max(160).optional(), newGroup: z.object({ key: z.string().min(1).max(255), name: z.string().min(1).max(255), description: z.string().max(2000).nullable().optional() }).optional() }).refine((value) => Boolean(value.targetGroupKey) !== Boolean(value.newGroup), { message: 'Provide exactly one of targetGroupKey or newGroup' }) } } } }, responses: { 200: { description: 'Existing equivalent provider-neutral identity mapping and exact-engine group role assignment', content: { 'application/json': { schema: z.object({ legacyMappingId: z.string(), providerKey: z.string(), identityMapping: IdentityMappingResponseSchema, assignment: z.object({ id: z.string(), warnings: z.array(z.string()) }), created: z.boolean(), createdGroup: z.object({ id: z.string(), key: z.string() }).passthrough().nullable() }) } } }, 201: { description: 'Provider-neutral exact-engine group role assignment created for a safe group/role, exact email-domain, or allowlisted exact custom claim while retaining the source mapping', content: { 'application/json': { schema: z.object({ legacyMappingId: z.string(), providerKey: z.string(), identityMapping: IdentityMappingResponseSchema, assignment: z.object({ id: z.string(), warnings: z.array(z.string()) }), created: z.boolean(), createdGroup: z.object({ id: z.string(), key: z.string() }).passthrough().nullable() }) } } }, 400: { description: 'Legacy mapping cannot be migrated safely, uses an unallowlisted custom claim, or requires an explicit Engine Set design' }, 404: { description: 'Legacy mapping, identity provider, target engine, or authorization group not found' } } });
registry.registerPath({ method: 'put', path: '/api/authz/sso-assignment-mappings/{id}', ...authzExtension('platform.sso.engine-assignments.manage', 'PUT', '/api/authz/sso-assignment-mappings/:id'), request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: SsoAssignmentMappingInsertSchema.partial() } } } }, responses: { 200: { description: 'SSO engine assignment mapping updated', content: { 'application/json': { schema: z.object({ success: z.boolean() }) } } } } });
registry.registerPath({ method: 'delete', path: '/api/authz/sso-assignment-mappings/{id}', ...authzExtension('platform.sso.engine-assignments.manage', 'DELETE', '/api/authz/sso-assignment-mappings/:id'), request: { params: z.object({ id: z.string() }) }, responses: { 204: { description: 'SSO engine assignment mapping deleted' } } });
registry.registerPath({ method: 'post', path: '/api/authz/sso-assignment-mappings/test', ...authzExtension('platform.sso.engine-assignments.manage', 'POST', '/api/authz/sso-assignment-mappings/test'), request: { body: { content: { 'application/json': { schema: SsoMappingTestRequestSchema } } } }, responses: { 200: { description: 'Test SSO engine assignment mappings', content: { 'application/json': { schema: SsoAssignmentMappingTestResponseSchema } } } } });
registry.registerPath({ method: 'get', path: '/api/authz/sso-engine-access-snapshots', ...authzExtension('platform.sso.engine-assignments.read', 'GET', '/api/authz/sso-engine-access-snapshots'), request: { query: SsoEngineAccessSnapshotQuerySchema }, responses: { 200: { description: 'List SSO engine access diagnostic snapshots', content: { 'application/json': { schema: z.array(SsoEngineAccessSnapshotSchema) } } } } });
registry.registerPath({ method: 'get', path: '/api/authz/sso-engine-access-snapshots/{engineId}', ...authzExtension('platform.sso.engine-assignments.read', 'GET', '/api/authz/sso-engine-access-snapshots/:engineId'), request: { params: z.object({ engineId: z.string() }) }, responses: { 200: { description: 'List SSO engine access diagnostic snapshots for one engine', content: { 'application/json': { schema: z.array(SsoEngineAccessSnapshotSchema) } } } } });
registry.registerPath({ method: 'post', path: '/api/engines/{engineId}/access/transition-cleanup-preview', ...authzExtension('platform.sso.engine-assignments.manage', 'POST', '/api/engines/:engineId/access/transition-cleanup-preview'), request: { params: z.object({ engineId: z.string() }) }, responses: { 200: { description: 'Preview duplicate manual engine access that can transition to SSO-managed access', content: { 'application/json': { schema: EngineAccessTransitionCleanupPreviewSchema } } } } });
registry.registerPath({ method: 'post', path: '/api/engines/{engineId}/access/transition-cleanup', ...authzExtension('platform.sso.engine-assignments.manage', 'POST', '/api/engines/:engineId/access/transition-cleanup'), request: { params: z.object({ engineId: z.string() }), body: { content: { 'application/json': { schema: EngineAccessTransitionCleanupApplyRequestSchema } } } }, responses: { 200: { description: 'Remove selected duplicate manual engine access assignments after transition preview', content: { 'application/json': { schema: EngineAccessTransitionCleanupApplyResponseSchema } } } } });
registry.registerPath({ method: 'post', path: '/api/mission-control/bridge/starbase-edit/evaluate', ...authzExtension('mission-control.bridge.starbase-edit.evaluate', 'POST', '/api/mission-control/bridge/starbase-edit/evaluate'), request: { body: { content: { 'application/json': { schema: BridgeDecisionRequestSchema } } } }, responses: { 200: { description: 'Evaluate Mission Control to Starbase edit bridge access', content: { 'application/json': { schema: BridgeDecisionResponseSchema } } } } });
registry.registerPath({ method: 'post', path: '/api/starbase/bridge/mission-control/evaluate', ...authzExtension('starbase.bridge.mission-control.evaluate', 'POST', '/api/starbase/bridge/mission-control/evaluate'), request: { body: { content: { 'application/json': { schema: BridgeDecisionRequestSchema } } } }, responses: { 200: { description: 'Evaluate Starbase to Mission Control runtime bridge access', content: { 'application/json': { schema: BridgeDecisionResponseSchema } } } } });
registry.registerPath({ method: 'get', path: '/api/authz/sso-sync-runs', ...authzExtension('platform.sso.engine-assignments.read', 'GET', '/api/authz/sso-sync-runs'), request: { query: SsoSyncRunsQuerySchema }, responses: { 200: { description: 'List SSO authorization sync runs', content: { 'application/json': { schema: z.array(SsoSyncRunSchema) } } } } });
registry.registerPath({ method: 'post', path: '/api/authz/sso-sync-runs/reconcile', ...authzExtension('platform.sso.engine-assignments.manage', 'POST', '/api/authz/sso-sync-runs/reconcile'), request: { body: { content: { 'application/json': { schema: SsoSyncDiagnosticsRunRequestSchema } } } }, responses: { 200: { description: 'Run SSO authorization reconciliation diagnostics and optional provider/snapshot/cleanup passes', content: { 'application/json': { schema: SsoSyncDiagnosticsScanResultSchema } } } } });
registry.registerPath({ method: 'get', path: '/api/authz/sso-sync-runs/{id}/events', ...authzExtension('platform.sso.engine-assignments.read', 'GET', '/api/authz/sso-sync-runs/:id/events'), request: { params: z.object({ id: z.string() }), query: SsoSyncEventsQuerySchema }, responses: { 200: { description: 'List SSO authorization sync run events', content: { 'application/json': { schema: z.array(SsoSyncEventSchema) } } } } });

// SSO group mappings
registry.registerPath({ method: 'get', path: '/api/authz/sso-group-mappings', ...authzExtension('platform.sso.group-mappings.read', 'GET', '/api/authz/sso-group-mappings'), responses: { 200: { description: 'List SSO claim-to-group mappings', content: { 'application/json': { schema: z.array(SsoGroupMappingSchema) } } } } });
registry.registerPath({ method: 'post', path: '/api/authz/sso-group-mappings', ...authzExtension('platform.sso.group-mappings.manage', 'POST', '/api/authz/sso-group-mappings'), request: { body: { content: { 'application/json': { schema: SsoGroupMappingInsertSchema } } } }, responses: { 201: { description: 'SSO group mapping created', content: { 'application/json': { schema: z.object({ id: z.string() }) } } } } });
registry.registerPath({ method: 'post', path: '/api/authz/sso-group-mappings/{id}/migrate-provider-neutral', ...authzExtension('platform.sso.group-mappings.manage', 'POST', '/api/authz/sso-group-mappings/{id}/migrate-provider-neutral'), request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: z.object({ providerKey: z.string().min(1).max(128) }) } } } }, responses: { 200: { description: 'Existing equivalent provider-neutral mapping', content: { 'application/json': { schema: z.object({ legacyMappingId: z.string(), providerKey: z.string(), created: z.boolean(), identityMapping: IdentityMappingResponseSchema }) } } }, 201: { description: 'Provider-neutral mapping created for a safe group/role, exact email-domain, or allowlisted exact custom claim while retaining the legacy mapping', content: { 'application/json': { schema: z.object({ legacyMappingId: z.string(), providerKey: z.string(), created: z.boolean(), identityMapping: IdentityMappingResponseSchema }) } } }, 400: { description: 'Legacy mapping cannot be represented safely or uses an unallowlisted custom claim' }, 404: { description: 'Legacy mapping, provider, or target group not found' } } });
registry.registerPath({ method: 'put', path: '/api/authz/sso-group-mappings/{id}', ...authzExtension('platform.sso.group-mappings.manage', 'PUT', '/api/authz/sso-group-mappings/:id'), request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: SsoGroupMappingInsertSchema.partial() } } } }, responses: { 200: { description: 'SSO group mapping updated', content: { 'application/json': { schema: z.object({ success: z.boolean() }) } } } } });
registry.registerPath({ method: 'delete', path: '/api/authz/sso-group-mappings/{id}', ...authzExtension('platform.sso.group-mappings.manage', 'DELETE', '/api/authz/sso-group-mappings/:id'), request: { params: z.object({ id: z.string() }) }, responses: { 204: { description: 'SSO group mapping deleted' } } });
registry.registerPath({ method: 'post', path: '/api/authz/sso-group-mappings/test', ...authzExtension('platform.sso.group-mappings.manage', 'POST', '/api/authz/sso-group-mappings/test'), request: { body: { content: { 'application/json': { schema: SsoMappingTestRequestSchema } } } }, responses: { 200: { description: 'Test SSO group mappings', content: { 'application/json': { schema: SsoGroupMappingTestResponseSchema } } } } });

// -----------------------------
// Audit API
// -----------------------------
const AuditRedactionQuerySchema = z.object({
  includePii: z.union([z.boolean(), z.enum(['true', 'false', '1', '0', 'yes', 'no'])]).optional(),
  unredacted: z.union([z.boolean(), z.enum(['true', 'false', '1', '0', 'yes', 'no'])]).optional(),
  redaction: z.enum(['redacted', 'none']).optional(),
}).passthrough();
const AuditLogListResponseSchema = z.object({
  logs: z.array(z.unknown()),
  pagination: z.object({
    limit: z.number(),
    offset: z.number(),
    total: z.number(),
    hasMore: z.boolean(),
  }).optional(),
}).passthrough();
registry.registerPath({ method: 'get', path: '/api/audit/logs', ...authzExtension('platform.audit.read', 'GET', '/api/audit/logs'), request: { query: AuditRedactionQuerySchema.extend({ limit: z.string().optional(), offset: z.string().optional(), action: z.string().optional(), userId: z.string().optional(), resourceType: z.string().optional(), resourceId: z.string().optional() }) }, responses: { 200: { description: 'Audit logs. Unredacted payloads require platform:audit:unredacted-view and must be requested with includePii=true, unredacted=true, or redaction=none.', content: { 'application/json': { schema: AuditLogListResponseSchema } } } } });
registry.registerPath({ method: 'get', path: '/api/audit/logs/resource/{resourceType}/{resourceId}', ...authzExtension('platform.audit.read', 'GET', '/api/audit/logs/resource/{resourceType}/{resourceId}'), request: { params: z.object({ resourceType: z.string(), resourceId: z.string() }), query: AuditRedactionQuerySchema.extend({ limit: z.string().optional() }) }, responses: { 200: { description: 'Audit logs by resource. Unredacted payloads require platform:audit:unredacted-view.', content: { 'application/json': { schema: AuditLogListResponseSchema } } } } });
registry.registerPath({ method: 'get', path: '/api/audit/logs/user/{userId}', ...authzExtension('platform.audit.read', 'GET', '/api/audit/logs/user/{userId}'), request: { params: z.object({ userId: z.string() }), query: AuditRedactionQuerySchema.extend({ limit: z.string().optional() }) }, responses: { 200: { description: 'Audit logs by user. Unredacted payloads require platform:audit:unredacted-view.', content: { 'application/json': { schema: AuditLogListResponseSchema } } } } });
registry.registerPath({ method: 'get', path: '/api/audit/actions', ...authzExtension('platform.audit.read', 'GET', '/api/audit/actions'), responses: { 200: { description: 'Available audit actions', content: { 'application/json': { schema: z.array(z.string()) } } } } });
registry.registerPath({ method: 'get', path: '/api/audit/stats', ...authzExtension('platform.audit.read', 'GET', '/api/audit/stats'), responses: { 200: { description: 'Audit statistics', content: { 'application/json': { schema: z.unknown() } } } } });

// -----------------------------
// Dashboard API
// -----------------------------
registry.registerPath({ method: 'get', path: '/api/dashboard/context', ...authzExtension('platform.dashboard.read', 'GET', '/api/dashboard/context'), responses: { 200: { description: 'Dashboard context data', content: { 'application/json': { schema: z.unknown() } } } } });
registry.registerPath({ method: 'get', path: '/api/dashboard/stats', ...authzExtension('platform.dashboard.read', 'GET', '/api/dashboard/stats'), responses: { 200: { description: 'Dashboard statistics', content: { 'application/json': { schema: z.unknown() } } } } });

// -----------------------------
// Notifications API
// -----------------------------
registry.registerPath({ method: 'get', path: '/api/notifications', ...authzExemption('GET', '/api/notifications'), responses: { 200: { description: 'List notifications', content: { 'application/json': { schema: z.array(z.unknown()) } } } } });
registry.registerPath({ method: 'post', path: '/api/notifications', ...authzExemption('POST', '/api/notifications'), request: { body: { content: { 'application/json': { schema: z.unknown() } } } }, responses: { 201: { description: 'Notification created' } } });
registry.registerPath({ method: 'patch', path: '/api/notifications/read', ...authzExemption('PATCH', '/api/notifications/read'), request: { body: { content: { 'application/json': { schema: z.object({ ids: z.array(z.string()).optional() }) } } } }, responses: { 200: { description: 'Notifications marked as read' } } });
registry.registerPath({ method: 'delete', path: '/api/notifications', ...authzExemption('DELETE', '/api/notifications'), responses: { 200: { description: 'Notifications deleted', content: { 'application/json': { schema: z.object({ deleted: z.number() }) } } } } });
registry.registerPath({ method: 'delete', path: '/api/notifications/{id}', ...authzExemption('DELETE', '/api/notifications/{id}'), request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'Notification deleted', content: { 'application/json': { schema: z.object({ deleted: z.number() }) } } } } });
registry.registerPath({ method: 'get', path: '/api/notifications/stream', ...authzExemption('GET', '/api/notifications/stream'), responses: { 200: { description: 'Notification SSE stream', content: { 'text/event-stream': { schema: z.string() } } } } });

// -----------------------------
// Users API
// -----------------------------
const CreatePlatformUserRequestSchema = z.object({
  email: z.string().email(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  role: z.enum(['admin', 'user']).optional(),
  platformRole: z.enum(['admin', 'user']).optional(),
  sendEmail: z.boolean().optional(),
});
const UpdatePlatformUserRequestSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  role: z.enum(['admin', 'user']).optional(),
  platformRole: z.enum(['admin', 'user']).optional(),
  isActive: z.boolean().optional(),
});
const UserOperationMessageSchema = z.object({ message: z.string() });

registry.registerPath({ method: 'get', path: '/api/users', ...authzExtension('platform.users.read', 'GET', '/api/users'), request: { query: z.object({ limit: z.string().optional(), offset: z.string().optional() }) }, responses: { 200: { description: 'List users', content: { 'application/json': { schema: z.array(z.unknown()) } } } } });
registry.registerPath({ method: 'post', path: '/api/users', ...authzExtension('platform.users.create', 'POST', '/api/users'), request: { body: { content: { 'application/json': { schema: CreatePlatformUserRequestSchema } } } }, responses: { 201: { description: 'User created', content: { 'application/json': { schema: z.unknown() } } } } });
registry.registerPath({ method: 'get', path: '/api/users/{id}', ...authzExtension('platform.users.read', 'GET', '/api/users/{id}'), request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'User details', content: { 'application/json': { schema: z.unknown() } } }, 404: { description: 'Not found' } } });
registry.registerPath({ method: 'put', path: '/api/users/{id}', ...authzExtension('platform.users.update', 'PUT', '/api/users/{id}'), request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: UpdatePlatformUserRequestSchema } } } }, responses: { 200: { description: 'User updated', content: { 'application/json': { schema: z.unknown() } } } } });
registry.registerPath({ method: 'delete', path: '/api/users/{id}', ...authzExtension('platform.users.deactivate', 'DELETE', '/api/users/{id}'), request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'User deactivated', content: { 'application/json': { schema: UserOperationMessageSchema } } } } });
registry.registerPath({ method: 'delete', path: '/api/users/{id}/permanent', ...authzExtension('platform.users.permanent-delete', 'DELETE', '/api/users/{id}/permanent'), request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'User permanently deleted', content: { 'application/json': { schema: UserOperationMessageSchema } } } } });
registry.registerPath({ method: 'post', path: '/api/users/{id}/unlock', ...authzExtension('platform.users.unlock', 'POST', '/api/users/{id}/unlock'), request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'User unlocked', content: { 'application/json': { schema: UserOperationMessageSchema } } } } });

// -----------------------------
// Git API - Extended
// -----------------------------

// Admin providers
registry.registerPath({ method: 'get', path: '/git-api/admin/providers', ...authzExtension('platform.git.providers.manage', 'GET', '/git-api/admin/providers'), responses: { 200: { description: 'List admin git providers', content: { 'application/json': { schema: z.array(z.unknown()) } } } } });
registry.registerPath({ method: 'put', path: '/git-api/admin/providers/{id}', ...authzExtension('platform.git.providers.manage', 'PUT', '/git-api/admin/providers/:id'), request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: z.unknown() } } } }, responses: { 200: { description: 'Provider updated', content: { 'application/json': { schema: z.unknown() } } } } });

// Providers
registry.registerPath({ method: 'get', path: '/git-api/providers', ...authzExemption('GET', '/git-api/providers'), responses: { 200: { description: 'List git providers', content: { 'application/json': { schema: z.array(z.unknown()) } } } } });
registry.registerPath({ method: 'get', path: '/git-api/providers/{id}', ...authzExemption('GET', '/git-api/providers/:id'), request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'Provider details', content: { 'application/json': { schema: z.unknown() } } } } });
registry.registerPath({ method: 'get', path: '/git-api/providers/{id}/repos', ...authzExemption('GET', '/git-api/providers/:id/repos'), request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'List repos for provider', content: { 'application/json': { schema: z.array(z.unknown()) } } } } });

// Credentials
registry.registerPath({ method: 'get', path: '/git-api/credentials', ...authzExemption('GET', '/git-api/credentials'), responses: { 200: { description: 'List git credentials', content: { 'application/json': { schema: z.array(z.unknown()) } } } } });
registry.registerPath({ method: 'get', path: '/git-api/credentials/{providerId}', ...authzExemption('GET', '/git-api/credentials/:providerId'), request: { params: z.object({ providerId: z.string() }) }, responses: { 200: { description: 'Git credential metadata for provider', content: { 'application/json': { schema: z.unknown() } } }, 404: { description: 'Not found' } } });
registry.registerPath({ method: 'post', path: '/git-api/credentials', ...authzExemption('POST', '/git-api/credentials'), request: { body: { content: { 'application/json': { schema: z.unknown() } } } }, responses: { 201: { description: 'Credential created', content: { 'application/json': { schema: z.unknown() } } } } });
registry.registerPath({ method: 'patch', path: '/git-api/credentials/{credentialId}', ...authzExemption('PATCH', '/git-api/credentials/:credentialId'), request: { params: z.object({ credentialId: z.string() }), body: { content: { 'application/json': { schema: z.unknown() } } } }, responses: { 200: { description: 'Credential updated', content: { 'application/json': { schema: z.unknown() } } } } });
registry.registerPath({ method: 'delete', path: '/git-api/credentials/{providerId}', ...authzExemption('DELETE', '/git-api/credentials/:providerId'), request: { params: z.object({ providerId: z.string() }) }, responses: { 204: { description: 'Provider credentials deleted' } } });
registry.registerPath({ method: 'get', path: '/git-api/credentials/{providerId}/validate', ...authzExemption('GET', '/git-api/credentials/:providerId/validate'), request: { params: z.object({ providerId: z.string() }) }, responses: { 200: { description: 'Credential validation result', content: { 'application/json': { schema: z.object({ valid: z.boolean() }) } } } } });
registry.registerPath({ method: 'get', path: '/git-api/credentials/{credentialId}/namespaces', ...authzExemption('GET', '/git-api/credentials/:credentialId/namespaces'), request: { params: z.object({ credentialId: z.string() }) }, responses: { 200: { description: 'Available namespaces', content: { 'application/json': { schema: z.array(z.unknown()) } } } } });

// Clone & create
registry.registerPath({ method: 'post', path: '/git-api/clone', ...authzExtension('project.create.git.create', 'POST', '/git-api/clone'), request: { body: { content: { 'application/json': { schema: z.unknown() } } } }, responses: { 201: { description: 'Repository cloned', content: { 'application/json': { schema: z.unknown() } } } } });
registry.registerPath({ method: 'post', path: '/git-api/create-online', ...authzExtension('project.create.git.create', 'POST', '/git-api/create-online'), request: { body: { content: { 'application/json': { schema: z.unknown() } } } }, responses: { 201: { description: 'Online repo created', content: { 'application/json': { schema: z.unknown() } } } } });
registry.registerPath({ method: 'post', path: '/git-api/check-repo-exists', ...authzExtension('project.create.git.inspect', 'POST', '/git-api/check-repo-exists'), request: { body: { content: { 'application/json': { schema: z.object({ url: z.string() }) } } } }, responses: { 200: { description: 'Check result', content: { 'application/json': { schema: z.object({ exists: z.boolean() }) } } } } });
registry.registerPath({ method: 'post', path: '/git-api/repo-info', ...authzExtension('project.create.git.inspect', 'POST', '/git-api/repo-info'), request: { body: { content: { 'application/json': { schema: z.unknown() } } } }, responses: { 200: { description: 'Repository info', content: { 'application/json': { schema: z.unknown() } } } } });

// Git deployments
registry.registerPath({ method: 'get', path: '/git-api/deployments', ...authzExtension('project.deployments.read', 'GET', '/git-api/deployments'), request: { query: z.object({ projectId: z.string().optional() }).passthrough() }, responses: { 200: { description: 'List git deployments', content: { 'application/json': { schema: z.array(z.unknown()) } } } } });
registry.registerPath({ method: 'get', path: '/git-api/deployments/{id}', ...authzExtension('project.deployments.read', 'GET', '/git-api/deployments/:id'), request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'Deployment details', content: { 'application/json': { schema: z.unknown() } } }, 404: { description: 'Not found' } } });
registry.registerPath({ method: 'get', path: '/git-api/projects/{projectId}/deployments', ...authzExtension('project.deployments.read', 'GET', '/git-api/projects/:projectId/deployments'), request: { params: z.object({ projectId: z.string() }) }, responses: { 200: { description: 'Deployments for project', content: { 'application/json': { schema: z.array(z.unknown()) } } } } });

// Git sync
registry.registerPath({ method: 'post', path: '/git-api/sync', ...authzExtension('project.git.sync.run', 'POST', '/git-api/sync'), request: { body: { content: { 'application/json': { schema: z.object({ projectId: z.string() }) } } } }, responses: { 200: { description: 'Sync started', content: { 'application/json': { schema: z.unknown() } } } } });
registry.registerPath({ method: 'get', path: '/git-api/sync/status', ...authzExtension('project.git.sync.status', 'GET', '/git-api/sync/status'), request: { query: z.object({ projectId: z.string() }) }, responses: { 200: { description: 'Sync status', content: { 'application/json': { schema: z.unknown() } } } } });

// Git lock heartbeat
registry.registerPath({ method: 'put', path: '/git-api/locks/{lockId}/heartbeat', ...authzExtension('project.git.locks.heartbeat', 'PUT', '/git-api/locks/:lockId/heartbeat'), request: { params: z.object({ lockId: z.string() }) }, responses: { 200: { description: 'Lock heartbeat renewed' } } });
registry.registerPath({ method: 'get', path: '/git-api/locks/{fileId}/events', ...authzExtension('project.git.locks.read', 'GET', '/git-api/locks/:fileId/events'), request: { params: z.object({ fileId: z.string().uuid() }) }, responses: { 200: { description: 'SSE stream of lock and file events', content: { 'text/event-stream': { schema: z.string() } } } } });

// Git OAuth
registry.registerPath({ method: 'get', path: '/git-api/oauth/{providerId}/authorize', ...authzExemption('GET', '/git-api/oauth/:providerId/authorize'), request: { params: z.object({ providerId: z.string() }) }, responses: { 302: { description: 'Redirect to OAuth provider' } } });
registry.registerPath({ method: 'get', path: '/git-api/oauth/{providerId}/authorize/redirect', ...authzExemption('GET', '/git-api/oauth/:providerId/authorize/redirect'), request: { params: z.object({ providerId: z.string() }) }, responses: { 302: { description: 'OAuth redirect' } } });
registry.registerPath({ method: 'get', path: '/git-api/oauth/{providerId}/config', ...authzExemption('GET', '/git-api/oauth/:providerId/config'), request: { params: z.object({ providerId: z.string() }) }, responses: { 200: { description: 'OAuth config', content: { 'application/json': { schema: z.unknown() } } } } });
registry.registerPath({ method: 'post', path: '/git-api/oauth/{providerId}/refresh', ...authzExemption('POST', '/git-api/oauth/:providerId/refresh'), request: { params: z.object({ providerId: z.string() }) }, responses: { 200: { description: 'Token refreshed' } } });
registry.registerPath({ method: 'get', path: '/git-api/oauth/authorize/redirect', ...authzExemption('GET', '/git-api/oauth/authorize/redirect'), responses: { 302: { description: 'Generic OAuth redirect' } } });
registry.registerPath({ method: 'post', path: '/git-api/oauth/callback', ...authzExemption('POST', '/git-api/oauth/callback'), responses: { 200: { description: 'OAuth callback processed' } } });

// Git project connection
registry.registerPath({ method: 'get', path: '/git-api/project-connection', ...authzExtension('project.git.repositories.read', 'GET', '/git-api/project-connection'), request: { query: z.object({ projectId: z.string() }) }, responses: { 200: { description: 'Project connection state', content: { 'application/json': { schema: z.unknown() } } } } });
registry.registerPath({ method: 'post', path: '/git-api/project-connection', ...authzExtension('project.git.repositories.manage', 'POST', '/git-api/project-connection'), request: { body: { content: { 'application/json': { schema: z.unknown() } } } }, responses: { 200: { description: 'Project connection established', content: { 'application/json': { schema: z.unknown() } } } } });
registry.registerPath({ method: 'put', path: '/git-api/project-connection/token', ...authzExtension('project.git.repositories.manage', 'PUT', '/git-api/project-connection/token'), request: { body: { content: { 'application/json': { schema: z.unknown() } } } }, responses: { 200: { description: 'Connection token updated' } } });
registry.registerPath({ method: 'delete', path: '/git-api/project-connection', ...authzExtension('project.git.repositories.manage', 'DELETE', '/git-api/project-connection'), request: { body: { content: { 'application/json': { schema: z.unknown() } } } }, responses: { 200: { description: 'Project connection disconnected', content: { 'application/json': { schema: z.object({ success: z.boolean() }) } } } } });

export function generateOpenApi(): any {
  const generator = new OpenApiGeneratorV3(registry.definitions);
  return generator.generateDocument({
    openapi: '3.0.3',
    info: { title: 'Voyager API', version: '0.1.0' },
  });
}
