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
  HistoricDecisionInstanceSchema,
  UserOperationLogEntrySchema,
  HistoricTaskQueryParams,
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

const HealthSchema = z.object({ status: z.literal('ok') });
registry.register('Health', HealthSchema);
registry.registerPath({
  method: 'get',
  path: '/health',
  responses: {
    200: { description: 'Health check', content: { 'application/json': { schema: HealthSchema } } },
  },
});

registry.register('Project', ProjectSchema);
registry.registerPath({
  method: 'get',
  path: '/starbase-api/projects',
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

// PATCH /projects/:projectId (rename project)
registry.register('RenameProjectRequest', RenameProjectRequest);
registry.registerPath({
  method: 'patch',
  path: '/starbase-api/projects/{projectId}',
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
  request: { params: z.object({ fileId: z.string() }) },
  responses: {
    200: {
      description: 'Get file by id',
      content: { 'application/json': { schema: FileSchema } },
    },
    404: { description: 'Not found' },
  },
});

// POST /projects/:projectId/files (create new BPMN/DMN file)
registry.register('CreateFileRequest', CreateFileRequest);
registry.registerPath({
  method: 'post',
  path: '/starbase-api/projects/{projectId}/files',
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

// GET /files/:fileId/versions (list versions for a file)
registry.registerPath({
  method: 'get',
  path: '/starbase-api/files/{fileId}/versions',
  request: { params: z.object({ fileId: z.string() }) },
  responses: {
    200: {
      description: 'List file versions',
      content: { 'application/json': { schema: z.array(VersionSchema) } },
    },
  },
});

// GET /versions/:versionId/compare/:otherVersionId (compare two versions)
registry.register('CompareVersionsResponse', CompareVersionsResponse);
registry.registerPath({
  method: 'get',
  path: '/starbase-api/versions/{versionId}/compare/{otherVersionId}',
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
registry.registerPath({ method: 'get', path: '/starbase-api/deployments', request: { query: DeploymentQueryParams.partial() }, responses: { 200: { description: 'List deployments', content: { 'application/json': { schema: z.array(DeploymentSchema) } } } } });
registry.registerPath({ method: 'get', path: '/starbase-api/deployments/{id}', request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'Get deployment', content: { 'application/json': { schema: DeploymentSchema } } }, 404: { description: 'Not found' } } });
registry.registerPath({ method: 'delete', path: '/starbase-api/deployments/{id}', request: { params: z.object({ id: z.string() }), query: z.object({ cascade: z.string().optional() }) }, responses: { 204: { description: 'Deleted' } } });
registry.registerPath({ method: 'get', path: '/starbase-api/process-definitions/{id}/diagram', request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'Process diagram', content: { 'application/json': { schema: z.unknown() } } } } });

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
  request: {
    query: z.object({
      processDefinitionKey: z.string().optional(),
      active: z.string().optional(),
      suspended: z.string().optional(),
      withIncidents: z.string().optional(),
      completed: z.string().optional(),
      canceled: z.string().optional(),
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
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'Process instance variables', content: { 'application/json': { schema: MissionControlVariablesSchema } } },
  },
});

// GET /mission-control-api/process-instances/{id}/history/activity-instances
registry.registerPath({
  method: 'get',
  path: '/mission-control-api/process-instances/{id}/history/activity-instances',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'Historic activity instances', content: { 'application/json': { schema: z.array(MissionControlActivityInstanceSchema) } } },
  },
});

// GET /mission-control-api/process-instances/{id}/incidents
registry.registerPath({
  method: 'get',
  path: '/mission-control-api/process-instances/{id}/incidents',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'Incidents for an instance', content: { 'application/json': { schema: z.array(z.unknown()) } } },
  },
});

// PUT /mission-control-api/process-instances/{id}/suspend
registry.registerPath({
  method: 'put',
  path: '/mission-control-api/process-instances/{id}/suspend',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: { description: 'Suspended' },
  },
});

// PUT /mission-control-api/process-instances/{id}/activate
registry.registerPath({
  method: 'put',
  path: '/mission-control-api/process-instances/{id}/activate',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: { description: 'Activated' },
  },
});

// PUT /mission-control-api/process-instances/{id}/retry (retry failed jobs)
registry.registerPath({
  method: 'put',
  path: '/mission-control-api/process-instances/{id}/retry',
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
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: { description: 'Deleted' },
  },
});

// GET /mission-control-api/history/process-instances (list historic instances)
registry.registerPath({
  method: 'get',
  path: '/mission-control-api/history/process-instances',
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

registry.registerPath({
  method: 'get',
  path: '/engines-api/engines',
  responses: {
    200: { description: 'List engines', content: { 'application/json': { schema: z.array(EngineSchema) } } },
  },
})

registry.registerPath({
  method: 'post',
  path: '/engines-api/engines',
  request: { body: { content: { 'application/json': { schema: EngineSchemaRaw.partial({ id: true, createdAt: true, updatedAt: true }) } } } },
  responses: { 201: { description: 'Created', content: { 'application/json': { schema: EngineSchema } } } },
})

registry.registerPath({
  method: 'get',
  path: '/engines-api/engines/{id}',
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: 'Engine', content: { 'application/json': { schema: EngineSchema } } }, 404: { description: 'Not found' } },
})

registry.registerPath({
  method: 'put',
  path: '/engines-api/engines/{id}',
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: EngineSchemaRaw.partial() } } } },
  responses: { 200: { description: 'Updated', content: { 'application/json': { schema: EngineSchema } } } },
})

registry.registerPath({
  method: 'delete',
  path: '/engines-api/engines/{id}',
  request: { params: z.object({ id: z.string() }) },
  responses: { 204: { description: 'Deleted' } },
})

// Active engine
registry.registerPath({
  method: 'get',
  path: '/engines-api/engines/active',
  responses: { 200: { description: 'Active engine or null', content: { 'application/json': { schema: EngineSchema.nullable() } } } },
})

// Activate engine
registry.registerPath({
  method: 'post',
  path: '/engines-api/engines/{id}/activate',
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: 'Activated engine', content: { 'application/json': { schema: EngineSchema } } } },
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
})
registry.register('EngineHealth', EngineHealthSchema)

registry.registerPath({
  method: 'post',
  path: '/engines-api/engines/{id}/test',
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: 'Health test result', content: { 'application/json': { schema: EngineHealthSchema } } } },
})

registry.registerPath({
  method: 'get',
  path: '/engines-api/engines/{id}/health',
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: 'Last recorded health or null', content: { 'application/json': { schema: EngineHealthSchema.nullable() } } } },
})

registry.register('SavedFilter', SavedFilterSchema)

registry.registerPath({
  method: 'get',
  path: '/engines-api/saved-filters',
  responses: { 200: { description: 'List saved filters', content: { 'application/json': { schema: z.array(SavedFilterSchema) } } } },
})

registry.registerPath({
  method: 'post',
  path: '/engines-api/saved-filters',
  request: { body: { content: { 'application/json': { schema: SavedFilterSchemaRaw.partial({ id: true, createdAt: true }) } } } },
  responses: { 201: { description: 'Created', content: { 'application/json': { schema: SavedFilterSchema } } } },
})

registry.registerPath({
  method: 'get',
  path: '/engines-api/saved-filters/{id}',
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: 'Saved filter', content: { 'application/json': { schema: SavedFilterSchema } } }, 404: { description: 'Not found' } },
})

registry.registerPath({
  method: 'put',
  path: '/engines-api/saved-filters/{id}',
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: SavedFilterSchemaRaw.partial() } } } },
  responses: { 200: { description: 'Updated', content: { 'application/json': { schema: SavedFilterSchema } } } },
})

registry.registerPath({
  method: 'delete',
  path: '/engines-api/saved-filters/{id}',
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
  request: { params: z.object({ engineId: z.string() }), body: { content: { 'application/json': { schema: DeployRequest } } } },
  responses: { 200: { description: 'Preview of resources to deploy', content: { 'application/json': { schema: PreviewResponse } } } },
})

registry.registerPath({
  method: 'post',
  path: '/engines-api/engines/{engineId}/deployments',
  request: { params: z.object({ engineId: z.string() }), body: { content: { 'application/json': { schema: DeployRequest } } } },
  responses: { 201: { description: 'Deployment created', content: { 'application/json': { schema: DeployResponse } } } },
})

registry.registerPath({
  method: 'get',
  path: '/engines-api/engines/{engineId}/deployments',
  request: { params: z.object({ engineId: z.string() }) },
  responses: { 200: { description: 'List engine deployments (raw engine shape)', content: { 'application/json': { schema: z.unknown() } } } },
})

registry.registerPath({
  method: 'get',
  path: '/engines-api/engines/{engineId}/deployments/{id}',
  request: { params: z.object({ engineId: z.string(), id: z.string() }) },
  responses: { 200: { description: 'Engine deployment detail (raw engine shape)', content: { 'application/json': { schema: z.unknown() } } }, 404: { description: 'Not found' } },
})

registry.registerPath({
  method: 'delete',
  path: '/engines-api/engines/{engineId}/deployments/{id}',
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
  request: { body: { content: { 'application/json': { schema: CreateDeleteBatchRequest } } } },
  responses: { 201: { description: 'Created', content: { 'application/json': { schema: CreateBatchResponse } } } },
})

// Create: suspend instances (async)
registry.registerPath({
  method: 'post',
  path: '/mission-control-api/batches/process-instances/suspend',
  request: { body: { content: { 'application/json': { schema: CreateSuspendActivateBatchRequest } } } },
  responses: { 201: { description: 'Created', content: { 'application/json': { schema: CreateBatchResponse } } } },
})

// Create: activate instances (async)
registry.registerPath({
  method: 'post',
  path: '/mission-control-api/batches/process-instances/activate',
  request: { body: { content: { 'application/json': { schema: CreateSuspendActivateBatchRequest } } } },
  responses: { 201: { description: 'Created', content: { 'application/json': { schema: CreateBatchResponse } } } },
})

// Create: set job retries (async)
registry.registerPath({
  method: 'post',
  path: '/mission-control-api/batches/jobs/retries',
  request: { body: { content: { 'application/json': { schema: CreateRetriesBatchRequest } } } },
  responses: { 201: { description: 'Created', content: { 'application/json': { schema: CreateBatchResponse } } } },
})

// List batches
registry.registerPath({
  method: 'get',
  path: '/mission-control-api/batches',
  responses: { 200: { description: 'List batches', content: { 'application/json': { schema: z.array(BatchSchema) } } } },
})

// Batch detail
registry.registerPath({
  method: 'get',
  path: '/mission-control-api/batches/{id}',
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: 'Batch detail', content: { 'application/json': { schema: BatchDetailSchema } } }, 404: { description: 'Not found' } },
})

// Cancel batch
registry.registerPath({
  method: 'delete',
  path: '/mission-control-api/batches/{id}',
  request: { params: z.object({ id: z.string() }) },
  responses: { 204: { description: 'Canceled' }, 404: { description: 'Not found' } },
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
  request: { body: { content: { 'application/json': { schema: MigrationGenerateInput } } } },
  responses: { 200: { description: 'Generated migration plan (engine shape)', content: { 'application/json': { schema: MigrationPlanSchema } } } },
})

// POST /mission-control-api/migration/plan/validate
registry.registerPath({
  method: 'post',
  path: '/mission-control-api/migration/plan/validate',
  request: { body: { content: { 'application/json': { schema: MigrationValidateRequest } } } },
  responses: { 200: { description: 'Validation result', content: { 'application/json': { schema: z.unknown() } } } },
})

// POST /mission-control-api/migration/execute-async
registry.registerPath({
  method: 'post',
  path: '/mission-control-api/migration/execute-async',
  request: { body: { content: { 'application/json': { schema: MigrationExecuteRequest } } } },
  responses: { 201: { description: 'Created', content: { 'application/json': { schema: MigrationCreateResponse } } } },
})

// POST /mission-control-api/migration/execute-direct
registry.registerPath({
  method: 'post',
  path: '/mission-control-api/migration/execute-direct',
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

registry.registerPath({ method: 'post', path: '/mission-control-api/direct/process-instances/delete', request: { body: { content: { 'application/json': { schema: DirectIds } } } }, responses: { 200: { description: 'Result', content: { 'application/json': { schema: DirectResult } } } } })
registry.registerPath({ method: 'post', path: '/mission-control-api/direct/process-instances/suspend', request: { body: { content: { 'application/json': { schema: DirectSuspend } } } }, responses: { 200: { description: 'Result', content: { 'application/json': { schema: DirectResult } } } } })
registry.registerPath({ method: 'post', path: '/mission-control-api/direct/process-instances/activate', request: { body: { content: { 'application/json': { schema: DirectSuspend } } } }, responses: { 200: { description: 'Result', content: { 'application/json': { schema: DirectResult } } } } })
registry.registerPath({ method: 'post', path: '/mission-control-api/direct/jobs/retries', request: { body: { content: { 'application/json': { schema: DirectRetries } } } }, responses: { 200: { description: 'Result', content: { 'application/json': { schema: DirectResult } } } } })

// -----------------------------
// Mission Control API - Extended Endpoints
// -----------------------------

// Tasks
registry.register('Task', TaskSchema);
registry.registerPath({ method: 'get', path: '/mission-control-api/tasks', request: { query: TaskQueryParams.partial() }, responses: { 200: { description: 'Query tasks', content: { 'application/json': { schema: z.array(TaskSchema) } } } } });
registry.registerPath({ method: 'get', path: '/mission-control-api/tasks/count', request: { query: TaskQueryParams.partial() }, responses: { 200: { description: 'Count tasks', content: { 'application/json': { schema: z.object({ count: z.number() }) } } } } });
registry.registerPath({ method: 'get', path: '/mission-control-api/tasks/{id}', request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'Get task', content: { 'application/json': { schema: TaskSchema } } }, 404: { description: 'Not found' } } });
registry.registerPath({ method: 'get', path: '/mission-control-api/tasks/{id}/variables', request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'Task variables', content: { 'application/json': { schema: MissionControlVariablesSchema } } } } });
registry.registerPath({ method: 'put', path: '/mission-control-api/tasks/{id}/variables', request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: TaskVariablesRequest } } } }, responses: { 200: { description: 'Variables updated', content: { 'application/json': { schema: z.unknown() } } } } });
registry.registerPath({ method: 'get', path: '/mission-control-api/tasks/{id}/form', request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'Task form', content: { 'application/json': { schema: z.unknown() } } } } });
registry.registerPath({ method: 'post', path: '/mission-control-api/tasks/{id}/claim', request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: ClaimTaskRequest } } } }, responses: { 204: { description: 'Claimed' } } });
registry.registerPath({ method: 'post', path: '/mission-control-api/tasks/{id}/unclaim', request: { params: z.object({ id: z.string() }) }, responses: { 204: { description: 'Unclaimed' } } });
registry.registerPath({ method: 'post', path: '/mission-control-api/tasks/{id}/assignee', request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: SetAssigneeRequest } } } }, responses: { 204: { description: 'Assignee set' } } });
registry.registerPath({ method: 'post', path: '/mission-control-api/tasks/{id}/complete', request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: CompleteTaskRequest.partial() } } } }, responses: { 200: { description: 'Task completed', content: { 'application/json': { schema: z.unknown() } } } } });

// External Tasks
registry.register('ExternalTask', ExternalTaskSchema);
registry.registerPath({ method: 'post', path: '/mission-control-api/external-tasks/fetchAndLock', request: { body: { content: { 'application/json': { schema: FetchAndLockRequest } } } }, responses: { 200: { description: 'Locked external tasks', content: { 'application/json': { schema: z.array(ExternalTaskSchema) } } } } });
registry.registerPath({ method: 'get', path: '/mission-control-api/external-tasks', request: { query: ExternalTaskQueryParams.partial() }, responses: { 200: { description: 'Query external tasks', content: { 'application/json': { schema: z.array(ExternalTaskSchema) } } } } });
registry.registerPath({ method: 'post', path: '/mission-control-api/external-tasks/{id}/complete', request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: CompleteExternalTaskRequest } } } }, responses: { 204: { description: 'Completed' } } });
registry.registerPath({ method: 'post', path: '/mission-control-api/external-tasks/{id}/failure', request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: ExternalTaskFailureRequest } } } }, responses: { 204: { description: 'Failure reported' } } });
registry.registerPath({ method: 'post', path: '/mission-control-api/external-tasks/{id}/bpmnError', request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: ExternalTaskBpmnErrorRequest } } } }, responses: { 204: { description: 'BPMN error reported' } } });
registry.registerPath({ method: 'post', path: '/mission-control-api/external-tasks/{id}/extendLock', request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: ExtendLockRequest } } } }, responses: { 204: { description: 'Lock extended' } } });
registry.registerPath({ method: 'post', path: '/mission-control-api/external-tasks/{id}/unlock', request: { params: z.object({ id: z.string() }) }, responses: { 204: { description: 'Unlocked' } } });

// Messages & Signals
registry.register('MessageCorrelationResult', MessageCorrelationResultSchema);
registry.registerPath({ method: 'post', path: '/mission-control-api/messages', request: { body: { content: { 'application/json': { schema: CorrelateMessageRequest } } } }, responses: { 200: { description: 'Message correlated', content: { 'application/json': { schema: MessageCorrelationResultSchema } } } } });
registry.registerPath({ method: 'post', path: '/mission-control-api/signals', request: { body: { content: { 'application/json': { schema: SignalEventSchema } } } }, responses: { 204: { description: 'Signal delivered' } } });

// Decisions
registry.register('DecisionDefinition', DecisionDefinitionSchema);
registry.registerPath({ method: 'get', path: '/mission-control-api/decision-definitions', request: { query: DecisionDefinitionQueryParams.partial() }, responses: { 200: { description: 'List decision definitions', content: { 'application/json': { schema: z.array(DecisionDefinitionSchema) } } } } });
registry.registerPath({ method: 'get', path: '/mission-control-api/decision-definitions/{id}', request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'Get decision definition', content: { 'application/json': { schema: DecisionDefinitionSchema } } }, 404: { description: 'Not found' } } });
registry.registerPath({ method: 'get', path: '/mission-control-api/decision-definitions/{id}/xml', request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'DMN XML', content: { 'application/json': { schema: z.object({ dmnXml: z.string() }) } } } } });
registry.registerPath({ method: 'post', path: '/mission-control-api/decision-definitions/{id}/evaluate', request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: EvaluateDecisionRequest } } } }, responses: { 200: { description: 'Decision result', content: { 'application/json': { schema: z.array(z.unknown()) } } } } });

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
registry.registerPath({ method: 'get', path: '/mission-control-api/jobs', request: { query: JobQueryParams.partial() }, responses: { 200: { description: 'Query jobs', content: { 'application/json': { schema: z.array(JobSchema) } } } } });
registry.registerPath({ method: 'get', path: '/mission-control-api/jobs/{id}', request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'Get job', content: { 'application/json': { schema: JobSchema } } }, 404: { description: 'Not found' } } });
registry.registerPath({ method: 'post', path: '/mission-control-api/jobs/{id}/execute', request: { params: z.object({ id: z.string() }) }, responses: { 204: { description: 'Job executed' } } });
registry.registerPath({ method: 'put', path: '/mission-control-api/jobs/{id}/retries', request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: SetJobRetriesRequest } } } }, responses: { 204: { description: 'Retries set' } } });
registry.registerPath({ method: 'put', path: '/mission-control-api/jobs/{id}/suspended', request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: SetJobSuspensionStateRequest } } } }, responses: { 204: { description: 'Suspension state updated' } } });
registry.registerPath({ method: 'get', path: '/mission-control-api/job-definitions', request: { query: JobDefinitionQueryParams.partial() }, responses: { 200: { description: 'Query job definitions', content: { 'application/json': { schema: z.array(JobDefinitionSchema) } } } } });
registry.registerPath({ method: 'put', path: '/mission-control-api/job-definitions/{id}/retries', request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: SetJobDefinitionRetriesRequest } } } }, responses: { 204: { description: 'Retries set' } } });
registry.registerPath({ method: 'put', path: '/mission-control-api/job-definitions/{id}/suspended', request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: SetJobDefinitionSuspensionStateRequest } } } }, responses: { 204: { description: 'Suspension state updated' } } });

// Extended History
registry.register('HistoricTaskInstance', HistoricTaskInstanceSchema);
registry.register('HistoricVariableInstance', HistoricVariableInstanceSchema);
registry.register('HistoricDecisionInstance', HistoricDecisionInstanceSchema);
registry.register('UserOperationLogEntry', UserOperationLogEntrySchema);
registry.registerPath({ method: 'get', path: '/mission-control-api/history/tasks', request: { query: HistoricTaskQueryParams.partial() }, responses: { 200: { description: 'Historic task instances', content: { 'application/json': { schema: z.array(HistoricTaskInstanceSchema) } } } } });
registry.registerPath({ method: 'get', path: '/mission-control-api/history/variables', request: { query: HistoricVariableQueryParams.partial() }, responses: { 200: { description: 'Historic variable instances', content: { 'application/json': { schema: z.array(HistoricVariableInstanceSchema) } } } } });
registry.registerPath({ method: 'get', path: '/mission-control-api/history/decisions', request: { query: HistoricDecisionQueryParams.partial() }, responses: { 200: { description: 'Historic decision instances', content: { 'application/json': { schema: z.array(HistoricDecisionInstanceSchema) } } } } });
registry.registerPath({ method: 'get', path: '/mission-control-api/history/decisions/{id}/inputs', request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'Inputs for a historic decision instance', content: { 'application/json': { schema: z.array(z.unknown()) } } }, 404: { description: 'Not found' } } });
registry.registerPath({ method: 'get', path: '/mission-control-api/history/decisions/{id}/outputs', request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'Outputs for a historic decision instance', content: { 'application/json': { schema: z.array(z.unknown()) } } }, 404: { description: 'Not found' } } });
registry.registerPath({ method: 'get', path: '/mission-control-api/history/user-operations', request: { query: UserOperationLogQueryParams.partial() }, responses: { 200: { description: 'User operation log', content: { 'application/json': { schema: z.array(UserOperationLogEntrySchema) } } } } });

// Metrics
registry.register('Metric', MetricSchema);
registry.registerPath({ method: 'get', path: '/mission-control-api/metrics', request: { query: MetricsQueryParams.partial() }, responses: { 200: { description: 'Query metrics', content: { 'application/json': { schema: z.array(MetricSchema) } } } } });
registry.registerPath({ method: 'get', path: '/mission-control-api/metrics/{name}', request: { params: z.object({ name: z.string() }), query: MetricsQueryParams.partial() }, responses: { 200: { description: 'Get metric by name', content: { 'application/json': { schema: z.array(MetricSchema) } } } } });

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
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: ProcessInstanceModificationRequest } } } },
  responses: { 204: { description: 'Modified' } },
})

// POST /mission-control-api/process-definitions/{id}/modification/execute-async
registry.registerPath({
  method: 'post',
  path: '/mission-control-api/process-definitions/{id}/modification/execute-async',
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: ProcessDefinitionModificationAsyncRequest } } } },
  responses: { 201: { description: 'Batch created', content: { 'application/json': { schema: z.object({ id: z.string(), camundaBatchId: z.string().optional(), type: z.literal('MODIFY_INSTANCES') }) } } } },
})

// POST /mission-control-api/process-definitions/{id}/restart/execute-async
registry.registerPath({
  method: 'post',
  path: '/mission-control-api/process-definitions/{id}/restart/execute-async',
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
  responses: { 
    200: { description: 'List of repositories', content: { 'application/json': { schema: z.array(RepositorySelectSchema) } } },
  },
});

// GET /git-api/repositories/:id (get repository details)
registry.registerPath({
  method: 'get',
  path: '/git-api/repositories/{id}',
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
  request: { params: z.object({ lockId: z.string().uuid() }) },
  responses: { 
    204: { description: 'Lock released' },
  },
});

// GET /git-api/locks (list active locks)
registry.registerPath({
  method: 'get',
  path: '/git-api/locks',
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
  ProjectMemberSchema,
  AddProjectMemberRequest,
  UpdateProjectMemberRoleRequest,
  TransferProjectOwnershipRequest,
  EngineMemberSchema,
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
  responses: { 200: { description: 'List environment tags', content: { 'application/json': { schema: z.array(EnvironmentTagSchema) } } } },
});

registry.registerPath({
  method: 'post',
  path: '/api/admin/environments',
  request: { body: { content: { 'application/json': { schema: CreateEnvironmentTagRequest } } } },
  responses: { 201: { description: 'Created', content: { 'application/json': { schema: EnvironmentTagSchema } } } },
});

registry.registerPath({
  method: 'put',
  path: '/api/admin/environments/{id}',
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: UpdateEnvironmentTagRequest } } } },
  responses: { 200: { description: 'Updated', content: { 'application/json': { schema: SuccessResponseSchema } } } },
});

registry.registerPath({
  method: 'delete',
  path: '/api/admin/environments/{id}',
  request: { params: z.object({ id: z.string() }) },
  responses: { 204: { description: 'Deleted' }, 400: { description: 'In use' } },
});

registry.registerPath({
  method: 'post',
  path: '/api/admin/environments/reorder',
  request: { body: { content: { 'application/json': { schema: ReorderEnvironmentTagsRequest } } } },
  responses: { 200: { description: 'Reordered', content: { 'application/json': { schema: SuccessResponseSchema } } } },
});

// Platform Settings
registry.register('PlatformSettings', PlatformSettingsSchema);
registry.registerPath({
  method: 'get',
  path: '/api/admin/settings',
  responses: { 200: { description: 'Platform settings', content: { 'application/json': { schema: PlatformSettingsSchema } } } },
});

registry.registerPath({
  method: 'put',
  path: '/api/admin/settings',
  request: { body: { content: { 'application/json': { schema: UpdatePlatformSettingsRequest } } } },
  responses: { 200: { description: 'Updated', content: { 'application/json': { schema: SuccessResponseSchema } } } },
});

// Admin Governance
registry.registerPath({
  method: 'post',
  path: '/api/admin/projects/{projectId}/assign-owner',
  request: { params: z.object({ projectId: z.string().uuid() }), body: { content: { 'application/json': { schema: AssignOwnerRequest } } } },
  responses: { 200: { description: 'Owner assigned', content: { 'application/json': { schema: SuccessResponseSchema } } } },
});

registry.registerPath({
  method: 'post',
  path: '/api/admin/engines/{engineId}/assign-owner',
  request: { params: z.object({ engineId: z.string() }), body: { content: { 'application/json': { schema: AssignOwnerRequest } } } },
  responses: { 200: { description: 'Owner assigned', content: { 'application/json': { schema: SuccessResponseSchema } } } },
});

// Admin Users
registry.register('UserSearchResult', UserSearchResultSchema);
registry.register('UserListItem', UserListItemSchema);
registry.registerPath({
  method: 'get',
  path: '/api/admin/users/search',
  request: { query: z.object({ q: z.string() }) },
  responses: { 200: { description: 'Search results', content: { 'application/json': { schema: z.array(UserSearchResultSchema) } } } },
});

registry.registerPath({
  method: 'get',
  path: '/api/admin/users',
  request: { query: z.object({ limit: z.string().optional(), offset: z.string().optional() }) },
  responses: { 200: { description: 'User list', content: { 'application/json': { schema: z.array(UserListItemSchema) } } } },
});

// -----------------------------
// Project Members API
// -----------------------------
registry.register('ProjectMember', ProjectMemberSchema);
registry.registerPath({
  method: 'get',
  path: '/starbase-api/projects/{projectId}/members',
  request: { params: z.object({ projectId: z.string().uuid() }) },
  responses: { 200: { description: 'Project members', content: { 'application/json': { schema: z.array(ProjectMemberSchema) } } } },
});

registry.registerPath({
  method: 'post',
  path: '/starbase-api/projects/{projectId}/members',
  request: { params: z.object({ projectId: z.string().uuid() }), body: { content: { 'application/json': { schema: AddProjectMemberRequest } } } },
  responses: { 201: { description: 'Member added', content: { 'application/json': { schema: ProjectMemberSchema } } } },
});

registry.registerPath({
  method: 'patch',
  path: '/starbase-api/projects/{projectId}/members/{userId}',
  request: { params: z.object({ projectId: z.string().uuid(), userId: z.string().uuid() }), body: { content: { 'application/json': { schema: UpdateProjectMemberRoleRequest } } } },
  responses: { 200: { description: 'Role updated', content: { 'application/json': { schema: z.object({ message: z.string() }) } } } },
});

registry.registerPath({
  method: 'delete',
  path: '/starbase-api/projects/{projectId}/members/{userId}',
  request: { params: z.object({ projectId: z.string().uuid(), userId: z.string().uuid() }) },
  responses: { 204: { description: 'Member removed' } },
});

registry.registerPath({
  method: 'post',
  path: '/starbase-api/projects/{projectId}/transfer-ownership',
  request: { params: z.object({ projectId: z.string().uuid() }), body: { content: { 'application/json': { schema: TransferProjectOwnershipRequest } } } },
  responses: { 200: { description: 'Ownership transferred', content: { 'application/json': { schema: z.object({ message: z.string() }) } } } },
});

registry.registerPath({
  method: 'get',
  path: '/starbase-api/projects/{projectId}/members/me',
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
  responses: { 200: { description: 'Engines user has access to', content: { 'application/json': { schema: z.array(EngineWithDetailsSchema) } } } },
});

registry.registerPath({
  method: 'get',
  path: '/engines-api/engines/{engineId}/my-role',
  request: { params: z.object({ engineId: z.string() }) },
  responses: { 200: { description: 'My role on engine', content: { 'application/json': { schema: EngineRoleResponse } } } },
});

registry.registerPath({
  method: 'get',
  path: '/engines-api/engines/{engineId}/members',
  request: { params: z.object({ engineId: z.string() }) },
  responses: { 200: { description: 'Engine members', content: { 'application/json': { schema: z.array(EngineMemberSchema) } } } },
});

registry.registerPath({
  method: 'post',
  path: '/engines-api/engines/{engineId}/members',
  request: { params: z.object({ engineId: z.string() }), body: { content: { 'application/json': { schema: AddEngineMemberRequest } } } },
  responses: { 201: { description: 'Member added', content: { 'application/json': { schema: EngineMemberSchema } } } },
});

registry.registerPath({
  method: 'patch',
  path: '/engines-api/engines/{engineId}/members/{userId}',
  request: { params: z.object({ engineId: z.string(), userId: z.string().uuid() }), body: { content: { 'application/json': { schema: UpdateEngineMemberRoleRequest } } } },
  responses: { 200: { description: 'Role updated', content: { 'application/json': { schema: z.object({ message: z.string() }) } } } },
});

registry.registerPath({
  method: 'delete',
  path: '/engines-api/engines/{engineId}/members/{userId}',
  request: { params: z.object({ engineId: z.string(), userId: z.string().uuid() }) },
  responses: { 204: { description: 'Member removed' } },
});

registry.registerPath({
  method: 'post',
  path: '/engines-api/engines/{engineId}/delegate',
  request: { params: z.object({ engineId: z.string() }), body: { content: { 'application/json': { schema: AssignDelegateRequest } } } },
  responses: { 200: { description: 'Delegate assigned', content: { 'application/json': { schema: z.object({ message: z.string() }) } } } },
});

registry.registerPath({
  method: 'post',
  path: '/engines-api/engines/{engineId}/transfer-ownership',
  request: { params: z.object({ engineId: z.string() }), body: { content: { 'application/json': { schema: TransferEngineOwnershipRequest } } } },
  responses: { 200: { description: 'Ownership transferred', content: { 'application/json': { schema: z.object({ message: z.string() }) } } } },
});

registry.registerPath({
  method: 'post',
  path: '/engines-api/engines/{engineId}/environment',
  request: { params: z.object({ engineId: z.string() }), body: { content: { 'application/json': { schema: SetEnvironmentRequest } } } },
  responses: { 200: { description: 'Environment set', content: { 'application/json': { schema: z.object({ message: z.string() }) } } } },
});

registry.registerPath({
  method: 'post',
  path: '/engines-api/engines/{engineId}/lock',
  request: { params: z.object({ engineId: z.string() }), body: { content: { 'application/json': { schema: SetLockedRequest } } } },
  responses: { 200: { description: 'Lock state changed', content: { 'application/json': { schema: z.object({ message: z.string() }) } } } },
});

registry.registerPath({
  method: 'post',
  path: '/engines-api/engines/{engineId}/request-access',
  request: { params: z.object({ engineId: z.string() }), body: { content: { 'application/json': { schema: RequestAccessRequest } } } },
  responses: { 200: { description: 'Access request result', content: { 'application/json': { schema: z.object({ status: z.string(), autoApproved: z.boolean().optional(), requestId: z.string().optional() }) } } } },
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
  request: { params: z.object({ projectId: z.string() }), query: z.object({ folderId: z.string().optional() }) },
  responses: { 200: { description: 'Project contents (folders + files)', content: { 'application/json': { schema: ProjectContentsSchema } } } },
});

// GET /starbase-api/projects/:projectId/folders (flat folder list)
registry.registerPath({
  method: 'get',
  path: '/starbase-api/projects/{projectId}/folders',
  request: { params: z.object({ projectId: z.string() }) },
  responses: { 200: { description: 'List all folders in project', content: { 'application/json': { schema: z.array(FolderSummarySchema) } } } },
});

// POST /starbase-api/projects/:projectId/folders (create folder)
registry.register('CreateFolderRequest', CreateFolderRequest);
registry.registerPath({
  method: 'post',
  path: '/starbase-api/projects/{projectId}/folders',
  request: { params: z.object({ projectId: z.string() }), body: { content: { 'application/json': { schema: CreateFolderRequest } } } },
  responses: { 201: { description: 'Folder created', content: { 'application/json': { schema: FolderSchema } } } },
});

// PATCH /starbase-api/folders/:folderId (rename/move folder)
registry.register('UpdateFolderRequest', UpdateFolderRequest);
registry.registerPath({
  method: 'patch',
  path: '/starbase-api/folders/{folderId}',
  request: { params: z.object({ folderId: z.string() }), body: { content: { 'application/json': { schema: UpdateFolderRequest } } } },
  responses: { 200: { description: 'Folder updated', content: { 'application/json': { schema: z.object({ id: z.string(), name: z.string(), parentFolderId: z.string().nullable(), updatedAt: z.number() }) } } } },
});

// GET /starbase-api/folders/:folderId/delete-preview
registry.register('FolderDeletePreview', FolderDeletePreviewSchema);
registry.registerPath({
  method: 'get',
  path: '/starbase-api/folders/{folderId}/delete-preview',
  request: { params: z.object({ folderId: z.string() }) },
  responses: { 200: { description: 'Preview of folder deletion impact', content: { 'application/json': { schema: FolderDeletePreviewSchema } } } },
});

// DELETE /starbase-api/folders/:folderId
registry.registerPath({
  method: 'delete',
  path: '/starbase-api/folders/{folderId}',
  request: { params: z.object({ folderId: z.string() }) },
  responses: { 204: { description: 'Folder deleted' } },
});

// GET /starbase-api/folders/:folderId/download (zip)
registry.registerPath({
  method: 'get',
  path: '/starbase-api/folders/{folderId}/download',
  request: { params: z.object({ folderId: z.string() }) },
  responses: { 200: { description: 'ZIP archive of folder contents', content: { 'application/zip': { schema: z.string() } } }, 204: { description: 'Empty folder' } },
});

// GET /starbase-api/projects/:projectId/download (zip)
registry.registerPath({
  method: 'get',
  path: '/starbase-api/projects/{projectId}/download',
  request: { params: z.object({ projectId: z.string() }) },
  responses: { 200: { description: 'ZIP archive of project', content: { 'application/zip': { schema: z.string() } } }, 204: { description: 'Empty project' } },
});

// GET /starbase-api/files/:fileId/download (XML attachment)
registry.registerPath({
  method: 'get',
  path: '/starbase-api/files/{fileId}/download',
  request: { params: z.object({ fileId: z.string() }) },
  responses: { 200: { description: 'File XML download', content: { 'application/xml': { schema: z.string() } } }, 404: { description: 'Not found' } },
});

// POST /starbase-api/files/:fileId/restore-from-commit
registry.registerPath({
  method: 'post',
  path: '/starbase-api/files/{fileId}/restore-from-commit',
  request: {
    params: z.object({ fileId: z.string() }),
    body: { content: { 'application/json': { schema: z.object({ commitId: z.string().optional(), fileVersionNumber: z.number().optional() }) } } },
  },
  responses: { 200: { description: 'File restored', content: { 'application/json': { schema: z.object({ restored: z.boolean(), fileId: z.string(), commitId: z.string(), fileVersionNumber: z.number().nullable(), updatedAt: z.number() }) } } } },
});

// GET /starbase-api/projects/:projectId/engine-access
registry.registerPath({
  method: 'get',
  path: '/starbase-api/projects/{projectId}/engine-access',
  request: { params: z.object({ projectId: z.string() }) },
  responses: { 200: { description: 'Engine access status for project', content: { 'application/json': { schema: z.object({ accessedEngines: z.array(z.unknown()), pendingRequests: z.array(z.unknown()), availableEngines: z.array(z.unknown()) }) } } } },
});

// GET /starbase-api/projects/:projectId/engine-deployments
registry.registerPath({
  method: 'get',
  path: '/starbase-api/projects/{projectId}/engine-deployments',
  request: { params: z.object({ projectId: z.string() }), query: z.object({ limit: z.string().optional() }) },
  responses: { 200: { description: 'Engine deployments for project', content: { 'application/json': { schema: z.array(z.unknown()) } } } },
});

// GET /starbase-api/projects/:projectId/engine-deployments/latest
registry.registerPath({
  method: 'get',
  path: '/starbase-api/projects/{projectId}/engine-deployments/latest',
  request: { params: z.object({ projectId: z.string() }) },
  responses: { 200: { description: 'Latest engine deployments per file', content: { 'application/json': { schema: z.unknown() } } } },
});

// GET /starbase-api/projects/:projectId/files/:fileId/deployments
registry.registerPath({
  method: 'get',
  path: '/starbase-api/projects/{projectId}/files/{fileId}/deployments',
  request: { params: z.object({ projectId: z.string(), fileId: z.string() }) },
  responses: { 200: { description: 'Deployments for a specific file', content: { 'application/json': { schema: z.array(z.unknown()) } } } },
});

// GET /starbase-api/projects/:projectId/files/:fileId/deployments/history
registry.registerPath({
  method: 'get',
  path: '/starbase-api/projects/{projectId}/files/{fileId}/deployments/history',
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
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: 'Activity counts grouped by state', content: { 'application/json': { schema: z.unknown() } } } },
});

// POST /mission-control-api/process-definitions/key/{key}/start
registry.registerPath({
  method: 'post',
  path: '/mission-control-api/process-definitions/key/{key}/start',
  request: { params: z.object({ key: z.string() }), body: { content: { 'application/json': { schema: z.object({ variables: z.record(z.string(), z.unknown()).optional(), businessKey: z.string().optional() }) } } } },
  responses: { 200: { description: 'Process instance started', content: { 'application/json': { schema: z.unknown() } } } },
});

// GET /mission-control-api/process-definitions/key/{key}/statistics
registry.registerPath({
  method: 'get',
  path: '/mission-control-api/process-definitions/key/{key}/statistics',
  request: { params: z.object({ key: z.string() }) },
  responses: { 200: { description: 'Process definition statistics', content: { 'application/json': { schema: z.unknown() } } } },
});

// GET /mission-control-api/process-instances/{id}/activity-instances (runtime)
registry.registerPath({
  method: 'get',
  path: '/mission-control-api/process-instances/{id}/activity-instances',
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: 'Runtime activity instance tree', content: { 'application/json': { schema: z.unknown() } } } },
});

// GET /mission-control-api/process-instances/{id}/jobs
registry.registerPath({
  method: 'get',
  path: '/mission-control-api/process-instances/{id}/jobs',
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: 'Jobs for process instance', content: { 'application/json': { schema: z.array(JobSchema) } } } },
});

// GET /mission-control-api/process-instances/{id}/failed-external-tasks
registry.registerPath({
  method: 'get',
  path: '/mission-control-api/process-instances/{id}/failed-external-tasks',
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: 'Failed external tasks for instance', content: { 'application/json': { schema: z.array(ExternalTaskSchema) } } } },
});

// POST /mission-control-api/process-instances/{id}/variables (modify)
registry.registerPath({
  method: 'post',
  path: '/mission-control-api/process-instances/{id}/variables',
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: z.object({ modifications: z.record(z.string(), z.unknown()) }) } } } },
  responses: { 204: { description: 'Variables modified' } },
});

// POST /mission-control-api/decision-definitions/key/{key}/evaluate
registry.registerPath({
  method: 'post',
  path: '/mission-control-api/decision-definitions/key/{key}/evaluate',
  request: { params: z.object({ key: z.string() }), body: { content: { 'application/json': { schema: EvaluateDecisionRequest } } } },
  responses: { 200: { description: 'Decision result', content: { 'application/json': { schema: z.array(z.unknown()) } } } },
});

// PUT /mission-control-api/batches/{id}/suspended
registry.registerPath({
  method: 'put',
  path: '/mission-control-api/batches/{id}/suspended',
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: z.object({ suspended: z.boolean() }) } } } },
  responses: { 204: { description: 'Batch suspension state changed' } },
});

// DELETE /mission-control-api/batches/{id}/record
registry.registerPath({
  method: 'delete',
  path: '/mission-control-api/batches/{id}/record',
  request: { params: z.object({ id: z.string() }) },
  responses: { 204: { description: 'Batch record deleted' } },
});

// POST /mission-control-api/migration/generate (engine auto-mapping - actual path without /plan/)
registry.registerPath({
  method: 'post',
  path: '/mission-control-api/migration/generate',
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
  request: { query: z.object({ projectIds: z.string() }) },
  responses: { 200: { description: 'Batch uncommitted status', content: { 'application/json': { schema: z.object({ statuses: z.record(z.string(), z.object({ hasUncommittedChanges: z.boolean(), dirtyFileCount: z.number() })) }) } } } },
});

// POST /vcs-api/projects/:projectId/commit
registry.registerPath({
  method: 'post',
  path: '/vcs-api/projects/{projectId}/commit',
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
  request: { params: z.object({ projectId: z.string().uuid() }) },
  responses: { 200: { description: 'Draft merged to main', content: { 'application/json': { schema: z.object({ success: z.boolean(), mergeCommitId: z.string(), filesChanged: z.number() }) } } } },
});

// GET /vcs-api/projects/:projectId/commits
registry.registerPath({
  method: 'get',
  path: '/vcs-api/projects/{projectId}/commits',
  request: { params: z.object({ projectId: z.string().uuid() }), query: z.object({ branch: z.enum(['draft', 'main', 'all']).optional(), fileId: z.string().optional() }) },
  responses: { 200: { description: 'Commit history', content: { 'application/json': { schema: z.object({ commits: z.array(z.unknown()) }) } } } },
});

// GET /vcs-api/projects/:projectId/status
registry.registerPath({
  method: 'get',
  path: '/vcs-api/projects/{projectId}/status',
  request: { params: z.object({ projectId: z.string().uuid() }) },
  responses: { 200: { description: 'VCS status', content: { 'application/json': { schema: z.object({ initialized: z.boolean(), draftBranchId: z.string().optional(), mainBranchId: z.string().optional(), hasUnpublishedCommits: z.boolean().optional(), lastDraftCommit: z.unknown().nullable().optional(), lastMainCommit: z.unknown().nullable().optional() }) } } } },
});

// GET /vcs-api/projects/:projectId/uncommitted-files
registry.registerPath({
  method: 'get',
  path: '/vcs-api/projects/{projectId}/uncommitted-files',
  request: { params: z.object({ projectId: z.string().uuid() }), query: z.object({ baseline: z.enum(['main', 'draft']).optional() }) },
  responses: { 200: { description: 'Uncommitted file IDs', content: { 'application/json': { schema: z.object({ hasUncommittedChanges: z.boolean(), uncommittedFileIds: z.array(z.string()), uncommittedFolderIds: z.array(z.string()) }) } } } },
});

// GET /vcs-api/projects/:projectId/commits/:commitId/files
registry.registerPath({
  method: 'get',
  path: '/vcs-api/projects/{projectId}/commits/{commitId}/files',
  request: { params: z.object({ projectId: z.string().uuid(), commitId: z.string() }) },
  responses: { 200: { description: 'File snapshots for commit', content: { 'application/json': { schema: z.object({ files: z.array(z.unknown()) }) } } } },
});

// POST /vcs-api/projects/:projectId/commits/:commitId/restore
registry.registerPath({
  method: 'post',
  path: '/vcs-api/projects/{projectId}/commits/{commitId}/restore',
  request: { params: z.object({ projectId: z.string().uuid(), commitId: z.string() }) },
  responses: { 200: { description: 'Files restored from commit', content: { 'application/json': { schema: z.object({ success: z.boolean(), filesRestored: z.number(), newCommitId: z.string() }) } } } },
});

// -----------------------------
// Auth API
// -----------------------------

// POST /api/auth/login
registry.registerPath({
  method: 'post',
  path: '/api/auth/login',
  request: { body: { content: { 'application/json': { schema: z.object({ email: z.string().email(), password: z.string() }) } } } },
  responses: { 200: { description: 'Login successful', content: { 'application/json': { schema: z.object({ user: z.unknown(), token: z.string().optional() }) } } }, 401: { description: 'Invalid credentials' } },
});

// POST /api/auth/logout
registry.registerPath({
  method: 'post',
  path: '/api/auth/logout',
  responses: { 200: { description: 'Logged out' } },
});

// POST /api/auth/refresh
registry.registerPath({
  method: 'post',
  path: '/api/auth/refresh',
  responses: { 200: { description: 'Token refreshed', content: { 'application/json': { schema: z.object({ user: z.unknown() }) } } }, 401: { description: 'Not authenticated' } },
});

// GET /api/auth/me
registry.registerPath({
  method: 'get',
  path: '/api/auth/me',
  responses: { 200: { description: 'Current user profile', content: { 'application/json': { schema: z.unknown() } } }, 401: { description: 'Not authenticated' } },
});

// PATCH /api/auth/me
registry.registerPath({
  method: 'patch',
  path: '/api/auth/me',
  request: { body: { content: { 'application/json': { schema: z.object({ firstName: z.string().optional(), lastName: z.string().optional() }) } } } },
  responses: { 200: { description: 'Profile updated', content: { 'application/json': { schema: z.unknown() } } } },
});

// POST /api/auth/change-password
registry.registerPath({
  method: 'post',
  path: '/api/auth/change-password',
  request: { body: { content: { 'application/json': { schema: z.object({ currentPassword: z.string(), newPassword: z.string() }) } } } },
  responses: { 200: { description: 'Password changed' }, 400: { description: 'Invalid current password' } },
});

// POST /api/auth/forgot-password
registry.registerPath({
  method: 'post',
  path: '/api/auth/forgot-password',
  request: { body: { content: { 'application/json': { schema: z.object({ email: z.string().email() }) } } } },
  responses: { 200: { description: 'Reset email sent (always returns 200)' } },
});

// POST /api/auth/reset-password
registry.registerPath({
  method: 'post',
  path: '/api/auth/reset-password',
  request: { body: { content: { 'application/json': { schema: z.object({ token: z.string(), password: z.string() }) } } } },
  responses: { 200: { description: 'Password reset' }, 400: { description: 'Invalid or expired token' } },
});

// POST /api/auth/reset-password-with-token
registry.registerPath({
  method: 'post',
  path: '/api/auth/reset-password-with-token',
  request: { body: { content: { 'application/json': { schema: z.object({ token: z.string(), password: z.string() }) } } } },
  responses: { 200: { description: 'Password reset with token' }, 400: { description: 'Invalid token' } },
});

// GET /api/auth/verify-reset-token
registry.registerPath({
  method: 'get',
  path: '/api/auth/verify-reset-token',
  request: { query: z.object({ token: z.string() }) },
  responses: { 200: { description: 'Token valid' }, 400: { description: 'Invalid or expired token' } },
});

// POST /api/auth/resend-verification
registry.registerPath({
  method: 'post',
  path: '/api/auth/resend-verification',
  request: { body: { content: { 'application/json': { schema: z.object({ email: z.string().email() }) } } } },
  responses: { 200: { description: 'Verification email resent' } },
});

// POST /api/auth/verify-email
registry.registerPath({
  method: 'post',
  path: '/api/auth/verify-email',
  request: { body: { content: { 'application/json': { schema: z.object({ token: z.string() }) } } } },
  responses: { 200: { description: 'Email verified' }, 400: { description: 'Invalid token' } },
});

// GET /api/auth/branding
registry.registerPath({
  method: 'get',
  path: '/api/auth/branding',
  responses: { 200: { description: 'Platform branding config', content: { 'application/json': { schema: z.unknown() } } } },
});

// GET /api/auth/platform-settings (public)
registry.registerPath({
  method: 'get',
  path: '/api/auth/platform-settings',
  responses: { 200: { description: 'Public platform settings', content: { 'application/json': { schema: z.unknown() } } } },
});

// SSO - Google
registry.registerPath({ method: 'get', path: '/api/auth/google/start', responses: { 302: { description: 'Redirect to Google OAuth' } } });
registry.registerPath({ method: 'get', path: '/api/auth/google', responses: { 302: { description: 'Redirect to Google OAuth' } } });
registry.registerPath({ method: 'get', path: '/api/auth/google/callback', responses: { 302: { description: 'Google OAuth callback redirect' } } });
registry.registerPath({ method: 'get', path: '/api/auth/google/status', responses: { 200: { description: 'Google SSO config status', content: { 'application/json': { schema: z.object({ enabled: z.boolean() }) } } } } });

// SSO - Microsoft
registry.registerPath({ method: 'get', path: '/api/auth/microsoft/start', responses: { 302: { description: 'Redirect to Microsoft OAuth' } } });
registry.registerPath({ method: 'get', path: '/api/auth/microsoft', responses: { 302: { description: 'Redirect to Microsoft OAuth' } } });
registry.registerPath({ method: 'get', path: '/api/auth/microsoft/callback', responses: { 302: { description: 'Microsoft OAuth callback redirect' } } });
registry.registerPath({ method: 'get', path: '/api/auth/microsoft/status', responses: { 200: { description: 'Microsoft SSO config status', content: { 'application/json': { schema: z.object({ enabled: z.boolean() }) } } } } });

// SSO - SAML
registry.registerPath({ method: 'get', path: '/api/auth/saml/start', responses: { 302: { description: 'Redirect to SAML IdP' } } });
registry.registerPath({ method: 'get', path: '/api/auth/saml', responses: { 302: { description: 'Redirect to SAML IdP' } } });
registry.registerPath({ method: 'post', path: '/api/auth/saml/callback', responses: { 302: { description: 'SAML assertion callback redirect' } } });
registry.registerPath({ method: 'get', path: '/api/auth/saml/metadata', responses: { 200: { description: 'SAML SP metadata XML', content: { 'application/xml': { schema: z.string() } } } } });
registry.registerPath({ method: 'get', path: '/api/auth/saml/status', responses: { 200: { description: 'SAML config status', content: { 'application/json': { schema: z.object({ enabled: z.boolean() }) } } } } });

// Tenant SSO config
registry.registerPath({
  method: 'get',
  path: '/api/t/{tenantSlug}/auth/sso-config',
  request: { params: z.object({ tenantSlug: z.string() }) },
  responses: { 200: { description: 'SSO config for tenant', content: { 'application/json': { schema: z.unknown() } } } },
});

// -----------------------------
// Admin API - Setup & Email
// -----------------------------

// GET /api/admin/setup-status
registry.registerPath({
  method: 'get',
  path: '/api/admin/setup-status',
  responses: { 200: { description: 'Platform setup status', content: { 'application/json': { schema: z.object({ setupComplete: z.boolean() }) } } } },
});

// POST /api/admin/mark-setup-complete
registry.registerPath({
  method: 'post',
  path: '/api/admin/mark-setup-complete',
  responses: { 200: { description: 'Setup marked complete' } },
});

// Email configs
registry.registerPath({
  method: 'get',
  path: '/api/admin/email-configs',
  responses: { 200: { description: 'List email configs', content: { 'application/json': { schema: z.array(z.unknown()) } } } },
});
registry.registerPath({
  method: 'post',
  path: '/api/admin/email-configs',
  request: { body: { content: { 'application/json': { schema: z.unknown() } } } },
  responses: { 201: { description: 'Created', content: { 'application/json': { schema: z.unknown() } } } },
});
registry.registerPath({
  method: 'patch',
  path: '/api/admin/email-configs/{id}',
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: z.unknown() } } } },
  responses: { 200: { description: 'Updated', content: { 'application/json': { schema: z.unknown() } } } },
});
registry.registerPath({
  method: 'delete',
  path: '/api/admin/email-configs/{id}',
  request: { params: z.object({ id: z.string() }) },
  responses: { 204: { description: 'Deleted' } },
});
registry.registerPath({
  method: 'post',
  path: '/api/admin/email-configs/{id}/set-default',
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: 'Set as default' } },
});
registry.registerPath({
  method: 'post',
  path: '/api/admin/email-configs/{id}/test',
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: z.object({ to: z.string().email() }) } } } },
  responses: { 200: { description: 'Test email sent' } },
});

// Email platform name
registry.registerPath({
  method: 'put',
  path: '/api/admin/email-platform-name',
  request: { body: { content: { 'application/json': { schema: z.object({ name: z.string() }) } } } },
  responses: { 200: { description: 'Platform name updated' } },
});

// Email templates
registry.registerPath({
  method: 'get',
  path: '/api/admin/email-templates',
  responses: { 200: { description: 'List email templates', content: { 'application/json': { schema: z.array(z.unknown()) } } } },
});
registry.registerPath({
  method: 'patch',
  path: '/api/admin/email-templates/{id}',
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: z.unknown() } } } },
  responses: { 200: { description: 'Template updated', content: { 'application/json': { schema: z.unknown() } } } },
});
registry.registerPath({
  method: 'post',
  path: '/api/admin/email-templates/{id}/preview',
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: 'Template preview HTML', content: { 'application/json': { schema: z.object({ html: z.string() }) } } } },
});
registry.registerPath({
  method: 'post',
  path: '/api/admin/email-templates/{id}/reset',
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: 'Template reset to default' } },
});

// -----------------------------
// Authorization (Authz) API
// -----------------------------

// POST /api/authz/check
registry.registerPath({
  method: 'post',
  path: '/api/authz/check',
  request: { body: { content: { 'application/json': { schema: z.object({ resource: z.string(), action: z.string(), resourceId: z.string().optional() }) } } } },
  responses: { 200: { description: 'Authorization check result', content: { 'application/json': { schema: z.object({ allowed: z.boolean() }) } } } },
});

// POST /api/authz/check-batch
registry.registerPath({
  method: 'post',
  path: '/api/authz/check-batch',
  request: { body: { content: { 'application/json': { schema: z.object({ checks: z.array(z.object({ resource: z.string(), action: z.string(), resourceId: z.string().optional() })) }) } } } },
  responses: { 200: { description: 'Batch authorization results', content: { 'application/json': { schema: z.object({ results: z.array(z.object({ allowed: z.boolean() })) }) } } } },
});

// Authz policies
registry.registerPath({ method: 'get', path: '/api/authz/policies', responses: { 200: { description: 'List policies', content: { 'application/json': { schema: z.array(z.unknown()) } } } } });
registry.registerPath({ method: 'post', path: '/api/authz/policies', request: { body: { content: { 'application/json': { schema: z.unknown() } } } }, responses: { 201: { description: 'Policy created', content: { 'application/json': { schema: z.unknown() } } } } });
registry.registerPath({ method: 'put', path: '/api/authz/policies/{id}', request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: z.unknown() } } } }, responses: { 200: { description: 'Policy updated', content: { 'application/json': { schema: z.unknown() } } } } });
registry.registerPath({ method: 'delete', path: '/api/authz/policies/{id}', request: { params: z.object({ id: z.string() }) }, responses: { 204: { description: 'Policy deleted' } } });

// Authz audit
registry.registerPath({ method: 'get', path: '/api/authz/audit', responses: { 200: { description: 'Authorization audit log', content: { 'application/json': { schema: z.array(z.unknown()) } } } } });

// SSO mappings
registry.registerPath({ method: 'get', path: '/api/authz/sso-mappings', responses: { 200: { description: 'List SSO role mappings', content: { 'application/json': { schema: z.array(z.unknown()) } } } } });
registry.registerPath({ method: 'post', path: '/api/authz/sso-mappings', request: { body: { content: { 'application/json': { schema: z.unknown() } } } }, responses: { 201: { description: 'Mapping created', content: { 'application/json': { schema: z.unknown() } } } } });
registry.registerPath({ method: 'put', path: '/api/authz/sso-mappings/{id}', request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: z.unknown() } } } }, responses: { 200: { description: 'Mapping updated', content: { 'application/json': { schema: z.unknown() } } } } });
registry.registerPath({ method: 'delete', path: '/api/authz/sso-mappings/{id}', request: { params: z.object({ id: z.string() }) }, responses: { 204: { description: 'Mapping deleted' } } });
registry.registerPath({ method: 'post', path: '/api/authz/sso-mappings/test', request: { body: { content: { 'application/json': { schema: z.unknown() } } } }, responses: { 200: { description: 'Test SSO mapping result', content: { 'application/json': { schema: z.unknown() } } } } });

// -----------------------------
// Audit API
// -----------------------------
registry.registerPath({ method: 'get', path: '/api/audit/logs', request: { query: z.object({ limit: z.string().optional(), offset: z.string().optional() }).passthrough() }, responses: { 200: { description: 'Audit logs', content: { 'application/json': { schema: z.array(z.unknown()) } } } } });
registry.registerPath({ method: 'get', path: '/api/audit/logs/resource/{resourceType}/{resourceId}', request: { params: z.object({ resourceType: z.string(), resourceId: z.string() }) }, responses: { 200: { description: 'Audit logs by resource', content: { 'application/json': { schema: z.array(z.unknown()) } } } } });
registry.registerPath({ method: 'get', path: '/api/audit/logs/user/{userId}', request: { params: z.object({ userId: z.string() }) }, responses: { 200: { description: 'Audit logs by user', content: { 'application/json': { schema: z.array(z.unknown()) } } } } });
registry.registerPath({ method: 'get', path: '/api/audit/actions', responses: { 200: { description: 'Available audit actions', content: { 'application/json': { schema: z.array(z.string()) } } } } });
registry.registerPath({ method: 'get', path: '/api/audit/stats', responses: { 200: { description: 'Audit statistics', content: { 'application/json': { schema: z.unknown() } } } } });

// -----------------------------
// Dashboard API
// -----------------------------
registry.registerPath({ method: 'get', path: '/api/dashboard/context', responses: { 200: { description: 'Dashboard context data', content: { 'application/json': { schema: z.unknown() } } } } });
registry.registerPath({ method: 'get', path: '/api/dashboard/stats', responses: { 200: { description: 'Dashboard statistics', content: { 'application/json': { schema: z.unknown() } } } } });

// -----------------------------
// Notifications API
// -----------------------------
registry.registerPath({ method: 'get', path: '/api/notifications', responses: { 200: { description: 'List notifications', content: { 'application/json': { schema: z.array(z.unknown()) } } } } });
registry.registerPath({ method: 'post', path: '/api/notifications', request: { body: { content: { 'application/json': { schema: z.unknown() } } } }, responses: { 201: { description: 'Notification created' } } });
registry.registerPath({ method: 'patch', path: '/api/notifications/read', request: { body: { content: { 'application/json': { schema: z.object({ ids: z.array(z.string()).optional() }) } } } }, responses: { 200: { description: 'Notifications marked as read' } } });
registry.registerPath({ method: 'delete', path: '/api/notifications/{id}', request: { params: z.object({ id: z.string() }) }, responses: { 204: { description: 'Notification deleted' } } });

// -----------------------------
// Users API
// -----------------------------
registry.registerPath({ method: 'get', path: '/api/users', request: { query: z.object({ limit: z.string().optional(), offset: z.string().optional() }) }, responses: { 200: { description: 'List users', content: { 'application/json': { schema: z.array(z.unknown()) } } } } });
registry.registerPath({ method: 'post', path: '/api/users', request: { body: { content: { 'application/json': { schema: z.object({ email: z.string().email(), firstName: z.string().optional(), lastName: z.string().optional(), password: z.string().optional(), role: z.string().optional() }) } } } }, responses: { 201: { description: 'User created', content: { 'application/json': { schema: z.unknown() } } } } });
registry.registerPath({ method: 'get', path: '/api/users/{id}', request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'User details', content: { 'application/json': { schema: z.unknown() } } }, 404: { description: 'Not found' } } });
registry.registerPath({ method: 'put', path: '/api/users/{id}', request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: z.unknown() } } } }, responses: { 200: { description: 'User updated', content: { 'application/json': { schema: z.unknown() } } } } });
registry.registerPath({ method: 'post', path: '/api/users/{id}/unlock', request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'User unlocked' } } });

// -----------------------------
// Git API - Extended
// -----------------------------

// Admin providers
registry.registerPath({ method: 'get', path: '/git-api/admin/providers', responses: { 200: { description: 'List admin git providers', content: { 'application/json': { schema: z.array(z.unknown()) } } } } });
registry.registerPath({ method: 'put', path: '/git-api/admin/providers/{id}', request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: z.unknown() } } } }, responses: { 200: { description: 'Provider updated', content: { 'application/json': { schema: z.unknown() } } } } });

// Providers
registry.registerPath({ method: 'get', path: '/git-api/providers', responses: { 200: { description: 'List git providers', content: { 'application/json': { schema: z.array(z.unknown()) } } } } });
registry.registerPath({ method: 'get', path: '/git-api/providers/{id}', request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'Provider details', content: { 'application/json': { schema: z.unknown() } } } } });
registry.registerPath({ method: 'get', path: '/git-api/providers/{id}/repos', request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'List repos for provider', content: { 'application/json': { schema: z.array(z.unknown()) } } } } });

// Credentials
registry.registerPath({ method: 'get', path: '/git-api/credentials', responses: { 200: { description: 'List git credentials', content: { 'application/json': { schema: z.array(z.unknown()) } } } } });
registry.registerPath({ method: 'post', path: '/git-api/credentials', request: { body: { content: { 'application/json': { schema: z.unknown() } } } }, responses: { 201: { description: 'Credential created', content: { 'application/json': { schema: z.unknown() } } } } });
registry.registerPath({ method: 'patch', path: '/git-api/credentials/{credentialId}', request: { params: z.object({ credentialId: z.string() }), body: { content: { 'application/json': { schema: z.unknown() } } } }, responses: { 200: { description: 'Credential updated', content: { 'application/json': { schema: z.unknown() } } } } });
registry.registerPath({ method: 'delete', path: '/git-api/credentials/{credentialId}', request: { params: z.object({ credentialId: z.string() }) }, responses: { 204: { description: 'Credential deleted' } } });
registry.registerPath({ method: 'delete', path: '/git-api/credentials/{providerId}', request: { params: z.object({ providerId: z.string() }) }, responses: { 204: { description: 'Provider credentials deleted' } } });
registry.registerPath({ method: 'get', path: '/git-api/credentials/{credentialId}/namespaces', request: { params: z.object({ credentialId: z.string() }) }, responses: { 200: { description: 'Available namespaces', content: { 'application/json': { schema: z.array(z.unknown()) } } } } });
registry.registerPath({ method: 'post', path: '/git-api/credentials/{providerId}/validate', request: { params: z.object({ providerId: z.string() }), body: { content: { 'application/json': { schema: z.unknown() } } } }, responses: { 200: { description: 'Credential validation result', content: { 'application/json': { schema: z.object({ valid: z.boolean() }) } } } } });

// Clone & create
registry.registerPath({ method: 'post', path: '/git-api/clone', request: { body: { content: { 'application/json': { schema: z.unknown() } } } }, responses: { 201: { description: 'Repository cloned', content: { 'application/json': { schema: z.unknown() } } } } });
registry.registerPath({ method: 'post', path: '/git-api/create-online', request: { body: { content: { 'application/json': { schema: z.unknown() } } } }, responses: { 201: { description: 'Online repo created', content: { 'application/json': { schema: z.unknown() } } } } });
registry.registerPath({ method: 'post', path: '/git-api/check-repo-exists', request: { body: { content: { 'application/json': { schema: z.object({ url: z.string() }) } } } }, responses: { 200: { description: 'Check result', content: { 'application/json': { schema: z.object({ exists: z.boolean() }) } } } } });
registry.registerPath({ method: 'post', path: '/git-api/repo-info', request: { body: { content: { 'application/json': { schema: z.unknown() } } } }, responses: { 200: { description: 'Repository info', content: { 'application/json': { schema: z.unknown() } } } } });

// Git deployments
registry.registerPath({ method: 'get', path: '/git-api/deployments', request: { query: z.object({ projectId: z.string().optional() }).passthrough() }, responses: { 200: { description: 'List git deployments', content: { 'application/json': { schema: z.array(z.unknown()) } } } } });
registry.registerPath({ method: 'get', path: '/git-api/deployments/{id}', request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'Deployment details', content: { 'application/json': { schema: z.unknown() } } }, 404: { description: 'Not found' } } });
registry.registerPath({ method: 'get', path: '/git-api/projects/{projectId}/deployments', request: { params: z.object({ projectId: z.string() }) }, responses: { 200: { description: 'Deployments for project', content: { 'application/json': { schema: z.array(z.unknown()) } } } } });

// Git sync
registry.registerPath({ method: 'post', path: '/git-api/sync', request: { body: { content: { 'application/json': { schema: z.object({ projectId: z.string() }) } } } }, responses: { 200: { description: 'Sync started', content: { 'application/json': { schema: z.unknown() } } } } });
registry.registerPath({ method: 'get', path: '/git-api/sync/status', request: { query: z.object({ projectId: z.string() }) }, responses: { 200: { description: 'Sync status', content: { 'application/json': { schema: z.unknown() } } } } });

// Git lock heartbeat
registry.registerPath({ method: 'put', path: '/git-api/locks/{lockId}/heartbeat', request: { params: z.object({ lockId: z.string() }) }, responses: { 200: { description: 'Lock heartbeat renewed' } } });

// Git OAuth
registry.registerPath({ method: 'get', path: '/git-api/oauth/{providerId}/authorize', request: { params: z.object({ providerId: z.string() }) }, responses: { 302: { description: 'Redirect to OAuth provider' } } });
registry.registerPath({ method: 'get', path: '/git-api/oauth/{providerId}/authorize/redirect', request: { params: z.object({ providerId: z.string() }) }, responses: { 302: { description: 'OAuth redirect' } } });
registry.registerPath({ method: 'get', path: '/git-api/oauth/{providerId}/config', request: { params: z.object({ providerId: z.string() }) }, responses: { 200: { description: 'OAuth config', content: { 'application/json': { schema: z.unknown() } } } } });
registry.registerPath({ method: 'post', path: '/git-api/oauth/{providerId}/refresh', request: { params: z.object({ providerId: z.string() }) }, responses: { 200: { description: 'Token refreshed' } } });
registry.registerPath({ method: 'get', path: '/git-api/oauth/authorize/redirect', responses: { 302: { description: 'Generic OAuth redirect' } } });
registry.registerPath({ method: 'post', path: '/git-api/oauth/callback', responses: { 200: { description: 'OAuth callback processed' } } });

// Git project connection
registry.registerPath({ method: 'post', path: '/git-api/project-connection', request: { body: { content: { 'application/json': { schema: z.unknown() } } } }, responses: { 200: { description: 'Project connection established', content: { 'application/json': { schema: z.unknown() } } } } });
registry.registerPath({ method: 'put', path: '/git-api/project-connection/token', request: { body: { content: { 'application/json': { schema: z.unknown() } } } }, responses: { 200: { description: 'Connection token updated' } } });

export function generateOpenApi() {
  const generator = new OpenApiGeneratorV3(registry.definitions);
  return generator.generateDocument({
    openapi: '3.0.3',
    info: { title: 'Voyager API', version: '0.1.0' },
  });
}
