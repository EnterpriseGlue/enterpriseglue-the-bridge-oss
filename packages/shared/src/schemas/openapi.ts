import { z } from 'zod';
import { extendZodWithOpenApi, OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';

// Extend zod BEFORE loading schema modules — zod 4 requires this to run
// before any schema is created so that .openapi() is available on instances.
extendZodWithOpenApi(z);

// Dynamic imports ensure schema modules evaluate AFTER extendZodWithOpenApi.
const {
  ProjectSchema,
  ProjectOverviewListSchema,
  ProjectImportPreviewRequestSchema,
  ProjectImportPreviewResponseSchema,
  CreateProjectRequest,
  CreateProjectResponseSchema,
  RenameProjectRequest,
  FileSchema,
  FileSchemaRaw,
  CreateFileRequest,
  CreateFileResponseSchema,
  UpdateFileXmlRequest,
  UpdateFileMetadataRequest,
  UpdateFileMetadataResponseSchema,
  RestoreFileFromCommitRequestSchema,
  RestoreFileFromCommitResponseSchema,
  VersionSchema,
  CompareVersionsResponse,
  CommentSchema,
  FolderSchema,
  FolderSchemaRaw,
  FolderSummarySchema,
  CreateFolderRequest,
  CreateFolderResponseSchema,
  UpdateFolderRequest,
  UpdateFolderResponseSchema,
  ProjectContentsSchema,
  FolderDeletePreviewSchema,
  FileDeploymentSummarySchema,
  LatestProjectDeploymentArtifactSchema,
  ProjectEngineDeploymentViewSchema,
  ProjectEngineAccessResponseSchema,
} = await import('@enterpriseglue/shared/schemas/starbase/index.js');

const {
  DashboardContextSchema,
  DashboardStatsSchema,
} = await import('@enterpriseglue/shared/schemas/dashboard.js');

const {
  AuthenticatedSessionLoginResponseSchema,
  AuthenticatedSessionOnboardingResponseSchema,
  AuthenticatedSessionUserSchema,
  RefreshAccessTokenResponseSchema,
  LogoutResponseSchema,
} = await import('@enterpriseglue/shared/schemas/auth/session.js');

const {
  NativeTenantSchema,
  TenantCreateRequestSchema,
  TenantUpdateRequestSchema,
  NativeTenantMembershipSchema,
  TenantMemberSchema,
  TenantMemberUpsertRequestSchema,
  TenantLoginPolicySchema,
  TenantDiscoveryDomainSchema,
  TenantDiscoveryDomainCreateRequestSchema,
  TenantDiscoveryDomainVerifyRequestSchema,
  TenantDiscoveryRequestSchema,
  TenantDiscoveryResponseSchema,
  TenantDiscoveryExchangeRequestSchema,
  TenantDiscoveryExchangeResponseSchema,
  TenantDomainSchema,
  TenantDomainCreateRequestSchema,
  TenantDomainVerifyRequestSchema,
  TenantSlugSchema,
  TenancyCapabilitiesSchema,
  TenantWorkloadCreateRequestSchema,
  TenantWorkloadEpochRequestSchema,
  TenantWorkloadSecretBreakGlassRequestSchema,
  TenantWorkloadAliasReconcileRequestSchema,
  SignedTenantWorkloadReceiptSchema,
} = await import('@enterpriseglue/shared/schemas/platform-admin/tenant.js');

const {
  EngineSchema,
  EngineSchemaRaw,
  AccessibleEngineSummarySchema,
  EngineInventoryQuerySchema,
  EngineConnectionHealthResponseSchema,
  EngineConnectionModeSchema,
  EngineTransportDiagnosticsSchema,
  EngineTenancyModeSchema,
  EngineTenantMappingStrategySchema,
  EngineTenantReferenceSchema,
  EngineTenantMappingSchema,
  EngineTenancyConfigurationSchema,
  EngineTenancyDiagnosticsSchema,
  EngineTenancyTopologyStateSchema,
  EngineTenancyTransitionAcknowledgementSchema,
  EngineTenancyTransitionEffectsSchema,
  EngineTenancyTransitionPreviewRequestSchema,
  EngineTenancyTransitionPreviewResponseSchema,
  EngineTenancyTransitionApplyRequestSchema,
  EngineTenancyTransitionApplyResponseSchema,
  EngineTenancyClassificationReportSchema,
  EngineTenancyErrorCodeSchema,
  EngineTenancyErrorResponseSchema,
  ExternalEngineTenantMappingsUpsertRequestSchema,
  ExternalEngineTenantMappingsUpsertResponseSchema,
  EndpointAuthenticationPolicyErrorSchema,
  CreateEngineRequestSchema,
  UpdateEngineRequestSchema,
  ExternalEngineRegistrationRequestSchema,
  ExternalEngineDecommissionRequestSchema,
  SavedFilterSchema,
  SavedFilterCreateRequestSchema,
  SavedFilterUpdateRequestSchema,
  BatchSchema,
  BatchDeleteOperationRequestSchema,
  BatchDetailSchema,
  BatchOperationCreateResponseSchema,
  BatchProcessInstanceSuspensionRequestSchema,
  BatchRetryOperationRequestSchema,
  BatchSuspensionUpdateRequestSchema,
  ProcessDefinitionSchema: MissionControlProcessDefinitionSchema,
  ProcessDefXmlSchema: MissionControlProcessDefXmlSchema,
  ProcessInstanceStartResponseSchema,
  ProcessEditTargetSchema,
  DecisionEditTargetSchema,
  ProcessInstanceSchema: MissionControlProcessInstanceSchema,
  ProcessInstanceVariablesModifyRequestSchema,
  ProcessInstanceCollectionQueryParamsSchema,
  ProcessInstanceRetryRequestSchema,
  ProcessInstanceDetailSchema: MissionControlProcessInstanceDetailSchema,
  ProcessInstanceIncidentListSchema,
  ProcessInstanceJobListSchema,
  ProcessInstanceExternalTaskListSchema,
  ActivityCountByActivityIdSchema,
  ActivityCountsByStateSchema,
  MigrationActiveSourcesRequestSchema,
  MigrationActiveSourcesResponseSchema,
  MigrationAsyncExecuteResponseSchema,
  MigrationDirectExecuteResponseSchema,
  MigrationExecuteRequestSchema,
  MigrationGenerateRequestSchema,
  MigrationInstructionSchema,
  MigrationPlanSchema,
  MigrationPlanValidationRequestSchema,
  MigrationPreviewRequestSchema,
  MigrationValidationResultSchema,
  MigrationPreviewResponseSchema,
  PreviewCountResponseSchema,
  DirectProcessInstanceDeleteRequestSchema,
  DirectProcessInstanceSuspensionRequestSchema,
  DirectJobRetriesRequestSchema,
  DirectOperationResultSchema,
  VariablesSchema: MissionControlVariablesSchema,
  ActivityInstanceSchema: MissionControlActivityInstanceSchema,
  ActivityInstanceListSchema: MissionControlActivityInstanceListSchema,
  PreviewCountRequest,
  DeploymentSchema,
  DeploymentQueryParams,
  EngineDeploymentRequestSchema,
  EngineDeploymentResponseSchema,
  TaskSchema,
  TaskFormSchema,
  TaskCompleteResponseSchema,
  TaskCountResponseSchema,
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
  MessageCorrelationResultsSchema,
  SignalEventSchema,
  DecisionDefinitionSchema,
  DecisionDefinitionListSchema,
  DecisionDefinitionXmlSchema,
  DecisionDefinitionQueryParams,
  DecisionEvaluationResultSchema,
  EvaluateDecisionRequest,
  JobSchema,
  JobDefinitionSchema,
  ExecuteJobRequest,
  JobQueryParams,
  JobDefinitionQueryParams,
  SetJobRetriesRequest,
  SetJobSuspensionStateRequest,
  SetJobDefinitionRetriesRequest,
  SetJobDefinitionSuspensionStateRequest,
  HistoricTaskInstanceSchema,
  HistoricTaskInstanceListSchema,
  HistoricVariableInstanceSchema,
  HistoricVariableInstanceListSchema,
  VariableHistoryEntrySchema,
  HistoricDecisionInstanceSchema,
  HistoricDecisionInstanceListSchema,
  HistoricDecisionIoListSchema,
  UserOperationLogEntrySchema,
  UserOperationLogEntryListSchema,
  ProcessInstanceExecutionDetailsSchema,
  HistoricTaskQueryParams,
  VariableHistoryQueryParams,
  HistoricVariableQueryParams,
  HistoricDecisionQueryParams,
  UserOperationLogQueryParams,
  MetricSchema,
  MetricsResultSchema,
  MetricsQueryParams,
  ModificationInstructionSchema,
  ProcessInstanceModificationRequest,
  ProcessDefinitionModificationAsyncRequest,
  ProcessDefinitionRestartAsyncRequest,
  ProcessDefinitionModificationAsyncResponseSchema,
  ProcessDefinitionRestartAsyncResponseSchema,
} = await import('./mission-control/index.js');

const {
  RepositorySelectSchema,
  InitRepositoryRequestSchema,
  CloneRepositoryRequestSchema,
  CloneFromGitRequestSchema,
  CloneFromGitResponseSchema,
  GitProviderRepositorySchema,
  GitProviderSummarySchema,
  GitProviderDetailSchema,
  GitOAuthConfigSchema,
  GitOAuthAuthorizeResponseSchema,
  GitOAuthCallbackRequestSchema,
  GitCredentialIdParamsSchema,
  GitCredentialOperationReceiptSchema,
  GitCredentialValidationResponseSchema,
  GitProviderIdParamsSchema,
  GitCredentialSchema, SaveGitCredentialRequestSchema, RenameGitCredentialRequestSchema, GitCredentialNamespaceSchema,
  DeployRequestSchema,
  RollbackRequestSchema,
  DeploymentSelectSchema,
  DeploymentResponseSchema,
  AcquireLockRequestSchema,
  LockResponseSchema,
  LockListResponseSchema,
  LockHeartbeatResponseSchema,
  CreateOnlineProjectRequestSchema,
  CreateOnlineProjectResponseSchema,
  CheckRepositoryExistsRequestSchema,
  CheckRepositoryExistsResponseSchema,
  RepositoryInfoRequestSchema,
  RepositoryInfoResponseSchema,
  GitSyncStatusQuerySchema,
  GitSyncStatusResponseSchema,
  GitSyncRequestSchema,
  GitSyncResponseSchema,
  ProjectGitConnectionQuerySchema,
  ProjectGitConnectionRequestSchema,
  UpdateProjectGitConnectionTokenRequestSchema,
  DisconnectProjectGitConnectionRequestSchema,
  ProjectGitConnectionSchema,
  ProjectGitConnectionReceiptSchema,
  ProjectGitConnectionOperationReceiptSchema,
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
const {
  pluginDeploymentExecutionObservationV1Schema,
  pluginDiagnosticMetricsV1Schema,
  pluginDisableRequestV1Schema,
  pluginEnableRequestV1Schema,
  pluginEventDeadLetterListV1Schema,
  pluginEventDeadLetterRequeueRequestV1Schema,
  pluginEventDeadLetterRequeueResultV1Schema,
  pluginEventMetricsV1Schema,
  pluginLifecycleOperationV1Schema,
  pluginPlatformAuditListV1Schema,
  pluginPlatformEmergencyRequestV1Schema,
  pluginPlatformEmergencyStateV1Schema,
  pluginSafeListV1Schema,
  pluginSafeSummaryV1Schema,
  pluginTenantApplicationAuditListV1Schema,
  pluginTenantApplicationDecisionRequestV1Schema,
  pluginTenantApplicationListV1Schema,
  pluginTenantApplicationMutationRequestV1Schema,
  pluginTenantApplicationV1Schema,
  pluginTenantEligibilityApplyRequestV1Schema,
  pluginTenantEligibilityProjectionV1Schema,
  pluginTenantEnablementRequestV1Schema,
  pluginTenantEnablementV1Schema,
} = await import('@enterpriseglue/plugin-sdk/control');
const {
  pluginPlatformCapabilityCatalogV1Schema,
} = await import('@enterpriseglue/plugin-sdk/platform');
const {
  pluginCatalogV2Schema,
  pluginInstallApprovalV1Schema,
  pluginInstallReviewV1Schema,
  pluginInstallationIntentV1Schema,
  pluginInstallationObservationV1Schema,
  pluginManagerCapabilityV1Schema,
} = await import('@enterpriseglue/plugin-sdk/manager');

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

const PluginControlErrorResponseSchema = z.object({
  code: z.enum([
    'plugin_not_found',
    'operation_not_found',
    'revision_conflict',
    'idempotency_conflict',
    'invalid_state',
    'tenant_enablement_not_supported',
    'activation_request_not_pending',
    'activation_request_not_required',
    'activation_approval_required',
    'request_invalid',
    'access_denied',
    'installation_not_found',
    'review_not_found',
    'review_not_approvable',
    'approval_conflict',
    'lease_invalid',
  ]),
});
const PluginIdPathSchema = z.object({
  pluginId: z.string().min(3).max(200),
});
const PluginOperationPathSchema = z.object({
  operationId: z.string().min(1).max(200),
});
const PluginDeadLetterPathSchema = PluginIdPathSchema.extend({
  deliveryId: z.string().min(1).max(200),
});
const PluginTenantEnablementPathSchema = PluginIdPathSchema.extend({
  tenantSlug: z.string().min(1).max(100),
});
const PluginDeadLetterQuerySchema = z.object({
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
const PluginInstallationPathSchema = z.object({
  installationId: z.string().min(1).max(200),
});
const PluginInstallationQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
const PluginInstallationCreateSchema = z
  .object({
    pluginId: pluginInstallationIntentV1Schema.shape.pluginId,
    release: pluginInstallationIntentV1Schema.shape.release,
    operation: pluginInstallationIntentV1Schema.shape.operation,
    fromVersion: pluginInstallationIntentV1Schema.shape.fromVersion,
    currentEnabled: pluginInstallationIntentV1Schema.shape.currentEnabled,
    source: pluginInstallationIntentV1Schema.shape.source,
    deploymentMode: pluginInstallationIntentV1Schema.shape.deploymentMode,
    expectedPlatformRevision:
      pluginInstallationIntentV1Schema.shape.expectedPlatformRevision,
    idempotencyKey: pluginInstallationIntentV1Schema.shape.idempotencyKey,
  })
  .strict()
  .superRefine((intent, context) => {
    if (
      (intent.operation === 'upgrade' &&
        (intent.fromVersion === undefined ||
          intent.currentEnabled === undefined)) ||
      (intent.operation === 'install' &&
        (intent.fromVersion !== undefined ||
          intent.currentEnabled !== undefined))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['fromVersion'],
        message: 'Upgrade requests require fromVersion and currentEnabled',
      });
    }
  });
const PluginInstallationApprovalRequestSchema = z.object({
  decision: pluginInstallApprovalV1Schema.shape.decision,
  reviewSha256: pluginInstallApprovalV1Schema.shape.reviewSha256,
  planSha256: pluginInstallApprovalV1Schema.shape.planSha256,
  expectedRevision: pluginInstallApprovalV1Schema.shape.expectedRevision,
}).strict();
const PluginInstallationSummarySchema = z.object({
  intent: pluginInstallationIntentV1Schema,
  state: z.string(),
  reasonCode: z.string(),
  revision: z.number().int().nonnegative(),
  review: pluginInstallReviewV1Schema.nullable(),
  approval: pluginInstallApprovalV1Schema.nullable(),
  latestObservation: pluginInstallationObservationV1Schema.nullable(),
  updatedAt: z.string().datetime(),
});
const PluginInstallationPageSchema = z.object({
  items: z.array(PluginInstallationSummarySchema),
  total: z.number().int().nonnegative(),
});
const PluginManagerStatusSchema = z.object({
  apiVersion: z.literal('manager-status.plugin.enterpriseglue.io/v1'),
  available: z.boolean(),
  capability: pluginManagerCapabilityV1Schema.nullable(),
});
const PluginCatalogProjectionSchema = z.object({
  apiVersion: z.literal('catalog-projection.plugin.enterpriseglue.io/v1'),
  catalog: pluginCatalogV2Schema.nullable(),
});
const PluginInstallationApprovalResponseSchema = z.object({
  approval: pluginInstallApprovalV1Schema,
  revision: z.number().int().nonnegative(),
});
const PluginInstallationRecoveryRequestSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
}).strict();
const PluginInstallationRevisionResponseSchema = z.object({
  revision: z.number().int().nonnegative(),
});

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
  responses: { 200: { description: 'Sanitized Prometheus configuration-bootstrap, aggregate engine-tenancy, and bounded login-experience metrics', content: { 'text/plain': { schema: z.string() } } } },
});

registry.register('Project', ProjectSchema);
registry.register('ProjectOverviewList', ProjectOverviewListSchema);
registry.registerPath({
  method: 'get',
  path: '/starbase-api/projects',
  ...authzExtension('project.projects.read', 'GET', '/starbase-api/projects'),
  responses: {
    200: {
      description: 'List projects',
      content: { 'application/json': { schema: ProjectOverviewListSchema } },
    },
  },
});

// POST /projects (create project)
registry.register('CreateProjectRequest', CreateProjectRequest);
registry.register('CreateProjectResponse', CreateProjectResponseSchema);
registry.registerPath({
  method: 'post',
  path: '/starbase-api/projects',
  ...authzExtension('project.projects.create', 'POST', '/starbase-api/projects'),
  request: {
    body: { content: { 'application/json': { schema: CreateProjectRequest } } },
  },
  responses: {
    200: {
      description: 'Project created',
      content: { 'application/json': { schema: CreateProjectResponseSchema } },
    },
  },
});

registry.register('ProjectImportPreviewRequest', ProjectImportPreviewRequestSchema);
registry.register('ProjectImportPreviewResponse', ProjectImportPreviewResponseSchema);
registry.registerPath({
  method: 'post',
  path: '/starbase-api/projects/import-preview',
  ...authzExtension('project.import.preview', 'POST', '/starbase-api/projects/import-preview'),
  request: {
    body: { content: { 'application/json': { schema: ProjectImportPreviewRequestSchema } } },
  },
  responses: {
    200: {
      description: 'Preview latest BPMN/DMN definitions available for project import from an engine',
      content: { 'application/json': { schema: ProjectImportPreviewResponseSchema } },
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
      content: { 'application/json': { schema: CreateFileResponseSchema } },
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
registry.register('UpdateFileMetadataRequest', UpdateFileMetadataRequest);
registry.registerPath({
  method: 'patch',
  path: '/starbase-api/files/{fileId}',
  ...authzExtension('project.files.update', 'PATCH', '/starbase-api/files/{fileId}'),
  request: {
    params: z.object({ fileId: z.string() }),
    body: { content: { 'application/json': { schema: UpdateFileMetadataRequest } } },
  },
  responses: {
    200: {
      description: 'File metadata updated',
      content: { 'application/json': { schema: UpdateFileMetadataResponseSchema } },
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
registry.register('MissionControlProcessInstanceIncidentList', ProcessInstanceIncidentListSchema);
registry.register('MissionControlProcessInstanceJobList', ProcessInstanceJobListSchema);
registry.register('MissionControlProcessInstanceExternalTaskList', ProcessInstanceExternalTaskListSchema);

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
registry.register('ProcessEditTarget', ProcessEditTargetSchema);
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
    200: { description: 'Starbase file target for the deployed process version', content: { 'application/json': { schema: ProcessEditTargetSchema } } },
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
      content: { 'application/json': { schema: ActivityCountByActivityIdSchema } },
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
      content: { 'application/json': { schema: PreviewCountResponseSchema } },
    },
  },
});

// GET /mission-control-api/process-instances
registry.registerPath({
  method: 'get',
  path: '/mission-control-api/process-instances',
  ...authzExtension('engine.runtime.process-instances.read', 'GET', '/mission-control-api/process-instances'),
  request: {
    query: ProcessInstanceCollectionQueryParamsSchema,
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
    200: { description: 'Process instance details (runtime)', content: { 'application/json': { schema: MissionControlProcessInstanceDetailSchema } } },
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
    200: { description: 'Historic activity instances', content: { 'application/json': { schema: MissionControlActivityInstanceListSchema } } },
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
    200: { description: 'Lazy execution details for a process instance activity', content: { 'application/json': { schema: ProcessInstanceExecutionDetailsSchema } } },
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
    200: { description: 'Incidents for an instance', content: { 'application/json': { schema: ProcessInstanceIncidentListSchema } } },
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
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: ProcessInstanceRetryRequestSchema } } } },
  responses: { 204: { description: 'Retry requested' } },
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
      content: { 'application/json': { schema: z.array(MissionControlProcessInstanceDetailSchema) } },
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
      content: { 'application/json': { schema: MissionControlProcessInstanceDetailSchema } },
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
      content: { 'application/json': { schema: HistoricVariableInstanceListSchema } },
    },
  },
});

// -----------------------------
// Engines API: Engines & Saved Filters
// -----------------------------
registry.register('Engine', EngineSchema)
registry.register('EngineConnectionMode', EngineConnectionModeSchema)
registry.register('EngineTransportDiagnostics', EngineTransportDiagnosticsSchema)
registry.register('EngineTenancyMode', EngineTenancyModeSchema)
registry.register('EngineTenantMappingStrategy', EngineTenantMappingStrategySchema)
registry.register('EngineTenantReference', EngineTenantReferenceSchema)
registry.register('EngineTenantMapping', EngineTenantMappingSchema)
registry.register('EngineTenancyConfiguration', EngineTenancyConfigurationSchema)
registry.register('EngineTenancyDiagnostics', EngineTenancyDiagnosticsSchema)
registry.register('EngineTenancyTopologyState', EngineTenancyTopologyStateSchema)
registry.register('EngineTenancyTransitionAcknowledgement', EngineTenancyTransitionAcknowledgementSchema)
registry.register('EngineTenancyTransitionEffects', EngineTenancyTransitionEffectsSchema)
registry.register('EngineTenancyTransitionPreviewRequest', EngineTenancyTransitionPreviewRequestSchema)
registry.register('EngineTenancyTransitionPreviewResponse', EngineTenancyTransitionPreviewResponseSchema)
registry.register('EngineTenancyTransitionApplyRequest', EngineTenancyTransitionApplyRequestSchema)
registry.register('EngineTenancyTransitionApplyResponse', EngineTenancyTransitionApplyResponseSchema)
registry.register('EngineTenancyClassificationReport', EngineTenancyClassificationReportSchema)
registry.register('EngineTenancyErrorCode', EngineTenancyErrorCodeSchema)
registry.register('EngineTenancyErrorResponse', EngineTenancyErrorResponseSchema)
registry.register('ExternalEngineTenantMappingsUpsertRequest', ExternalEngineTenantMappingsUpsertRequestSchema)
registry.register('ExternalEngineTenantMappingsUpsertResponse', ExternalEngineTenantMappingsUpsertResponseSchema)
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
const {
  ProjectEngineTargetSchema: ExternalProjectEngineTargetSchema,
} = await import('./platform-admin/authz.js')
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

const customerSidecarRegistrationDescription = [
  'Register an engine directly or through a customer-owned sidecar.',
  'When `connectionMode` is `customer_sidecar`, `baseUrl` is the sidecar endpoint and the configured authentication applies only to the EnterpriseGlue-to-sidecar hop.',
  'The sidecar owns the downstream engine credential or peer token. Do not send that material to EnterpriseGlue. Credentialless sidecars require the platform policy to allow them.',
  'See the Customer Sidecar Backstop Adapter API for the bounded native-authorization contract.',
].join('\n\n')

const customerSidecarBackstopDescription = [
  'Mirrored engine backstop operation for a compatible Camunda 7 or Operaton engine.',
  'For `connectionMode = customer_sidecar`, EnterpriseGlue calls the registered customer-owned sidecar. The sidecar may perform only the bounded tracked native-authorization operation required by this lifecycle step and owns its downstream engine authentication.',
  'A sidecar rejection or downstream failure fails closed. EnterpriseGlue never falls back to a direct-engine endpoint.',
].join('\n\n')

const customerSidecarCreateExample = {
  name: 'Payments customer sidecar',
  baseUrl: 'https://payments-sidecar.example.invalid/engine-rest',
  type: 'operaton',
  connectionMode: 'customer_sidecar',
  authType: 'basic',
  username: 'enterpriseglue-sidecar',
  passwordEnc: 'ref:env://PAYMENTS_SIDECAR_UPSTREAM_PASSWORD',
  runtimeAccessScope: 'resource_aware',
  tenancy: { mode: 'dedicated', tenantRef: { type: 'request_context' } },
}

registry.registerPath({
  method: 'get',
  path: '/engines-api/engines',
  ...authzExtension('engine.inventory.read', 'GET', '/engines-api/engines'),
  request: { query: EngineInventoryQuerySchema },
  responses: {
    200: { description: 'Authorization-filtered engine inventory', content: { 'application/json': { schema: z.array(AccessibleEngineSummarySchema) } } },
  },
})

registry.registerPath({
  method: 'post',
  path: '/engines-api/engines',
  summary: 'Register an engine or customer sidecar',
  description: `${customerSidecarRegistrationDescription} This is the manual inventory channel and is disabled when engineOnboardingMode is external_only. It does not grant engine membership or change engineAccessAuthority.`,
  ...authzExtension('engine.inventory.create', 'POST', '/engines-api/engines'),
  request: {
    body: {
      description: 'Use customer_sidecar only when baseUrl addresses the customer-owned gateway, never the downstream engine.',
      content: { 'application/json': { schema: CreateEngineRequestSchema, example: customerSidecarCreateExample } },
    },
  },
  responses: {
    201: { description: 'Created', content: { 'application/json': { schema: EngineSchema } } },
    400: { description: 'Endpoint or tenancy policy rejected the engine registration', content: { 'application/json': { schema: z.union([EndpointAuthenticationPolicyErrorSchema, EngineTenancyErrorResponseSchema]) } } },
    403: { description: 'Manual engine onboarding is disabled or the tenant reference is not authorized', content: { 'application/json': { schema: EngineTenancyErrorResponseSchema } } },
  },
})

registry.registerPath({
  method: 'post',
  path: '/engines-api/external/engines',
  summary: 'Externally register an engine or customer sidecar',
  description: `${customerSidecarRegistrationDescription} This source-owned inventory channel remains independent from engineAccessAuthority and does not grant any user or group engine access.`,
  ...authzExtension('engine.external-registration.upsert', 'POST', '/engines-api/external/engines'),
  request: {
    body: {
      description: 'External registries may register a customer sidecar, but may not supply its downstream engine credential or peer token.',
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
    400: { description: 'Endpoint or tenancy policy rejected the external registration', content: { 'application/json': { schema: z.union([EndpointAuthenticationPolicyErrorSchema, EngineTenancyErrorResponseSchema]) } } },
    403: { description: 'Tenant reference is not authorized', content: { 'application/json': { schema: EngineTenancyErrorResponseSchema } } },
    409: { description: 'Topology transition is required', content: { 'application/json': { schema: EngineTenancyErrorResponseSchema } } },
  },
})

registry.registerPath({
  method: 'put',
  path: '/engines-api/external/engines/{externalId}/tenant-mappings',
  ...authzExtension('engine.external-registration.upsert', 'PUT', '/engines-api/external/engines/{externalId}/tenant-mappings'),
  request: {
    params: z.object({ externalId: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: ExternalEngineTenantMappingsUpsertRequestSchema.extend({
            externalSystemId: z.string().nullable().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: { description: 'External tenant mappings previewed or atomically applied', content: { 'application/json': { schema: ExternalEngineTenantMappingsUpsertResponseSchema } } },
    400: { description: 'Engine topology or mapping request is invalid', content: { 'application/json': { schema: EngineTenancyErrorResponseSchema } } },
    403: { description: 'A tenant reference or external engine system is not authorized', content: { 'application/json': { schema: EngineTenancyErrorResponseSchema } } },
    409: { description: 'Mapping version or ownership conflict', content: { 'application/json': { schema: EngineTenancyErrorResponseSchema } } },
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
          schema: ExternalEngineDecommissionRequestSchema,
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
    201: { description: 'External project-engine target registered', content: { 'application/json': { schema: z.object({ created: z.literal(true), target: ExternalProjectEngineTargetSchema }).strict() } } },
    200: { description: 'External project-engine target updated', content: { 'application/json': { schema: z.object({ created: z.literal(false), target: ExternalProjectEngineTargetSchema }).strict() } } },
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
  summary: 'Update an engine or customer sidecar',
  description: customerSidecarRegistrationDescription,
  ...authzExtension('engine.inventory.update', 'PUT', '/engines-api/engines/{id}'),
  request: {
    params: z.object({ id: z.string() }),
    body: {
      description: 'Changing endpoint credentials changes only the EnterpriseGlue-to-sidecar hop for a customer_sidecar engine.',
      content: { 'application/json': { schema: UpdateEngineRequestSchema } },
    },
  },
  responses: {
    200: { description: 'Updated', content: { 'application/json': { schema: EngineSchema } } },
    400: { description: 'Endpoint or tenancy policy rejected the engine update', content: { 'application/json': { schema: z.union([EndpointAuthenticationPolicyErrorSchema, EngineTenancyErrorResponseSchema]) } } },
    403: { description: 'Tenant reference is not authorized', content: { 'application/json': { schema: EngineTenancyErrorResponseSchema } } },
    409: { description: 'Topology transition is required', content: { 'application/json': { schema: EngineTenancyErrorResponseSchema } } },
  },
})

registry.registerPath({
  method: 'get',
  path: '/engines-api/engines/tenancy/classification-report',
  ...authzExtension('engine.tenancy.classification.read', 'GET', '/engines-api/engines/tenancy/classification-report'),
  responses: {
    200: { description: 'Sanitized existing-engine tenancy classification and migration evidence report', content: { 'application/json': { schema: EngineTenancyClassificationReportSchema } } },
    403: { description: 'Platform engine administration permission is required' },
  },
})

registry.registerPath({
  method: 'get',
  path: '/engines-api/engines/{id}/tenancy/diagnostics',
  ...authzExtension('engine.inventory.read', 'GET', '/engines-api/engines/{id}/tenancy/diagnostics'),
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'Sanitized engine tenancy diagnostics', content: { 'application/json': { schema: EngineTenancyDiagnosticsSchema } } },
    404: { description: 'Engine not found' },
  },
})

registry.registerPath({
  method: 'post',
  path: '/engines-api/engines/{id}/tenancy/preview',
  ...authzExtension('engine.inventory.update', 'POST', '/engines-api/engines/{id}/tenancy/preview'),
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: EngineTenancyTransitionPreviewRequestSchema } } },
  },
  responses: {
    200: { description: 'Topology transition impact preview', content: { 'application/json': { schema: EngineTenancyTransitionPreviewResponseSchema } } },
    400: { description: 'The proposed topology is invalid or unchanged', content: { 'application/json': { schema: EngineTenancyErrorResponseSchema } } },
    403: { description: 'The caller or source cannot change this topology', content: { 'application/json': { schema: EngineTenancyErrorResponseSchema } } },
    404: { description: 'Engine not found' },
  },
})

registry.registerPath({
  method: 'post',
  path: '/engines-api/engines/{id}/tenancy/apply',
  ...authzExtension('engine.inventory.update', 'POST', '/engines-api/engines/{id}/tenancy/apply'),
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: EngineTenancyTransitionApplyRequestSchema } } },
  },
  responses: {
    200: { description: 'Topology transition applied atomically', content: { 'application/json': { schema: EngineTenancyTransitionApplyResponseSchema } } },
    400: { description: 'Required acknowledgement is missing', content: { 'application/json': { schema: EngineTenancyErrorResponseSchema } } },
    403: { description: 'The caller or source cannot change this topology', content: { 'application/json': { schema: EngineTenancyErrorResponseSchema } } },
    404: { description: 'Engine not found' },
    409: { description: 'The transition preview is stale or expired', content: { 'application/json': { schema: EngineTenancyErrorResponseSchema } } },
  },
})

registry.registerPath({
  method: 'get',
  path: '/engines-api/engines/{id}/tenant-mappings',
  ...authzExtension('engine.inventory.update', 'GET', '/engines-api/engines/{id}/tenant-mappings'),
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'Tenant mappings', content: { 'application/json': { schema: z.array(EngineTenantMappingSchema) } } },
    400: { description: 'Engine is not shared', content: { 'application/json': { schema: EngineTenancyErrorResponseSchema } } },
    404: { description: 'Engine not found' },
  },
})

registry.registerPath({
  method: 'put',
  path: '/engines-api/engines/{id}/tenant-mappings',
  ...authzExtension('engine.inventory.update', 'PUT', '/engines-api/engines/{id}/tenant-mappings'),
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: ExternalEngineTenantMappingsUpsertRequestSchema } } },
  },
  responses: {
    200: { description: 'Tenant mappings previewed or atomically applied', content: { 'application/json': { schema: ExternalEngineTenantMappingsUpsertResponseSchema } } },
    400: { description: 'Engine topology or mapping request is invalid', content: { 'application/json': { schema: EngineTenancyErrorResponseSchema } } },
    403: { description: 'Tenant reference is not authorized', content: { 'application/json': { schema: EngineTenancyErrorResponseSchema } } },
    409: { description: 'Mapping version or ownership conflict', content: { 'application/json': { schema: EngineTenancyErrorResponseSchema } } },
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
registry.register('EngineHealth', EngineConnectionHealthResponseSchema)

registry.registerPath({
  method: 'post',
  path: '/engines-api/engines/{id}/test',
  ...authzExtension('engine.inventory.update', 'POST', '/engines-api/engines/{id}/test'),
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: 'Health test result', content: { 'application/json': { schema: EngineConnectionHealthResponseSchema } } } },
})

registry.registerPath({
  method: 'get',
  path: '/engines-api/engines/{id}/health',
  ...authzExtension('engine.inventory.read', 'GET', '/engines-api/engines/{id}/health'),
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: 'Last recorded health or null', content: { 'application/json': { schema: EngineConnectionHealthResponseSchema.nullable() } } } },
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
  request: { body: { content: { 'application/json': { schema: SavedFilterCreateRequestSchema } } } },
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
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: SavedFilterUpdateRequestSchema } } } },
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
const PreviewResponse = z.object({ count: z.number(), resources: z.array(z.string()), warnings: z.array(z.string()), errors: z.array(z.string()) })

registry.register('EnginesDeployRequest', EngineDeploymentRequestSchema)
registry.register('EnginesDeployPreviewResponse', PreviewResponse)
registry.register('EnginesDeployResponse', EngineDeploymentResponseSchema)

registry.registerPath({
  method: 'post',
  path: '/engines-api/engines/{engineId}/deployments/preview',
  ...authzExtension('project-engine-target.deploy.use', 'POST', '/engines-api/engines/:engineId/deployments/preview'),
  request: { params: z.object({ engineId: z.string() }), body: { content: { 'application/json': { schema: EngineDeploymentRequestSchema } } } },
  responses: { 200: { description: 'Preview of resources to deploy', content: { 'application/json': { schema: PreviewResponse } } } },
})

registry.registerPath({
  method: 'post',
  path: '/engines-api/engines/{engineId}/deployments',
  ...authzExtension('project-engine-target.deploy.use', 'POST', '/engines-api/engines/:engineId/deployments'),
  request: { params: z.object({ engineId: z.string() }), body: { content: { 'application/json': { schema: EngineDeploymentRequestSchema } } } },
  responses: { 201: { description: 'Deployment created', content: { 'application/json': { schema: EngineDeploymentResponseSchema } } } },
})

registry.registerPath({
  method: 'post',
  path: '/engines-api/external/engines/{engineId}/deployments',
  ...authzExtension('project-engine-target.deploy.use', 'POST', '/engines-api/external/engines/:engineId/deployments'),
  request: { params: z.object({ engineId: z.string() }), body: { content: { 'application/json': { schema: EngineDeploymentRequestSchema } } } },
  responses: {
    201: { description: 'API-client deployment created', content: { 'application/json': { schema: EngineDeploymentResponseSchema } } },
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
  responses: { 200: { description: 'Engine-native Camunda-compatible deployment list. This passthrough is scoped by EnterpriseGlue authorization but its payload is not a canonical deployment receipt or history contract.', content: { 'application/json': { schema: z.unknown() } } } },
})

registry.registerPath({
  method: 'get',
  path: '/engines-api/engines/{engineId}/deployments/{id}',
  ...authzExtension('engine.deployments.read', 'GET', '/engines-api/engines/{engineId}/deployments/{id}'),
  request: { params: z.object({ engineId: z.string(), id: z.string() }) },
  responses: { 200: { description: 'Engine-native Camunda-compatible deployment detail. This passthrough is scoped by EnterpriseGlue authorization but its payload is not a canonical deployment receipt or history contract.', content: { 'application/json': { schema: z.unknown() } } }, 404: { description: 'Not found' } },
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

registry.register('BatchOperationCreateResponse', BatchOperationCreateResponseSchema)

registry.register('CreateDeleteBatchRequest', BatchDeleteOperationRequestSchema)
registry.register('CreateSuspendActivateBatchRequest', BatchProcessInstanceSuspensionRequestSchema)
registry.register('CreateRetriesBatchRequest', BatchRetryOperationRequestSchema)

registry.register('BatchDetail', BatchDetailSchema)

// Create: delete instances (async)
registry.registerPath({
  method: 'post',
  path: '/mission-control-api/batches/process-instances/delete',
  ...authzExtension('engine.runtime.batches.process-instances.delete', 'POST', '/mission-control-api/batches/process-instances/delete'),
  request: { body: { content: { 'application/json': { schema: BatchDeleteOperationRequestSchema } } } },
  responses: { 201: { description: 'Created', content: { 'application/json': { schema: BatchOperationCreateResponseSchema } } } },
})

// Create: suspend instances (async)
registry.registerPath({
  method: 'post',
  path: '/mission-control-api/batches/process-instances/suspend',
  ...authzExtension('engine.runtime.batches.process-instances.suspend', 'POST', '/mission-control-api/batches/process-instances/suspend'),
  request: { body: { content: { 'application/json': { schema: BatchProcessInstanceSuspensionRequestSchema } } } },
  responses: { 201: { description: 'Created', content: { 'application/json': { schema: BatchOperationCreateResponseSchema } } } },
})

// Create: activate instances (async)
registry.registerPath({
  method: 'post',
  path: '/mission-control-api/batches/process-instances/activate',
  ...authzExtension('engine.runtime.batches.process-instances.activate', 'POST', '/mission-control-api/batches/process-instances/activate'),
  request: { body: { content: { 'application/json': { schema: BatchProcessInstanceSuspensionRequestSchema } } } },
  responses: { 201: { description: 'Created', content: { 'application/json': { schema: BatchOperationCreateResponseSchema } } } },
})

// Create: set job retries (async)
registry.registerPath({
  method: 'post',
  path: '/mission-control-api/batches/jobs/retries',
  ...authzExtension('engine.runtime.batches.jobs.retry', 'POST', '/mission-control-api/batches/jobs/retries'),
  request: { body: { content: { 'application/json': { schema: BatchRetryOperationRequestSchema } } } },
  responses: { 201: { description: 'Created', content: { 'application/json': { schema: BatchOperationCreateResponseSchema } } } },
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
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: BatchSuspensionUpdateRequestSchema } } } },
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
registry.register('MigrationInstruction', MigrationInstructionSchema)
registry.register('MigrationPlan', MigrationPlanSchema)
registry.register('MigrationGenerateInput', MigrationGenerateRequestSchema)

registry.register('MigrationValidateRequest', MigrationPlanValidationRequestSchema)

registry.register('MigrationExecuteRequest', MigrationExecuteRequestSchema)
registry.register('MigrationCreateResponse', MigrationAsyncExecuteResponseSchema)
registry.register('MigrationDirectResponse', MigrationDirectExecuteResponseSchema)

// POST /mission-control-api/migration/plan/generate (documented compatibility alias)
registry.registerPath({
  method: 'post',
  path: '/mission-control-api/migration/plan/generate',
  ...authzExtension('engine.runtime.migrations.plan.generate', 'POST', '/mission-control-api/migration/plan/generate'),
  request: { body: { content: { 'application/json': { schema: MigrationGenerateRequestSchema } } } },
  responses: { 200: { description: 'Generated migration plan (compatibility alias)', content: { 'application/json': { schema: MigrationPlanSchema } } } },
})

// POST /mission-control-api/migration/plan/validate
registry.registerPath({
  method: 'post',
  path: '/mission-control-api/migration/plan/validate',
  ...authzExtension('engine.runtime.migrations.plan.validate', 'POST', '/mission-control-api/migration/plan/validate'),
  request: { body: { content: { 'application/json': { schema: MigrationPlanValidationRequestSchema } } } },
  responses: { 200: { description: 'Validation result', content: { 'application/json': { schema: MigrationValidationResultSchema } } } },
})

// POST /mission-control-api/migration/execute-async
registry.registerPath({
  method: 'post',
  path: '/mission-control-api/migration/execute-async',
  ...authzExtension('engine.runtime.migrations.execute-async', 'POST', '/mission-control-api/migration/execute-async'),
  request: { body: { content: { 'application/json': { schema: MigrationExecuteRequestSchema } } } },
  responses: { 201: { description: 'Created', content: { 'application/json': { schema: MigrationAsyncExecuteResponseSchema } } } },
})

// POST /mission-control-api/migration/execute-direct
registry.registerPath({
  method: 'post',
  path: '/mission-control-api/migration/execute-direct',
  ...authzExtension('engine.runtime.migrations.execute-direct', 'POST', '/mission-control-api/migration/execute-direct'),
  request: { body: { content: { 'application/json': { schema: MigrationExecuteRequestSchema } } } },
  responses: { 200: { description: 'Executed', content: { 'application/json': { schema: MigrationDirectExecuteResponseSchema } } } },
})

// POST /mission-control-api/migration/preview
registry.register('MigrationPreviewRequest', MigrationPreviewRequestSchema)
registry.register('MigrationPreviewResponse', MigrationPreviewResponseSchema)
registry.registerPath({
  method: 'post',
  path: '/mission-control-api/migration/preview',
  ...authzExtension('engine.runtime.migrations.preview', 'POST', '/mission-control-api/migration/preview'),
  request: { body: { content: { 'application/json': { schema: MigrationPreviewRequestSchema } } } },
  responses: { 200: { description: 'Preview affected instances count', content: { 'application/json': { schema: MigrationPreviewResponseSchema } } } },
})

// POST /mission-control-api/migration/active-sources
registry.register('ActiveSourcesRequest', MigrationActiveSourcesRequestSchema)
registry.register('ActiveSourcesResponse', MigrationActiveSourcesResponseSchema)
registry.registerPath({
  method: 'post',
  path: '/mission-control-api/migration/active-sources',
  ...authzExtension('engine.runtime.migrations.active-sources.read', 'POST', '/mission-control-api/migration/active-sources'),
  request: { body: { content: { 'application/json': { schema: MigrationActiveSourcesRequestSchema } } } },
  responses: { 200: { description: 'Active source activity counts keyed by activityId', content: { 'application/json': { schema: MigrationActiveSourcesResponseSchema } } } },
})

// -----------------------------
// Direct operations (no batch)
// -----------------------------
registry.register('DirectProcessInstanceDeleteRequest', DirectProcessInstanceDeleteRequestSchema)
registry.register('DirectProcessInstanceSuspensionRequest', DirectProcessInstanceSuspensionRequestSchema)
registry.register('DirectJobRetriesRequest', DirectJobRetriesRequestSchema)
registry.register('DirectOperationResult', DirectOperationResultSchema)

registry.registerPath({ method: 'post', path: '/mission-control-api/direct/process-instances/delete', ...authzExtension('engine.runtime.direct.process-instances.delete', 'POST', '/mission-control-api/direct/process-instances/delete'), request: { body: { content: { 'application/json': { schema: DirectProcessInstanceDeleteRequestSchema } } } }, responses: { 200: { description: 'Result for each requested process instance', content: { 'application/json': { schema: DirectOperationResultSchema } } } } })
registry.registerPath({ method: 'post', path: '/mission-control-api/direct/process-instances/suspend', ...authzExtension('engine.runtime.direct.process-instances.suspend', 'POST', '/mission-control-api/direct/process-instances/suspend'), request: { body: { content: { 'application/json': { schema: DirectProcessInstanceSuspensionRequestSchema } } } }, responses: { 200: { description: 'Result for each requested process instance', content: { 'application/json': { schema: DirectOperationResultSchema } } } } })
registry.registerPath({ method: 'post', path: '/mission-control-api/direct/process-instances/activate', ...authzExtension('engine.runtime.direct.process-instances.activate', 'POST', '/mission-control-api/direct/process-instances/activate'), request: { body: { content: { 'application/json': { schema: DirectProcessInstanceSuspensionRequestSchema } } } }, responses: { 200: { description: 'Result for each requested process instance', content: { 'application/json': { schema: DirectOperationResultSchema } } } } })
registry.registerPath({ method: 'post', path: '/mission-control-api/direct/jobs/retries', ...authzExtension('engine.runtime.direct.jobs.retry', 'POST', '/mission-control-api/direct/jobs/retries'), request: { body: { content: { 'application/json': { schema: DirectJobRetriesRequestSchema } } } }, responses: { 200: { description: 'Result for each requested process instance', content: { 'application/json': { schema: DirectOperationResultSchema } } } } })

// -----------------------------
// Mission Control API - Extended Endpoints
// -----------------------------

// Tasks
registry.register('Task', TaskSchema);
registry.registerPath({ method: 'get', path: '/mission-control-api/tasks', ...authzExtension('engine.runtime.tasks.read', 'GET', '/mission-control-api/tasks'), request: { query: TaskQueryParams.partial() }, responses: { 200: { description: 'Query tasks', content: { 'application/json': { schema: z.array(TaskSchema) } } } } });
registry.registerPath({ method: 'get', path: '/mission-control-api/tasks/count', ...authzExtension('engine.runtime.tasks.read', 'GET', '/mission-control-api/tasks/count'), request: { query: TaskQueryParams.partial() }, responses: { 200: { description: 'Count tasks', content: { 'application/json': { schema: TaskCountResponseSchema } } } } });
registry.registerPath({ method: 'get', path: '/mission-control-api/tasks/{id}', ...authzExtension('engine.runtime.tasks.read', 'GET', '/mission-control-api/tasks/{id}'), request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'Get task', content: { 'application/json': { schema: TaskSchema } } }, 404: { description: 'Not found' } } });
registry.registerPath({ method: 'get', path: '/mission-control-api/tasks/{id}/variables', ...authzExtension('engine.runtime.tasks.variables.read', 'GET', '/mission-control-api/tasks/{id}/variables'), request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'Task variables', content: { 'application/json': { schema: MissionControlVariablesSchema } } } } });
registry.registerPath({ method: 'put', path: '/mission-control-api/tasks/{id}/variables', ...authzExtension('engine.runtime.tasks.variables.update', 'PUT', '/mission-control-api/tasks/{id}/variables'), request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: TaskVariablesRequest } } } }, responses: { 200: { description: 'Variables updated', content: { 'application/json': { schema: MissionControlVariablesSchema } } } } });
registry.registerPath({ method: 'get', path: '/mission-control-api/tasks/{id}/form', ...authzExtension('engine.runtime.tasks.read', 'GET', '/mission-control-api/tasks/{id}/form'), request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'Task form', content: { 'application/json': { schema: TaskFormSchema } } } } });
registry.registerPath({ method: 'post', path: '/mission-control-api/tasks/{id}/claim', ...authzExtension('engine.runtime.tasks.assignment.update', 'POST', '/mission-control-api/tasks/{id}/claim'), request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: ClaimTaskRequest } } } }, responses: { 204: { description: 'Claimed' } } });
registry.registerPath({ method: 'post', path: '/mission-control-api/tasks/{id}/unclaim', ...authzExtension('engine.runtime.tasks.assignment.update', 'POST', '/mission-control-api/tasks/{id}/unclaim'), request: { params: z.object({ id: z.string() }) }, responses: { 204: { description: 'Unclaimed' } } });
registry.registerPath({ method: 'post', path: '/mission-control-api/tasks/{id}/assignee', ...authzExtension('engine.runtime.tasks.assignment.update', 'POST', '/mission-control-api/tasks/{id}/assignee'), request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: SetAssigneeRequest } } } }, responses: { 204: { description: 'Assignee set' } } });
registry.registerPath({ method: 'post', path: '/mission-control-api/tasks/{id}/complete', ...authzExtension('engine.runtime.tasks.complete', 'POST', '/mission-control-api/tasks/{id}/complete'), request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: CompleteTaskRequest.partial() } } } }, responses: { 200: { description: 'Task completed', content: { 'application/json': { schema: TaskCompleteResponseSchema } } } } });

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
registry.register('MessageCorrelationResults', MessageCorrelationResultsSchema);
registry.registerPath({ method: 'post', path: '/mission-control-api/messages', ...authzExtension('engine.runtime.messages.correlate', 'POST', '/mission-control-api/messages'), request: { body: { content: { 'application/json': { schema: CorrelateMessageRequest } } } }, responses: { 200: { description: 'One result for each correlated execution or process definition', content: { 'application/json': { schema: MessageCorrelationResultsSchema } } } } });
registry.registerPath({ method: 'post', path: '/mission-control-api/signals', ...authzExtension('engine.runtime.signals.deliver', 'POST', '/mission-control-api/signals'), request: { body: { content: { 'application/json': { schema: SignalEventSchema } } } }, responses: { 204: { description: 'Signal delivered' } } });

// Decisions
registry.register('DecisionDefinition', DecisionDefinitionSchema);
registry.register('DecisionDefinitionList', DecisionDefinitionListSchema);
registry.registerPath({ method: 'get', path: '/mission-control-api/decision-definitions', ...authzExtension('engine.runtime.decisions.read', 'GET', '/mission-control-api/decision-definitions'), request: { query: DecisionDefinitionQueryParams.partial() }, responses: { 200: { description: 'List decision definitions', content: { 'application/json': { schema: DecisionDefinitionListSchema } } } } });
registry.registerPath({ method: 'get', path: '/mission-control-api/decision-definitions/{id}', ...authzExtension('engine.runtime.decisions.read', 'GET', '/mission-control-api/decision-definitions/{id}'), request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'Get decision definition', content: { 'application/json': { schema: DecisionDefinitionSchema } } }, 404: { description: 'Not found' } } });
registry.registerPath({ method: 'get', path: '/mission-control-api/decision-definitions/{id}/xml', ...authzExtension('engine.runtime.decisions.read', 'GET', '/mission-control-api/decision-definitions/{id}/xml'), request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'DMN XML', content: { 'application/json': { schema: DecisionDefinitionXmlSchema } } } } });
registry.register('DecisionEvaluationResult', DecisionEvaluationResultSchema);
registry.registerPath({ method: 'post', path: '/mission-control-api/decision-definitions/{id}/evaluate', ...authzExtension('engine.runtime.decisions.evaluate', 'POST', '/mission-control-api/decision-definitions/{id}/evaluate'), request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: EvaluateDecisionRequest } } } }, responses: { 200: { description: 'Decision result', content: { 'application/json': { schema: DecisionEvaluationResultSchema } } } } });
registry.registerPath({ method: 'post', path: '/mission-control-api/decision-definitions/key/{key}/evaluate', ...authzExtension('engine.runtime.decisions.evaluate', 'POST', '/mission-control-api/decision-definitions/key/{key}/evaluate'), request: { params: z.object({ key: z.string() }), body: { content: { 'application/json': { schema: EvaluateDecisionRequest } } } }, responses: { 200: { description: 'Decision result', content: { 'application/json': { schema: DecisionEvaluationResultSchema } } } } });

// GET /mission-control-api/decision-definitions/edit-target (resolve Starbase edit target for a deployed decision version)
registry.register('DecisionEditTarget', DecisionEditTargetSchema);
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
    200: { description: 'Starbase file target for the deployed decision version', content: { 'application/json': { schema: DecisionEditTargetSchema } } },
    404: { description: 'No deployed decision mapping found' },
  },
});

// Jobs
registry.register('Job', JobSchema);
registry.register('JobDefinition', JobDefinitionSchema);
registry.register('ExecuteJobRequest', ExecuteJobRequest);
registry.registerPath({ method: 'get', path: '/mission-control-api/jobs', ...authzExtension('engine.runtime.jobs.read', 'GET', '/mission-control-api/jobs'), request: { query: JobQueryParams.partial() }, responses: { 200: { description: 'Query jobs', content: { 'application/json': { schema: z.array(JobSchema) } } } } });
registry.registerPath({ method: 'get', path: '/mission-control-api/jobs/{id}', ...authzExtension('engine.runtime.jobs.read', 'GET', '/mission-control-api/jobs/{id}'), request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'Get job', content: { 'application/json': { schema: JobSchema } } }, 404: { description: 'Not found' } } });
registry.registerPath({ method: 'post', path: '/mission-control-api/jobs/{id}/execute', ...authzExtension('engine.runtime.jobs.execute', 'POST', '/mission-control-api/jobs/{id}/execute'), request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: ExecuteJobRequest } } } }, responses: { 204: { description: 'Job executed' } } });
registry.registerPath({ method: 'put', path: '/mission-control-api/jobs/{id}/retries', ...authzExtension('engine.runtime.jobs.retries.update', 'PUT', '/mission-control-api/jobs/{id}/retries'), request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: SetJobRetriesRequest } } } }, responses: { 204: { description: 'Retries set' } } });
registry.registerPath({ method: 'put', path: '/mission-control-api/jobs/{id}/suspended', ...authzExtension('engine.runtime.jobs.suspension.update', 'PUT', '/mission-control-api/jobs/{id}/suspended'), request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: SetJobSuspensionStateRequest } } } }, responses: { 204: { description: 'Suspension state updated' } } });
registry.registerPath({ method: 'get', path: '/mission-control-api/job-definitions', ...authzExtension('engine.runtime.job-definitions.read', 'GET', '/mission-control-api/job-definitions'), request: { query: JobDefinitionQueryParams.partial() }, responses: { 200: { description: 'Query job definitions', content: { 'application/json': { schema: z.array(JobDefinitionSchema) } } } } });
registry.registerPath({ method: 'put', path: '/mission-control-api/job-definitions/{id}/retries', ...authzExtension('engine.runtime.job-definitions.retries.update', 'PUT', '/mission-control-api/job-definitions/{id}/retries'), request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: SetJobDefinitionRetriesRequest } } } }, responses: { 204: { description: 'Retries set' } } });
registry.registerPath({ method: 'put', path: '/mission-control-api/job-definitions/{id}/suspended', ...authzExtension('engine.runtime.job-definitions.suspension.update', 'PUT', '/mission-control-api/job-definitions/{id}/suspended'), request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: SetJobDefinitionSuspensionStateRequest } } } }, responses: { 204: { description: 'Suspension state updated' } } });

// Extended History
registry.register('HistoricTaskInstance', HistoricTaskInstanceSchema);
registry.register('HistoricTaskInstanceList', HistoricTaskInstanceListSchema);
registry.register('HistoricVariableInstance', HistoricVariableInstanceSchema);
registry.register('HistoricVariableInstanceList', HistoricVariableInstanceListSchema);
registry.register('VariableHistoryEntry', VariableHistoryEntrySchema);
registry.register('HistoricDecisionInstance', HistoricDecisionInstanceSchema);
registry.register('HistoricDecisionInstanceList', HistoricDecisionInstanceListSchema);
registry.register('HistoricDecisionIoList', HistoricDecisionIoListSchema);
registry.register('UserOperationLogEntry', UserOperationLogEntrySchema);
registry.register('UserOperationLogEntryList', UserOperationLogEntryListSchema);
registry.registerPath({ method: 'get', path: '/mission-control-api/history/tasks', ...authzExtension('engine.runtime.history.tasks.read', 'GET', '/mission-control-api/history/tasks'), request: { query: HistoricTaskQueryParams.partial() }, responses: { 200: { description: 'Historic task instances', content: { 'application/json': { schema: HistoricTaskInstanceListSchema } } } } });
registry.registerPath({ method: 'get', path: '/mission-control-api/history/variables', ...authzExtension('engine.runtime.history.variables.read', 'GET', '/mission-control-api/history/variables'), request: { query: HistoricVariableQueryParams.partial() }, responses: { 200: { description: 'Historic variable instances', content: { 'application/json': { schema: HistoricVariableInstanceListSchema } } } } });
registry.registerPath({ method: 'get', path: '/mission-control-api/history/decisions', ...authzExtension('engine.runtime.history.decisions.read', 'GET', '/mission-control-api/history/decisions'), request: { query: HistoricDecisionQueryParams.partial() }, responses: { 200: { description: 'Historic decision instances', content: { 'application/json': { schema: HistoricDecisionInstanceListSchema } } } } });
registry.registerPath({ method: 'get', path: '/mission-control-api/history/decisions/{id}/inputs', ...authzExtension('engine.runtime.history.decisions.inputs.read', 'GET', '/mission-control-api/history/decisions/{id}/inputs'), request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'Inputs for a historic decision instance', content: { 'application/json': { schema: HistoricDecisionIoListSchema } } }, 404: { description: 'Not found' } } });
registry.registerPath({ method: 'get', path: '/mission-control-api/history/decisions/{id}/outputs', ...authzExtension('engine.runtime.history.decisions.outputs.read', 'GET', '/mission-control-api/history/decisions/{id}/outputs'), request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'Outputs for a historic decision instance', content: { 'application/json': { schema: HistoricDecisionIoListSchema } } }, 404: { description: 'Not found' } } });
registry.registerPath({ method: 'get', path: '/mission-control-api/history/user-operations', ...authzExtension('engine.runtime.history.user-operations.read', 'GET', '/mission-control-api/history/user-operations'), request: { query: UserOperationLogQueryParams.partial() }, responses: { 200: { description: 'User operation log', content: { 'application/json': { schema: UserOperationLogEntryListSchema } } } } });

// Metrics
registry.register('Metric', MetricSchema);
registry.registerPath({ method: 'get', path: '/mission-control-api/metrics', ...authzExtension('engine.runtime.metrics.read', 'GET', '/mission-control-api/metrics'), request: { query: MetricsQueryParams.partial() }, responses: { 200: { description: 'Query metrics', content: { 'application/json': { schema: MetricsResultSchema } } } } });
registry.registerPath({ method: 'get', path: '/mission-control-api/metrics/{name}', ...authzExtension('engine.runtime.metrics.read', 'GET', '/mission-control-api/metrics/{name}'), request: { params: z.object({ name: z.string() }), query: MetricsQueryParams.partial() }, responses: { 200: { description: 'Get metric by name', content: { 'application/json': { schema: MetricSchema } } } } });

// -----------------------------
// Modification & Restart
// -----------------------------
registry.register('ModificationInstruction', ModificationInstructionSchema)
registry.register('ProcessInstanceModificationRequest', ProcessInstanceModificationRequest)
registry.register('ProcessDefinitionModificationAsyncRequest', ProcessDefinitionModificationAsyncRequest)
registry.register('ProcessDefinitionRestartAsyncRequest', ProcessDefinitionRestartAsyncRequest)
registry.register('ProcessDefinitionModificationAsyncResponse', ProcessDefinitionModificationAsyncResponseSchema)
registry.register('ProcessDefinitionRestartAsyncResponse', ProcessDefinitionRestartAsyncResponseSchema)

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
  responses: { 201: { description: 'Batch created', content: { 'application/json': { schema: ProcessDefinitionModificationAsyncResponseSchema } } } },
})

// POST /mission-control-api/process-definitions/{id}/restart/execute-async
registry.registerPath({
  method: 'post',
  path: '/mission-control-api/process-definitions/{id}/restart/execute-async',
  ...authzExtension('engine.runtime.process-definitions.restart.execute-async', 'POST', '/mission-control-api/process-definitions/{id}/restart/execute-async'),
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: ProcessDefinitionRestartAsyncRequest } } } },
  responses: { 201: { description: 'Batch created', content: { 'application/json': { schema: ProcessDefinitionRestartAsyncResponseSchema } } } },
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
    200: { description: 'Active locks', content: { 'application/json': { schema: LockListResponseSchema } } },
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
  PublicPlatformSettingsSchema,
  UpdatePlatformSettingsRequest,
  AccessAuthorityModeSchema,
  AccessGovernanceOwnershipModeSchema,
  PlatformGovernanceBehaviorSchema,
  PlatformBrandingSchema,
  PublicPlatformBrandingSchema,
  UpdatePlatformBrandingRequestSchema,
  EngineOnboardingModeSchema,
  EngineRuntimeAuthorizationModeSchema,
  UnsupportedEngineRuntimeAuthorizationModeErrorSchema,
  EnterpriseGlueConfigBundleSchema,
  ConfigBundleRemoteImportRequestSchema,
  ConfigBundleApplyRequestSchema,
  ConfigBundleApplyResultSchema,
  ConfigBundleApplyRunSchema,
  GovernanceOwnershipRequestSchema,
  GovernanceOwnershipApplyRequestSchema,
  GovernanceOwnershipStateSchema,
  GovernanceOwnershipPreviewResponseSchema,
  GovernanceOwnershipReceiptSchema,
  ConfigBundleDiffChangeSchema,
  ConfigBundleDiffResponseSchema,
  ConfigEngineSchema,
  ConfigAssignmentsFileSchema,
  ConfigEnginesFileSchema,
  ConfigEngineBackstopMappingsFileSchema,
  ConfigEngineTenantMappingsFileSchema,
  ConfigEngineSetsFileSchema,
  ConfigGroupsFileSchema,
  ConfigIdentityMappingsFileSchema,
  ConfigIdentityProvisioningDirectoriesFileSchema,
  ConfigIdentityProvidersFileSchema,
  ConfigProjectEngineTargetsFileSchema,
  ConfigRolesFileSchema,
  ConfigRuntimeResourceSetsFileSchema,
  ConfigBundlePreviewResponseSchema,
  ConfigBundleSecretPreflightResponseSchema,
  ConfigBundleValidationIssueSchema,
  ConfigBundleSettingsSchema,
  ConfigBundleGovernanceV1Beta1Schema,
  ConfigBundleContractMetadataSchema,
  ProjectEngineTargetPolicyModeSchema,
  ProjectMemberSchema,
  ProjectMembersResponseSchema,
  ProjectMemberCandidateSchema,
  ProjectMemberLookupSchema,
  ProjectMemberCapabilitiesSchema,
  ProjectMemberAddResponseSchema,
  UpdateProjectDeployGrantRequestSchema,
  ProjectDeployGrantResponseSchema,
  ReissuedManualProjectInvitationSchema,
  AddProjectMemberRequest,
  UpdateProjectMemberRoleRequest,
  TransferProjectOwnershipRequest,
  EngineMemberSchema,
  EngineMembersResponseSchema,
  EngineProjectAccessRequestSchema,
  EngineMemberCapabilitiesSchema,
  EngineMemberLookupSchema,
  EngineMemberAddResponseSchema,
  ReissuedManualEngineInvitationSchema,
  EngineWithDetailsSchema,
  EngineRoleResponse,
  AddEngineMemberRequest,
  UpdateEngineMemberRoleRequest,
  AssignDelegateRequest,
  TransferEngineOwnershipRequest,
  SetEnvironmentRequest,
  EngineEnvironmentUpdateResponseSchema,
  SetLockedRequest,
  RequestAccessRequest,
  EngineProjectAccessRequestResultSchema,
  AssignOwnerRequest,
  UserSearchResultSchema,
  UserListItemSchema,
  GovernanceProjectSummarySchema,
  GovernanceEngineSummarySchema,
  GitProviderAdminSummarySchema,
  GitProviderAdminUpdateResponseSchema,
  UpdateGitProviderRequestSchema,
  SuccessResponseSchema,
  InvitationCapabilitiesResponseSchema,
  CreateInvitationRequestSchema,
  CreateInvitationResponseSchema,
  InvitationInfoSchema,
  InvitationOnboardingResponseSchema,
  InvitationTokenParamsSchema,
  VerifyInvitationOtpRequestSchema,
  CompleteOnboardingRequestSchema,
  EmailConfigurationAdminResponseSchema,
  CreateEmailConfigurationRequestSchema,
  UpdateEmailConfigurationRequestSchema,
  EmailTemplateAdminResponseSchema,
  EmailTemplatePreviewRequestSchema,
  EmailTemplatePreviewResponseSchema,
  UpdateEmailTemplateRequestSchema,
  EmailPlatformNameResponseSchema,
  UpdateEmailPlatformNameRequestSchema,
  EmailTestRequestSchema,
  EmailTestResponseSchema,
  AdminMutationSuccessResponseSchema,
  PlatformUserCreateRequestSchema,
  PlatformUserUpdateRequestSchema,
  PlatformUserResponseSchema,
  PlatformUserCreateResponseSchema,
  UserOperationMessageSchema,
  UserAuditQuerySchema,
  UserAuditResponseSchema,
  UserDeactivateRequestSchema,
  UserDirectoryListResponseSchema,
  UserDirectoryQuerySchema,
  UserEffectiveAccessResponseSchema,
  UserIdentityContextSchema,
  UserLifecycleMutationResponseSchema,
  UserReactivateRequestSchema,
  UserRevokeSessionsRequestSchema,
  UserSessionsResponseSchema,
  IdentityProvisioningDirectoryKeySchema,
  IdentityProvisioningDirectoryCreateSchema,
  IdentityProvisioningDirectoryUpdateSchema,
  IdentityProvisioningDirectoryQuerySchema,
  IdentityProvisioningDirectoryRecordSchema,
  IdentityProvisioningDirectoryListResponseSchema,
  IdentityProvisioningCredentialCreateSchema,
  IdentityProvisioningCredentialRotateSchema,
  IdentityProvisioningCredentialMetadataSchema,
  IdentityProvisioningCredentialIssuedSchema,
  IdentityProvisioningIdempotencyKeySchema,
  IdentityProvisioningCredentialListResponseSchema,
  IdentityProvisioningDirectoryTestResponseSchema,
  IdentityProvisioningDiagnosticsQuerySchema,
  IdentityProvisioningDiagnosticsListResponseSchema,
  ScimOAuthTokenRequestSchema,
  ScimOAuthTokenResponseSchema,
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
  request: { body: { content: { 'application/json': { schema: UpdatePlatformBrandingRequestSchema } } } },
  responses: { 200: { description: 'Branding updated', content: { 'application/json': { schema: SuccessResponseSchema } } } },
});

registry.registerPath({
  method: 'delete',
  path: '/api/admin/branding',
  ...authzExtension('platform.settings.manage', 'DELETE', '/api/admin/branding'),
  responses: { 200: { description: 'Branding reset', content: { 'application/json': { schema: SuccessResponseSchema } } } },
});

// Platform Settings
registry.register('AccessAuthorityMode', AccessAuthorityModeSchema);
registry.register('AccessGovernanceOwnershipMode', AccessGovernanceOwnershipModeSchema);
registry.register('PlatformGovernanceBehavior', PlatformGovernanceBehaviorSchema);
registry.register('EngineRuntimeAuthorizationMode', EngineRuntimeAuthorizationModeSchema);
registry.register('EngineOnboardingMode', EngineOnboardingModeSchema);
registry.register('ProjectEngineTargetPolicyMode', ProjectEngineTargetPolicyModeSchema);
registry.register('UnsupportedEngineRuntimeAuthorizationModeError', UnsupportedEngineRuntimeAuthorizationModeErrorSchema);
registry.register('PlatformSettings', PlatformSettingsSchema);
registry.register('PublicPlatformSettings', PublicPlatformSettingsSchema);
registry.registerPath({
  method: 'get',
  path: '/api/admin/settings',
  summary: 'Read platform settings and effective governance behavior',
  description: 'Returns the five independent governance axes, configuration ownership/provenance, and derived read-only behavior that API clients should use when enabling or disabling manual controls.',
  ...authzExtension('platform.settings.read', 'GET', '/api/admin/settings'),
  responses: { 200: { description: 'Platform settings', content: { 'application/json': { schema: PlatformSettingsSchema } } } },
});

registry.registerPath({
  method: 'put',
  path: '/api/admin/settings',
  summary: 'Update portal-owned platform settings',
  description: 'Updates only supplied fields. The five governance fields are rejected when their settings block is configuration-locked. This endpoint does not register engines, create projects, configure SSO providers, or change individual memberships.',
  ...authzExtension('platform.settings.manage', 'PUT', '/api/admin/settings'),
  request: {
    body: {
      description: 'Partial update. Use the configuration-bundle API when governance settings are managed headlessly.',
      content: {
        'application/json': {
          schema: UpdatePlatformSettingsRequest,
          example: {
            engineAccessAuthority: 'sso_managed',
            projectAccessAuthority: 'manual',
            engineOnboardingMode: 'external_only',
            projectEngineTargetMode: 'hybrid',
            engineRuntimeAuthorizationMode: 'enterpriseglue_authoritative',
          },
        },
      },
    },
  },
  responses: {
    200: { description: 'Updated', content: { 'application/json': { schema: SuccessResponseSchema } } },
    400: { description: 'Unsupported runtime authorization mode', content: { 'application/json': { schema: UnsupportedEngineRuntimeAuthorizationModeErrorSchema } } },
    403: { description: 'Governance settings are configuration-locked or the caller lacks permission' },
  },
});

// Plugin platform control plane. These are host-owned deployment controls; plugin
// packages never register or mutate this OpenAPI surface themselves.
registry.register('PluginControlError', PluginControlErrorResponseSchema);
registry.registerPath({
  method: 'get',
  path: '/api/plugin-platform/v1/catalog',
  summary: 'Read the safe configured plugin discovery catalog',
  ...authzExtension('platform.settings.read', 'GET', '/api/plugin-platform/v1/catalog'),
  responses: { 200: { description: 'Discovery-only catalog without artifact or deployment credentials', content: { 'application/json': { schema: PluginCatalogProjectionSchema } } } },
});
registry.registerPath({
  method: 'get',
  path: '/api/plugin-platform/v1/manager',
  summary: 'Read customer-local Plugin Manager availability and capabilities',
  ...authzExtension('platform.settings.read', 'GET', '/api/plugin-platform/v1/manager'),
  responses: { 200: { description: 'Safe manager capability handshake', content: { 'application/json': { schema: PluginManagerStatusSchema } } } },
});
registry.registerPath({
  method: 'get',
  path: '/api/plugin-platform/v1/installations',
  summary: 'List paged plugin installation activity',
  ...authzExtension('platform.settings.read', 'GET', '/api/plugin-platform/v1/installations'),
  request: { query: PluginInstallationQuerySchema },
  responses: { 200: { description: 'Safe intent, review, approval and observation summaries', content: { 'application/json': { schema: PluginInstallationPageSchema } } } },
});
registry.registerPath({
  method: 'get',
  path: '/api/plugin-platform/v1/installations/{installationId}',
  summary: 'Read one plugin installation and its safe review',
  ...authzExtension('platform.settings.read', 'GET', '/api/plugin-platform/v1/installations/:installationId'),
  request: { params: PluginInstallationPathSchema },
  responses: {
    200: { description: 'Safe installation summary', content: { 'application/json': { schema: PluginInstallationSummarySchema } } },
    404: { description: 'Installation was not found', content: { 'application/json': { schema: PluginControlErrorResponseSchema } } },
  },
});
registry.registerPath({
  method: 'post',
  path: '/api/plugin-platform/v1/installations',
  summary: 'Create a revision-bound plugin installation intent',
  ...authzExtension('platform.settings.manage', 'POST', '/api/plugin-platform/v1/installations'),
  request: { body: { content: { 'application/json': { schema: PluginInstallationCreateSchema } } } },
  responses: {
    201: { description: 'Installation intent accepted without deployment mutation', content: { 'application/json': { schema: pluginInstallationIntentV1Schema } } },
    409: { description: 'Platform revision or idempotency conflict', content: { 'application/json': { schema: PluginControlErrorResponseSchema } } },
  },
});
registry.registerPath({
  method: 'post',
  path: '/api/plugin-platform/v1/installations/{installationId}/approval',
  summary: 'Approve or reject an exact plugin plan and review digest',
  ...authzExtension('platform.settings.manage', 'POST', '/api/plugin-platform/v1/installations/:installationId/approval'),
  request: { params: PluginInstallationPathSchema, body: { content: { 'application/json': { schema: PluginInstallationApprovalRequestSchema } } } },
  responses: {
    200: { description: 'Exact-digest approval recorded', content: { 'application/json': { schema: PluginInstallationApprovalResponseSchema } } },
    409: { description: 'Review expired, changed, or conflicts with current revision', content: { 'application/json': { schema: PluginControlErrorResponseSchema } } },
  },
});
for (const action of ['cancel', 'retry'] as const) {
  registry.registerPath({
    method: 'post',
    path: `/api/plugin-platform/v1/installations/{installationId}/${action}`,
    summary: `${action === 'cancel' ? 'Cancel' : 'Retry'} a plugin installation lifecycle`,
    ...authzExtension('platform.settings.manage', 'POST', `/api/plugin-platform/v1/installations/:installationId/${action}`),
    request: { params: PluginInstallationPathSchema, body: { content: { 'application/json': { schema: PluginInstallationRecoveryRequestSchema } } } },
    responses: {
      200: { description: `Installation ${action} accepted at the expected revision`, content: { 'application/json': { schema: PluginInstallationRevisionResponseSchema } } },
      409: { description: 'State, lease, or revision conflicts with the recovery request', content: { 'application/json': { schema: PluginControlErrorResponseSchema } } },
    },
  });
}
registry.registerPath({
  method: 'get',
  path: '/api/plugin-platform/v1/capabilities',
  summary: 'Read the safe plugin-host capability catalog',
  ...authzExtension('platform.settings.read', 'GET', '/api/plugin-platform/v1/capabilities'),
  responses: { 200: { description: 'Safe capability catalog without credentials, registry destinations, or customer content', content: { 'application/json': { schema: pluginPlatformCapabilityCatalogV1Schema } } } },
});
registry.registerPath({
  method: 'get',
  path: '/api/plugin-platform/v1/plugins',
  summary: 'List installed plugin lifecycle state',
  ...authzExtension('platform.settings.read', 'GET', '/api/plugin-platform/v1/plugins'),
  responses: { 200: { description: 'Safe installed-plugin summaries', content: { 'application/json': { schema: pluginSafeListV1Schema } } } },
});
registry.registerPath({
  method: 'get',
  path: '/api/plugin-platform/v1/plugins/{pluginId}',
  summary: 'Read one installed plugin lifecycle state',
  ...authzExtension('platform.settings.read', 'GET', '/api/plugin-platform/v1/plugins/:pluginId'),
  request: { params: PluginIdPathSchema },
  responses: {
    200: { description: 'Safe plugin summary', content: { 'application/json': { schema: pluginSafeSummaryV1Schema } } },
    404: { description: 'Plugin is not installed', content: { 'application/json': { schema: PluginControlErrorResponseSchema } } },
  },
});
registry.registerPath({
  method: 'get',
  path: '/api/plugin-platform/v1/emergency-control',
  summary: 'Read the deployment-wide plugin emergency state',
  ...authzExtension('platform.settings.read', 'GET', '/api/plugin-platform/v1/emergency-control'),
  responses: { 200: { description: 'Current emergency state', content: { 'application/json': { schema: pluginPlatformEmergencyStateV1Schema } } } },
});
registry.registerPath({
  method: 'put',
  path: '/api/plugin-platform/v1/emergency-control',
  summary: 'Set the deployment-wide plugin emergency state',
  ...authzExtension('platform.settings.manage', 'PUT', '/api/plugin-platform/v1/emergency-control'),
  request: { body: { content: { 'application/json': { schema: pluginPlatformEmergencyRequestV1Schema } } } },
  responses: {
    200: { description: 'Updated emergency state', content: { 'application/json': { schema: pluginPlatformEmergencyStateV1Schema } } },
    409: { description: 'Stale revision or conflicting request', content: { 'application/json': { schema: PluginControlErrorResponseSchema } } },
  },
});
registry.registerPath({
  method: 'get',
  path: '/api/plugin-platform/v1/deployment-execution',
  summary: 'Read a safe deployment-execution observation',
  ...authzExtension('platform.settings.read', 'GET', '/api/plugin-platform/v1/deployment-execution'),
  responses: { 200: { description: 'Display-only lifecycle observation without worker, command, path, or cluster details', content: { 'application/json': { schema: pluginDeploymentExecutionObservationV1Schema } } } },
});
registry.registerPath({
  method: 'get',
  path: '/api/plugin-platform/v1/audit',
  summary: 'List safe plugin lifecycle audit events',
  ...authzExtension('platform.settings.read', 'GET', '/api/plugin-platform/v1/audit'),
  responses: { 200: { description: 'Payload-free plugin lifecycle audit events', content: { 'application/json': { schema: pluginPlatformAuditListV1Schema } } } },
});
registry.registerPath({
  method: 'get',
  path: '/api/plugin-platform/v1/metrics/diagnostics',
  summary: 'Read sanitized diagnostic collection metrics',
  ...authzExtension('platform.settings.read', 'GET', '/api/plugin-platform/v1/metrics/diagnostics'),
  responses: { 200: { description: 'Aggregate metrics without diagnostic content', content: { 'application/json': { schema: pluginDiagnosticMetricsV1Schema } } } },
});
registry.registerPath({
  method: 'get',
  path: '/api/plugin-platform/v1/metrics/events',
  summary: 'Read plugin event-delivery metrics',
  ...authzExtension('platform.settings.read', 'GET', '/api/plugin-platform/v1/metrics/events'),
  responses: { 200: { description: 'Aggregate event metrics without event payloads', content: { 'application/json': { schema: pluginEventMetricsV1Schema } } } },
});
registry.registerPath({
  method: 'get',
  path: '/api/plugin-platform/v1/events/dead-letters',
  summary: 'List payload-free plugin event dead letters',
  ...authzExtension('platform.settings.read', 'GET', '/api/plugin-platform/v1/events/dead-letters'),
  request: { query: PluginDeadLetterQuerySchema },
  responses: { 200: { description: 'Safe dead-letter delivery summaries', content: { 'application/json': { schema: pluginEventDeadLetterListV1Schema } } } },
});
registry.registerPath({
  method: 'get',
  path: '/api/plugin-platform/v1/operations/{operationId}',
  summary: 'Read a plugin lifecycle operation',
  ...authzExtension('platform.settings.read', 'GET', '/api/plugin-platform/v1/operations/:operationId'),
  request: { params: PluginOperationPathSchema },
  responses: {
    200: { description: 'Safe lifecycle operation state', content: { 'application/json': { schema: pluginLifecycleOperationV1Schema } } },
    404: { description: 'Operation was not found', content: { 'application/json': { schema: PluginControlErrorResponseSchema } } },
  },
});
registry.registerPath({
  method: 'post',
  path: '/api/plugin-platform/v1/plugins/{pluginId}/enable',
  summary: 'Enable an installed plugin at deployment scope',
  ...authzExtension('platform.settings.manage', 'POST', '/api/plugin-platform/v1/plugins/:pluginId/enable'),
  request: { params: PluginIdPathSchema, body: { content: { 'application/json': { schema: pluginEnableRequestV1Schema } } } },
  responses: {
    200: { description: 'Lifecycle operation accepted', content: { 'application/json': { schema: pluginLifecycleOperationV1Schema } } },
    404: { description: 'Plugin is not installed', content: { 'application/json': { schema: PluginControlErrorResponseSchema } } },
    409: { description: 'Plugin state or revision conflicts with the request', content: { 'application/json': { schema: PluginControlErrorResponseSchema } } },
  },
});
registry.registerPath({
  method: 'post',
  path: '/api/plugin-platform/v1/plugins/{pluginId}/disable',
  summary: 'Disable an installed plugin at deployment scope',
  ...authzExtension('platform.settings.manage', 'POST', '/api/plugin-platform/v1/plugins/:pluginId/disable'),
  request: { params: PluginIdPathSchema, body: { content: { 'application/json': { schema: pluginDisableRequestV1Schema } } } },
  responses: {
    200: { description: 'Lifecycle operation accepted', content: { 'application/json': { schema: pluginLifecycleOperationV1Schema } } },
    404: { description: 'Plugin is not installed', content: { 'application/json': { schema: PluginControlErrorResponseSchema } } },
    409: { description: 'Plugin state or revision conflicts with the request', content: { 'application/json': { schema: PluginControlErrorResponseSchema } } },
  },
});
registry.registerPath({
  method: 'post',
  path: '/api/plugin-platform/v1/plugins/{pluginId}/events/dead-letters/{deliveryId}/requeue',
  summary: 'Requeue a payload-free plugin event dead letter',
  ...authzExtension('platform.settings.manage', 'POST', '/api/plugin-platform/v1/plugins/:pluginId/events/dead-letters/:deliveryId/requeue'),
  request: { params: PluginDeadLetterPathSchema, body: { content: { 'application/json': { schema: pluginEventDeadLetterRequeueRequestV1Schema } } } },
  responses: {
    200: { description: 'Dead letter requeued', content: { 'application/json': { schema: pluginEventDeadLetterRequeueResultV1Schema } } },
    404: { description: 'Plugin or dead letter was not found', content: { 'application/json': { schema: PluginControlErrorResponseSchema } } },
    409: { description: 'The delivery attempt changed before requeue', content: { 'application/json': { schema: PluginControlErrorResponseSchema } } },
  },
});
registry.registerPath({
  method: 'get',
  path: '/t/{tenantSlug}/api/plugin-platform/v1/plugins/{pluginId}/enablement',
  summary: 'Read tenant plugin enablement',
  ...authzExtension('tenant.apps.read', 'GET', '/t/{tenantSlug}/api/plugin-platform/v1/plugins/{pluginId}/enablement'),
  request: { params: PluginTenantEnablementPathSchema },
  responses: {
    200: { description: 'Tenant enablement state', content: { 'application/json': { schema: pluginTenantEnablementV1Schema } } },
    404: { description: 'Plugin is not installed or does not support tenant enablement', content: { 'application/json': { schema: PluginControlErrorResponseSchema } } },
  },
});
registry.registerPath({
  method: 'put',
  path: '/t/{tenantSlug}/api/plugin-platform/v1/plugins/{pluginId}/enablement',
  summary: 'Set tenant plugin enablement',
  ...authzExtension('tenant.apps.manage', 'PUT', '/t/{tenantSlug}/api/plugin-platform/v1/plugins/{pluginId}/enablement'),
  request: { params: PluginTenantEnablementPathSchema, body: { content: { 'application/json': { schema: pluginTenantEnablementRequestV1Schema } } } },
  responses: {
    200: { description: 'Tenant enablement lifecycle operation accepted', content: { 'application/json': { schema: pluginLifecycleOperationV1Schema } } },
    404: { description: 'Plugin is not installed or does not support tenant enablement', content: { 'application/json': { schema: PluginControlErrorResponseSchema } } },
    409: { description: 'Plugin state or revision conflicts with the request', content: { 'application/json': { schema: PluginControlErrorResponseSchema } } },
  },
});
for (const method of ['get', 'put'] as const) {
  registry.registerPath({
    method,
    path: '/api/t/{tenantSlug}/plugin-platform/v1/plugins/{pluginId}/enablement',
    summary: `${method === 'get' ? 'Read' : 'Set'} tenant plugin enablement through the canonical route`,
    ...authzExtension(
      method === 'get' ? 'tenant.apps.read' : 'tenant.apps.manage',
      method.toUpperCase(),
      '/api/t/{tenantSlug}/plugin-platform/v1/plugins/{pluginId}/enablement',
    ),
    request: {
      params: PluginTenantEnablementPathSchema,
      ...(method === 'put'
        ? { body: { content: { 'application/json': { schema: pluginTenantEnablementRequestV1Schema } } } }
        : {}),
    },
    responses: {
      200: {
        description: method === 'get' ? 'Tenant enablement state' : 'Tenant enablement lifecycle operation accepted',
        content: { 'application/json': { schema: method === 'get' ? pluginTenantEnablementV1Schema : pluginLifecycleOperationV1Schema } },
      },
      404: { description: 'Plugin is unavailable', content: { 'application/json': { schema: PluginControlErrorResponseSchema } } },
      409: { description: 'Plugin state or revision conflicts with the request', content: { 'application/json': { schema: PluginControlErrorResponseSchema } } },
    },
  });
}
registry.registerPath({
  method: 'get',
  path: '/api/t/{tenantSlug}/apps',
  summary: 'List the current tenant application catalogue',
  ...authzExtension('tenant.apps.read', 'GET', '/api/t/{tenantSlug}/apps'),
  request: { params: PluginTenantEnablementPathSchema.omit({ pluginId: true }) },
  responses: { 200: { description: 'Tenant-safe application catalogue', content: { 'application/json': { schema: pluginTenantApplicationListV1Schema } } } },
});
registry.registerPath({
  method: 'get',
  path: '/api/t/{tenantSlug}/apps/{pluginId}',
  summary: 'Read one current-tenant application',
  ...authzExtension('tenant.apps.read', 'GET', '/api/t/{tenantSlug}/apps/{pluginId}'),
  request: { params: PluginTenantEnablementPathSchema },
  responses: { 200: { description: 'Tenant-safe application state', content: { 'application/json': { schema: pluginTenantApplicationV1Schema } } }, 404: { description: 'Application is unavailable' } },
});
registry.registerPath({
  method: 'get',
  path: '/api/t/{tenantSlug}/apps/{pluginId}/configuration',
  summary: 'Read the plugin-owned configuration projection',
  ...authzExtension('tenant.apps.read', 'GET', '/api/t/{tenantSlug}/apps/{pluginId}/configuration'),
  request: { params: PluginTenantEnablementPathSchema },
  responses: { 200: { description: 'Safe configuration schema hash and tenant link', content: { 'application/json': { schema: pluginTenantApplicationV1Schema.shape.configuration } } } },
});
registry.registerPath({
  method: 'get',
  path: '/api/t/{tenantSlug}/apps/{pluginId}/audit',
  summary: 'Read application activation audit for the current tenant',
  ...authzExtension('tenant.apps.read', 'GET', '/api/t/{tenantSlug}/apps/{pluginId}/audit'),
  request: { params: PluginTenantEnablementPathSchema },
  responses: { 200: { description: 'Tenant-scoped application audit', content: { 'application/json': { schema: pluginTenantApplicationAuditListV1Schema } } } },
});
registry.registerPath({
  method: 'get',
  path: '/api/t/{tenantSlug}/apps/{pluginId}/eligibility',
  summary: 'Read the safe effective eligibility projection for one tenant application',
  ...authzExtension('tenant.apps.read', 'GET', '/api/t/{tenantSlug}/apps/{pluginId}/eligibility'),
  request: { params: PluginTenantEnablementPathSchema },
  responses: {
    200: { description: 'Tenant-safe eligibility state without commercial or signature material', content: { 'application/json': { schema: pluginTenantEligibilityProjectionV1Schema } } },
    404: { description: 'Eligibility is unavailable' },
  },
});
for (const action of ['activate', 'deactivate'] as const) {
  registry.registerPath({
    method: 'post',
    path: `/api/t/{tenantSlug}/apps/{pluginId}/${action}`,
    summary: `${action === 'activate' ? 'Activate' : 'Deactivate'} an application for the current tenant`,
    ...authzExtension('tenant.apps.manage', 'POST', `/api/t/{tenantSlug}/apps/{pluginId}/${action}`),
    request: { params: PluginTenantEnablementPathSchema, body: { content: { 'application/json': { schema: pluginTenantApplicationMutationRequestV1Schema } } } },
    responses: { 200: { description: 'Updated tenant application state', content: { 'application/json': { schema: pluginTenantApplicationV1Schema } } }, 409: { description: 'Application state, policy, or revision conflict' } },
  });
}
registry.registerPath({
  method: 'post',
  path: '/api/t/{tenantSlug}/apps/{pluginId}/activation-request',
  summary: 'Request current-tenant application activation',
  ...authzExtension('tenant.apps.request', 'POST', '/api/t/{tenantSlug}/apps/{pluginId}/activation-request'),
  request: { params: PluginTenantEnablementPathSchema, body: { content: { 'application/json': { schema: pluginTenantApplicationMutationRequestV1Schema } } } },
  responses: { 200: { description: 'Pending activation request', content: { 'application/json': { schema: pluginTenantApplicationV1Schema } } }, 409: { description: 'Request policy or revision conflict' } },
});
registry.registerPath({
  method: 'post',
  path: '/api/t/{tenantSlug}/apps/{pluginId}/activation-request/decision',
  summary: 'Approve or reject a current-tenant activation request',
  ...authzExtension('tenant.apps.manage', 'POST', '/api/t/{tenantSlug}/apps/{pluginId}/activation-request/decision'),
  request: { params: PluginTenantEnablementPathSchema, body: { content: { 'application/json': { schema: pluginTenantApplicationDecisionRequestV1Schema } } } },
  responses: { 200: { description: 'Decided tenant application state', content: { 'application/json': { schema: pluginTenantApplicationV1Schema } } }, 409: { description: 'Request state, policy, or revision conflict' } },
});

// Admin Governance
registry.registerPath({
  method: 'get',
  path: '/api/admin/projects',
  ...authzExtension('platform.governance.read', 'GET', '/api/admin/projects'),
  request: { query: z.object({ search: z.string().optional() }) },
  responses: { 200: { description: 'Non-secret project candidates for governance and access-control administration', content: { 'application/json': { schema: z.array(GovernanceProjectSummarySchema) } } } },
});

registry.registerPath({
  method: 'get',
  path: '/api/admin/engines',
  ...authzExtension('platform.governance.read', 'GET', '/api/admin/engines'),
  request: { query: z.object({ search: z.string().optional() }) },
  responses: { 200: { description: 'Non-secret engine candidates for governance, SSO mapping, and access-control administration', content: { 'application/json': { schema: z.array(GovernanceEngineSummarySchema) } } } },
});

registry.registerPath({
  method: 'post',
  path: '/api/admin/projects/{projectId}/assign-owner',
  ...authzExtension('platform.governance.manage', 'POST', '/api/admin/projects/{projectId}/assign-owner'),
  request: { params: z.object({ projectId: z.string().uuid() }), body: { content: { 'application/json': { schema: AssignOwnerRequest } } } },
  responses: { 200: { description: 'Owner assigned', content: { 'application/json': { schema: SuccessResponseSchema } } }, 403: { description: 'Project access is SSO-managed or the caller lacks permission' } },
});

registry.registerPath({
  method: 'post',
  path: '/api/admin/projects/{projectId}/assign-delegate',
  ...authzExtension('platform.governance.manage', 'POST', '/api/admin/projects/{projectId}/assign-delegate'),
  request: { params: z.object({ projectId: z.string().uuid() }), body: { content: { 'application/json': { schema: AssignOwnerRequest } } } },
  responses: { 200: { description: 'Delegate assigned', content: { 'application/json': { schema: SuccessResponseSchema } } }, 403: { description: 'Project access is SSO-managed or the caller lacks permission' } },
});

registry.registerPath({
  method: 'post',
  path: '/api/admin/engines/{engineId}/assign-owner',
  ...authzExtension('platform.governance.manage', 'POST', '/api/admin/engines/{engineId}/assign-owner'),
  request: { params: z.object({ engineId: z.string() }), body: { content: { 'application/json': { schema: AssignOwnerRequest } } } },
  responses: { 200: { description: 'Owner assigned', content: { 'application/json': { schema: SuccessResponseSchema } } }, 403: { description: 'Engine access is SSO-managed or the caller lacks permission' } },
});

registry.registerPath({
  method: 'post',
  path: '/api/admin/engines/{engineId}/assign-delegate',
  ...authzExtension('platform.governance.manage', 'POST', '/api/admin/engines/{engineId}/assign-delegate'),
  request: { params: z.object({ engineId: z.string() }), body: { content: { 'application/json': { schema: AssignOwnerRequest } } } },
  responses: { 200: { description: 'Delegate assigned', content: { 'application/json': { schema: z.object({ success: z.boolean(), engineId: z.string(), delegateId: z.string().nullable(), previousDelegateId: z.string().nullable() }) } } }, 403: { description: 'Engine access is SSO-managed or the caller lacks permission' } },
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

// Provider-neutral identity providers. Configuration holds only references to
// secrets; the values behind those references are never returned by this API.
const TenantPathSchema = z.object({ tenantSlug: TenantSlugSchema });
const TenantIdPathSchema = z.object({ tenantId: z.string().min(1).max(160) });
const TenantMemberPathSchema = TenantPathSchema.extend({ userId: z.string().min(1) });
const TenantDomainPathSchema = TenantPathSchema.extend({ domainId: z.string().min(1) });
const TenantDiscoveryDomainPathSchema = TenantPathSchema.extend({ domainId: z.string().min(1) });
const TenantDomainCreateResponseSchema = z.object({
  domain: TenantDomainSchema,
  verificationToken: z.string(),
  dnsRecord: z.object({ name: z.string(), type: z.literal('TXT'), value: z.string() }),
});
const TenantDiscoveryDomainCreateResponseSchema = z.object({
  domain: TenantDiscoveryDomainSchema,
  verificationToken: z.string(),
  dnsRecord: z.object({ name: z.string(), type: z.literal('TXT'), value: z.string() }),
});

registry.register('NativeTenant', NativeTenantSchema);
registry.register('NativeTenantMembership', NativeTenantMembershipSchema);
registry.register('TenantLoginPolicy', TenantLoginPolicySchema);
registry.register('TenantDomain', TenantDomainSchema);
registry.register('TenantDiscoveryDomain', TenantDiscoveryDomainSchema);
registry.register('TenantDiscoveryResponse', TenantDiscoveryResponseSchema);
registry.register('TenancyCapabilities', TenancyCapabilitiesSchema);
registry.register('SignedTenantWorkloadReceipt', SignedTenantWorkloadReceiptSchema);
const TenantWorkloadHeadersSchema = z.object({
  'idempotency-key': z.string().min(16).max(200),
  'x-correlation-id': z.string().min(8).max(160),
});
registry.registerPath({
  method: 'get', path: '/api/tenancy/capabilities',
  ...authzExemption('GET', '/api/tenancy/capabilities'),
  responses: { 200: { description: 'Non-enumerating native tenancy capabilities', content: { 'application/json': { schema: TenancyCapabilitiesSchema } } } },
});
registry.registerPath({
  method: 'get', path: '/api/workloads/tenancy/capabilities',
  ...authzExtension('platform.tenants.workload.capabilities.read', 'GET', '/api/workloads/tenancy/capabilities'),
  responses: { 200: { description: 'Authenticated shard tenancy and workload receipt capabilities', content: { 'application/json': { schema: TenancyCapabilitiesSchema } } }, 401: { description: 'A tenant-lifecycle service account is required' } },
});
registry.registerPath({
  method: 'post', path: '/api/workloads/tenants',
  ...authzExtension('platform.tenants.workload.provision', 'POST', '/api/workloads/tenants'),
  request: { headers: TenantWorkloadHeadersSchema, body: { content: { 'application/json': { schema: TenantWorkloadCreateRequestSchema } } } },
  responses: { 201: { description: 'Tenant provisioned with a signed, idempotent workload receipt', content: { 'application/json': { schema: SignedTenantWorkloadReceiptSchema } } }, 409: { description: 'Idempotency or tenant slug conflict' } },
});
registry.registerPath({
  method: 'post', path: '/api/workloads/tenants/{tenantId}/suspend',
  ...authzExtension('platform.tenants.workload.lifecycle', 'POST', '/api/workloads/tenants/{tenantId}/suspend'),
  request: { params: TenantIdPathSchema, headers: TenantWorkloadHeadersSchema, body: { content: { 'application/json': { schema: TenantWorkloadEpochRequestSchema } } } },
  responses: { 200: { description: 'Tenant suspended with a signed, idempotent workload receipt', content: { 'application/json': { schema: SignedTenantWorkloadReceiptSchema } } }, 409: { description: 'Idempotency or placement epoch conflict' } },
});
registry.registerPath({
  method: 'post', path: '/api/workloads/tenants/{tenantId}/resume',
  ...authzExtension('platform.tenants.workload.lifecycle', 'POST', '/api/workloads/tenants/{tenantId}/resume'),
  request: { params: TenantIdPathSchema, headers: TenantWorkloadHeadersSchema, body: { content: { 'application/json': { schema: TenantWorkloadEpochRequestSchema } } } },
  responses: { 200: { description: 'Tenant resumed with a signed, idempotent workload receipt', content: { 'application/json': { schema: SignedTenantWorkloadReceiptSchema } } }, 409: { description: 'Idempotency or placement epoch conflict' } },
});
registry.registerPath({
  method: 'post', path: '/api/workloads/tenants/{tenantId}/identity-provider-secret-reference',
  ...authzExtension('platform.tenants.workload.lifecycle', 'POST', '/api/workloads/tenants/{tenantId}/identity-provider-secret-reference'),
  request: { params: TenantIdPathSchema, headers: TenantWorkloadHeadersSchema, body: { content: { 'application/json': { schema: TenantWorkloadSecretBreakGlassRequestSchema } } } },
  responses: {
    200: { description: 'Audited break-glass reference applied with a signed, idempotent receipt; no secret material is returned', content: { 'application/json': { schema: SignedTenantWorkloadReceiptSchema } } },
    403: { description: 'Break-glass recovery is disabled' },
    409: { description: 'Idempotency or placement epoch conflict' },
    503: { description: 'The independently mounted recovery reference is unavailable' },
  },
});
registry.registerPath({
  method: 'put', path: '/api/workloads/tenants/{tenantId}/apps/{pluginId}/eligibility',
  summary: 'Apply a signed tenant application eligibility projection',
  ...authzExtension('platform.tenants.workload.lifecycle', 'PUT', '/api/workloads/tenants/{tenantId}/apps/{pluginId}/eligibility'),
  request: {
    params: TenantIdPathSchema.extend(PluginIdPathSchema.shape),
    body: { content: { 'application/json': { schema: pluginTenantEligibilityApplyRequestV1Schema } } },
  },
  responses: {
    200: { description: 'Verified safe eligibility projection applied idempotently', content: { 'application/json': { schema: pluginTenantEligibilityProjectionV1Schema } } },
    400: { description: 'Projection or signature is invalid' },
    409: { description: 'Projection scope, revision, or eligibility state conflicts' },
    503: { description: 'Eligibility verification is not configured' },
  },
});
registry.registerPath({
  method: 'put', path: '/api/workloads/tenants/{tenantId}/routing-aliases',
  ...authzExtension('platform.tenants.workload.aliases.reconcile', 'PUT', '/api/workloads/tenants/{tenantId}/routing-aliases'),
  request: { params: TenantIdPathSchema, headers: TenantWorkloadHeadersSchema, body: { content: { 'application/json': { schema: TenantWorkloadAliasReconcileRequestSchema } } } },
  responses: { 200: { description: 'Tenant routing aliases reconciled with a signed, idempotent workload receipt', content: { 'application/json': { schema: SignedTenantWorkloadReceiptSchema } } }, 409: { description: 'Idempotency, alias ownership, or placement epoch conflict' } },
});
registry.registerPath({
  method: 'post', path: '/api/auth/tenant-discovery',
  ...authzExemption('POST', '/api/auth/tenant-discovery'),
  request: { body: { content: { 'application/json': { schema: TenantDiscoveryRequestSchema } } } },
  responses: { 200: { description: 'One verified tenant route or the common email-verification fallback', content: { 'application/json': { schema: TenantDiscoveryResponseSchema } } } },
});
registry.registerPath({
  method: 'post', path: '/api/auth/tenant-discovery/exchange',
  ...authzExemption('POST', '/api/auth/tenant-discovery/exchange'),
  request: { body: { content: { 'application/json': { schema: TenantDiscoveryExchangeRequestSchema } } } },
  responses: { 200: { description: 'Active memberships after consuming a valid single-use email token', content: { 'application/json': { schema: TenantDiscoveryExchangeResponseSchema } } }, 400: { description: 'Invalid, expired, or already consumed token' } },
});
registry.registerPath({
  method: 'get', path: '/api/auth/my-tenants',
  ...authzExemption('GET', '/api/auth/my-tenants'),
  responses: { 200: { description: 'Active tenant memberships for the authenticated principal', content: { 'application/json': { schema: z.array(NativeTenantMembershipSchema) } } } },
});
registry.registerPath({
  method: 'post', path: '/api/auth/switch-tenant',
  ...authzExemption('POST', '/api/auth/switch-tenant'),
  request: { body: { content: { 'application/json': { schema: z.object({ tenantSlug: TenantSlugSchema }) } } } },
  responses: { 200: { description: 'Tenant-bound replacement session issued', content: { 'application/json': { schema: z.object({ tenantId: z.string(), tenantSlug: TenantSlugSchema }) } } }, 403: { description: 'Active target-tenant membership is required' } },
});
registry.registerPath({
  method: 'get', path: '/api/platform/tenants',
  ...authzExtension('platform.tenants.read', 'GET', '/api/platform/tenants'),
  responses: { 200: { description: 'Native tenant lifecycle records', content: { 'application/json': { schema: z.array(NativeTenantSchema) } } } },
});
registry.registerPath({
  method: 'post', path: '/api/platform/tenants',
  ...authzExtension('platform.tenants.manage', 'POST', '/api/platform/tenants'),
  request: { body: { content: { 'application/json': { schema: TenantCreateRequestSchema } } } },
  responses: { 201: { description: 'Tenant created with its first administrator', content: { 'application/json': { schema: NativeTenantSchema } } }, 409: { description: 'Slug already exists or deployment is in single mode' } },
});
registry.registerPath({
  method: 'patch', path: '/api/platform/tenants/{tenantId}',
  ...authzExtension('platform.tenants.manage', 'PATCH', '/api/platform/tenants/{tenantId}'),
  request: { params: TenantIdPathSchema, body: { content: { 'application/json': { schema: TenantUpdateRequestSchema } } } },
  responses: { 200: { description: 'Tenant lifecycle or placement state updated', content: { 'application/json': { schema: NativeTenantSchema } } }, 409: { description: 'Placement epoch conflict or protected default-tenant transition' } },
});
registry.registerPath({
  method: 'get', path: '/api/t/{tenantSlug}/tenant',
  ...authzExtension('tenant.settings.read', 'GET', '/api/t/{tenantSlug}/tenant'),
  request: { params: TenantPathSchema }, responses: { 200: { description: 'Current tenant profile', content: { 'application/json': { schema: NativeTenantSchema } } } },
});
registry.registerPath({
  method: 'get', path: '/api/t/{tenantSlug}/tenant/login-policy',
  ...authzExtension('tenant.settings.manage', 'GET', '/api/t/{tenantSlug}/tenant/login-policy'),
  request: { params: TenantPathSchema }, responses: { 200: { description: 'Current tenant login policy', content: { 'application/json': { schema: TenantLoginPolicySchema } } } },
});
registry.registerPath({
  method: 'put', path: '/api/t/{tenantSlug}/tenant/login-policy',
  ...authzExtension('tenant.settings.manage', 'PUT', '/api/t/{tenantSlug}/tenant/login-policy'),
  request: { params: TenantPathSchema, body: { content: { 'application/json': { schema: TenantLoginPolicySchema } } } },
  responses: { 200: { description: 'Tenant login policy updated', content: { 'application/json': { schema: TenantLoginPolicySchema } } } },
});
registry.registerPath({
  method: 'get', path: '/api/t/{tenantSlug}/tenant/domains',
  ...authzExtension('tenant.settings.manage', 'GET', '/api/t/{tenantSlug}/tenant/domains'),
  request: { params: TenantPathSchema }, responses: { 200: { description: 'Tenant custom domains', content: { 'application/json': { schema: z.array(TenantDomainSchema) } } } },
});
registry.registerPath({
  method: 'post', path: '/api/t/{tenantSlug}/tenant/domains',
  ...authzExtension('tenant.settings.manage', 'POST', '/api/t/{tenantSlug}/tenant/domains'),
  request: { params: TenantPathSchema, body: { content: { 'application/json': { schema: TenantDomainCreateRequestSchema } } } },
  responses: { 201: { description: 'Pending tenant domain with reveal-once DNS token', content: { 'application/json': { schema: TenantDomainCreateResponseSchema } } } },
});
registry.registerPath({
  method: 'post', path: '/api/t/{tenantSlug}/tenant/domains/{domainId}/verify',
  ...authzExtension('tenant.settings.manage', 'POST', '/api/t/{tenantSlug}/tenant/domains/{domainId}/verify'),
  request: { params: TenantDomainPathSchema, body: { content: { 'application/json': { schema: TenantDomainVerifyRequestSchema } } } },
  responses: { 200: { description: 'Verified tenant domain', content: { 'application/json': { schema: TenantDomainSchema } } }, 409: { description: 'DNS verification record was not found or did not match' } },
});
registry.registerPath({
  method: 'get', path: '/api/t/{tenantSlug}/tenant/discovery-domains',
  ...authzExtension('tenant.settings.manage', 'GET', '/api/t/{tenantSlug}/tenant/discovery-domains'),
  request: { params: TenantPathSchema },
  responses: { 200: { description: 'Tenant work-email discovery domains', content: { 'application/json': { schema: z.array(TenantDiscoveryDomainSchema) } } } },
});
registry.registerPath({
  method: 'post', path: '/api/t/{tenantSlug}/tenant/discovery-domains',
  ...authzExtension('tenant.settings.manage', 'POST', '/api/t/{tenantSlug}/tenant/discovery-domains'),
  request: { params: TenantPathSchema, body: { content: { 'application/json': { schema: TenantDiscoveryDomainCreateRequestSchema } } } },
  responses: { 201: { description: 'Pending work-email discovery domain with reveal-once DNS token', content: { 'application/json': { schema: TenantDiscoveryDomainCreateResponseSchema } } } },
});
registry.registerPath({
  method: 'post', path: '/api/t/{tenantSlug}/tenant/discovery-domains/{domainId}/verify',
  ...authzExtension('tenant.settings.manage', 'POST', '/api/t/{tenantSlug}/tenant/discovery-domains/{domainId}/verify'),
  request: { params: TenantDiscoveryDomainPathSchema, body: { content: { 'application/json': { schema: TenantDiscoveryDomainVerifyRequestSchema } } } },
  responses: { 200: { description: 'Verified work-email discovery domain', content: { 'application/json': { schema: TenantDiscoveryDomainSchema } } }, 409: { description: 'DNS verification record was not found or did not match' } },
});
registry.registerPath({
  method: 'delete', path: '/api/t/{tenantSlug}/tenant/discovery-domains/{domainId}',
  ...authzExtension('tenant.settings.manage', 'DELETE', '/api/t/{tenantSlug}/tenant/discovery-domains/{domainId}'),
  request: { params: TenantDiscoveryDomainPathSchema },
  responses: { 204: { description: 'Organization discovery disabled for this domain' } },
});
registry.registerPath({
  method: 'get', path: '/api/t/{tenantSlug}/tenant/members',
  ...authzExtension('tenant.members.manage', 'GET', '/api/t/{tenantSlug}/tenant/members'),
  request: { params: TenantPathSchema }, responses: { 200: { description: 'Current tenant members', content: { 'application/json': { schema: z.array(TenantMemberSchema) } } } },
});
registry.registerPath({
  method: 'put', path: '/api/t/{tenantSlug}/tenant/members/{userId}',
  ...authzExtension('tenant.members.manage', 'PUT', '/api/t/{tenantSlug}/tenant/members/{userId}'),
  request: { params: TenantMemberPathSchema, body: { content: { 'application/json': { schema: TenantMemberUpsertRequestSchema.omit({ userId: true }) } } } },
  responses: { 204: { description: 'Tenant member role granted' } },
});
registry.registerPath({
  method: 'delete', path: '/api/t/{tenantSlug}/tenant/members/{userId}',
  ...authzExtension('tenant.members.manage', 'DELETE', '/api/t/{tenantSlug}/tenant/members/{userId}'),
  request: { params: TenantMemberPathSchema }, responses: { 204: { description: 'Tenant membership removed' }, 409: { description: 'The tenant must retain at least one administrator' } },
});

const identityProviderMigrationSchemas = await import('./platform-admin/authz.js');
registry.register('IdentityProvider', identityProviderMigrationSchemas.IdentityProviderResponseSchema);
registry.registerPath({
  method: 'get',
  path: '/api/identity/providers',
  ...authzExtension('platform.sso.providers.read', 'GET', '/api/identity/providers'),
  responses: { 200: { description: 'List identity providers', content: { 'application/json': { schema: z.array(identityProviderMigrationSchemas.IdentityProviderResponseSchema) } } } },
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
const IdentityProviderSecretPathSchema = z.object({
  key: z.string().min(1).max(128),
  purpose: identityProviderMigrationSchemas.TenantIdentitySecretPurposeSchema,
});
registry.registerPath({
  method: 'post', path: '/api/identity/provider-secrets',
  ...authzExtension('platform.sso.providers.manage', 'POST', '/api/identity/provider-secrets'),
  request: { body: { content: { 'application/json': { schema: identityProviderMigrationSchemas.TenantIdentitySecretProvisionRequestSchema } } } },
  responses: { 400: { description: 'A tenant-scoped route is required for secret provisioning' } },
});
registry.registerPath({
  method: 'post', path: '/api/identity/provider-secrets/retire',
  ...authzExtension('platform.sso.providers.manage', 'POST', '/api/identity/provider-secrets/retire'),
  request: { body: { content: { 'application/json': { schema: identityProviderMigrationSchemas.TenantIdentitySecretReferenceRetireRequestSchema } } } },
  responses: { 400: { description: 'A tenant-scoped route is required for secret retirement' } },
});
registry.registerPath({
  method: 'put', path: '/api/identity/providers/{key}/secrets/{purpose}',
  ...authzExtension('platform.sso.providers.manage', 'PUT', '/api/identity/providers/{key}/secrets/{purpose}'),
  request: { params: IdentityProviderSecretPathSchema, body: { content: { 'application/json': { schema: identityProviderMigrationSchemas.TenantIdentitySecretPutRequestSchema } } } },
  responses: { 400: { description: 'A tenant-scoped route is required for secret rotation' } },
});
registry.registerPath({
  method: 'get', path: '/api/identity/providers/{key}/secrets/{purpose}/availability',
  ...authzExtension('platform.sso.providers.manage', 'GET', '/api/identity/providers/{key}/secrets/{purpose}/availability'),
  request: { params: IdentityProviderSecretPathSchema },
  responses: { 400: { description: 'A tenant-scoped route is required for secret availability checks' } },
});
registry.registerPath({
  method: 'post', path: '/api/identity/providers/{key}/secrets/{purpose}/retire',
  ...authzExtension('platform.sso.providers.manage', 'POST', '/api/identity/providers/{key}/secrets/{purpose}/retire'),
  request: { params: IdentityProviderSecretPathSchema, body: { content: { 'application/json': { schema: identityProviderMigrationSchemas.TenantIdentitySecretRetireRequestSchema } } } },
  responses: { 400: { description: 'A tenant-scoped route is required for secret retirement' } },
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
  responses: { 200: { description: 'Protocol-specific identity provider reachability result; OIDC/SAML metadata checks do not prove a complete sign-in', content: { 'application/json': { schema: identityProviderMigrationSchemas.IdentityProviderConnectionTestResponseSchema } } }, 404: { description: 'Identity provider not found' } },
});
registry.registerPath({
  method: 'delete',
  path: '/api/identity/providers/{key}',
  ...authzExtension('platform.sso.providers.manage', 'DELETE', '/api/identity/providers/{key}'),
  request: { params: z.object({ key: z.string() }) },
  responses: { 204: { description: 'Identity provider archived' }, 404: { description: 'Identity provider not found' } },
});

// The tenant aliases expose the same provider-neutral schemas while changing
// both the FGA action and the durable tenant scope.
const TenantProviderPathSchema = TenantPathSchema.extend({ key: z.string().min(1).max(128) });
const TenantProviderRunPathSchema = TenantProviderPathSchema.extend({ runId: z.string().min(1).max(128) });
const TenantProviderSecretPathSchema = TenantProviderPathSchema.extend({ purpose: identityProviderMigrationSchemas.TenantIdentitySecretPurposeSchema });
registry.registerPath({ method: 'get', path: '/api/t/{tenantSlug}/identity/providers', ...authzExtension('tenant.sso.providers.read', 'GET', '/api/t/{tenantSlug}/identity/providers'), request: { params: TenantPathSchema }, responses: { 200: { description: 'Identity providers owned by the current tenant', content: { 'application/json': { schema: z.array(identityProviderMigrationSchemas.IdentityProviderResponseSchema) } } } } });
registry.registerPath({ method: 'post', path: '/api/t/{tenantSlug}/identity/provider-secrets', ...authzExtension('tenant.sso.providers.manage', 'POST', '/api/t/{tenantSlug}/identity/provider-secrets'), request: { params: TenantPathSchema, body: { content: { 'application/json': { schema: identityProviderMigrationSchemas.TenantIdentitySecretProvisionRequestSchema } } } }, responses: { 201: { description: 'Tenant-bound secret provisioned without returning its value', content: { 'application/json': { schema: identityProviderMigrationSchemas.TenantIdentitySecretMetadataResponseSchema } } }, 503: { description: 'Tenant secret broker unavailable' } } });
registry.registerPath({ method: 'post', path: '/api/t/{tenantSlug}/identity/provider-secrets/retire', ...authzExtension('tenant.sso.providers.manage', 'POST', '/api/t/{tenantSlug}/identity/provider-secrets/retire'), request: { params: TenantPathSchema, body: { content: { 'application/json': { schema: identityProviderMigrationSchemas.TenantIdentitySecretReferenceRetireRequestSchema } } } }, responses: { 200: { description: 'Unattached tenant-bound secret retired', content: { 'application/json': { schema: identityProviderMigrationSchemas.TenantIdentitySecretRetireResponseSchema } } } } });
registry.registerPath({ method: 'get', path: '/api/t/{tenantSlug}/identity/providers/{key}', ...authzExtension('tenant.sso.providers.read', 'GET', '/api/t/{tenantSlug}/identity/providers/{key}'), request: { params: TenantProviderPathSchema }, responses: { 200: { description: 'Current tenant identity provider', content: { 'application/json': { schema: identityProviderMigrationSchemas.IdentityProviderResponseSchema } } }, 404: { description: 'Identity provider not found in this tenant' } } });
registry.registerPath({ method: 'get', path: '/api/t/{tenantSlug}/identity/providers/{key}/sync-runs', ...authzExtension('tenant.sso.providers.read', 'GET', '/api/t/{tenantSlug}/identity/providers/{key}/sync-runs'), request: { params: TenantProviderPathSchema, query: identityProviderDiagnosticSchemas.IdentityProviderSyncRunsQuerySchema }, responses: { 200: { description: 'Current tenant provider synchronization runs', content: { 'application/json': { schema: z.array(identityProviderDiagnosticSchemas.SsoSyncRunSchema) } } } } });
registry.registerPath({ method: 'get', path: '/api/t/{tenantSlug}/identity/providers/{key}/sync-runs/{runId}/events', ...authzExtension('tenant.sso.providers.read', 'GET', '/api/t/{tenantSlug}/identity/providers/{key}/sync-runs/{runId}/events'), request: { params: TenantProviderRunPathSchema, query: identityProviderDiagnosticSchemas.IdentityProviderSyncEventsQuerySchema }, responses: { 200: { description: 'Current tenant provider synchronization events', content: { 'application/json': { schema: z.array(identityProviderDiagnosticSchemas.SsoSyncEventSchema) } } } } });
registry.registerPath({ method: 'post', path: '/api/t/{tenantSlug}/identity/providers', ...authzExtension('tenant.sso.providers.manage', 'POST', '/api/t/{tenantSlug}/identity/providers'), request: { params: TenantPathSchema, body: { content: { 'application/json': { schema: identityProviderMigrationSchemas.IdentityProviderRequestSchema } } } }, responses: { 201: { description: 'Tenant identity provider created', content: { 'application/json': { schema: identityProviderMigrationSchemas.IdentityProviderResponseSchema } } } } });
registry.registerPath({ method: 'post', path: '/api/t/{tenantSlug}/identity/providers/{key}/external-identities/unlink', ...authzExtension('tenant.sso.providers.manage', 'POST', '/api/t/{tenantSlug}/identity/providers/{key}/external-identities/unlink'), request: { params: TenantProviderPathSchema, body: { content: { 'application/json': { schema: identityProviderMigrationSchemas.IdentityProviderExternalIdentityUnlinkRequestSchema } } } }, responses: { 200: { description: 'Tenant provider subject unlinked', content: { 'application/json': { schema: identityProviderMigrationSchemas.IdentityProviderExternalIdentityUnlinkResponseSchema } } } } });
registry.registerPath({ method: 'put', path: '/api/t/{tenantSlug}/identity/providers/{key}/secrets/{purpose}', ...authzExtension('tenant.sso.providers.manage', 'PUT', '/api/t/{tenantSlug}/identity/providers/{key}/secrets/{purpose}'), request: { params: TenantProviderSecretPathSchema, body: { content: { 'application/json': { schema: identityProviderMigrationSchemas.TenantIdentitySecretPutRequestSchema } } } }, responses: { 200: { description: 'Provider secret rotated without returning its value', content: { 'application/json': { schema: identityProviderMigrationSchemas.TenantIdentitySecretMetadataResponseSchema } } }, 503: { description: 'Tenant secret broker unavailable' } } });
registry.registerPath({ method: 'get', path: '/api/t/{tenantSlug}/identity/providers/{key}/secrets/{purpose}/availability', ...authzExtension('tenant.sso.providers.manage', 'GET', '/api/t/{tenantSlug}/identity/providers/{key}/secrets/{purpose}/availability'), request: { params: TenantProviderSecretPathSchema }, responses: { 200: { description: 'Secret availability metadata without secret material', content: { 'application/json': { schema: identityProviderMigrationSchemas.TenantIdentitySecretAvailabilityResponseSchema } } } } });
registry.registerPath({ method: 'post', path: '/api/t/{tenantSlug}/identity/providers/{key}/secrets/{purpose}/retire', ...authzExtension('tenant.sso.providers.manage', 'POST', '/api/t/{tenantSlug}/identity/providers/{key}/secrets/{purpose}/retire'), request: { params: TenantProviderSecretPathSchema, body: { content: { 'application/json': { schema: identityProviderMigrationSchemas.TenantIdentitySecretRetireRequestSchema } } } }, responses: { 200: { description: 'Secret retired after the provider is disabled', content: { 'application/json': { schema: identityProviderMigrationSchemas.TenantIdentitySecretRetireResponseSchema } } } } });
registry.registerPath({ method: 'put', path: '/api/t/{tenantSlug}/identity/providers/{key}', ...authzExtension('tenant.sso.providers.manage', 'PUT', '/api/t/{tenantSlug}/identity/providers/{key}'), request: { params: TenantProviderPathSchema, body: { content: { 'application/json': { schema: identityProviderMigrationSchemas.IdentityProviderUpdateSchema } } } }, responses: { 200: { description: 'Tenant identity provider updated', content: { 'application/json': { schema: identityProviderMigrationSchemas.IdentityProviderResponseSchema } } } } });
registry.registerPath({ method: 'post', path: '/api/t/{tenantSlug}/identity/providers/{key}/reconcile', ...authzExtension('tenant.sso.providers.manage', 'POST', '/api/t/{tenantSlug}/identity/providers/{key}/reconcile'), request: { params: TenantProviderPathSchema }, responses: { 200: { description: 'Tenant LDAP provider reconciliation page', content: { 'application/json': { schema: z.object({ skipped: z.string().optional(), processed: z.number().int().optional(), runId: z.string().nullable().optional() }) } } } } });
registry.registerPath({ method: 'post', path: '/api/t/{tenantSlug}/identity/providers/{key}/reconciliation-preview', ...authzExtension('tenant.sso.providers.manage', 'POST', '/api/t/{tenantSlug}/identity/providers/{key}/reconciliation-preview'), request: { params: TenantProviderPathSchema, body: { content: { 'application/json': { schema: identityProviderDiagnosticSchemas.IdentityProviderMembershipReplayRequestSchema } } } }, responses: { 200: { description: 'Tenant provider membership preview', content: { 'application/json': { schema: identityProviderDiagnosticSchemas.IdentityProviderReconciliationPreviewSchema } } } } });
registry.registerPath({ method: 'post', path: '/api/t/{tenantSlug}/identity/providers/{key}/replay-memberships', ...authzExtension('tenant.sso.providers.manage', 'POST', '/api/t/{tenantSlug}/identity/providers/{key}/replay-memberships'), request: { params: TenantProviderPathSchema, body: { content: { 'application/json': { schema: identityProviderDiagnosticSchemas.IdentityProviderMembershipReplayRequestSchema } } } }, responses: { 200: { description: 'Tenant provider membership replay', content: { 'application/json': { schema: identityProviderDiagnosticSchemas.IdentityProviderMembershipReplayResponseSchema } } } } });
registry.registerPath({ method: 'post', path: '/api/t/{tenantSlug}/identity/providers/{key}/test-connection', ...authzExtension('tenant.sso.providers.manage', 'POST', '/api/t/{tenantSlug}/identity/providers/{key}/test-connection'), request: { params: TenantProviderPathSchema }, responses: { 200: { description: 'Tenant identity provider connection test', content: { 'application/json': { schema: identityProviderMigrationSchemas.IdentityProviderConnectionTestResponseSchema } } } } });
registry.registerPath({ method: 'delete', path: '/api/t/{tenantSlug}/identity/providers/{key}', ...authzExtension('tenant.sso.providers.manage', 'DELETE', '/api/t/{tenantSlug}/identity/providers/{key}'), request: { params: TenantProviderPathSchema }, responses: { 204: { description: 'Tenant identity provider disabled' } } });

// Retain the established tenant-prefixed provider aliases for clients that
// adopted unified tenant routing before the canonical /api/t contract existed.
registry.registerPath({ method: 'get', path: '/t/{tenantSlug}/api/identity/providers', ...authzExtension('tenant.sso.providers.read', 'GET', '/t/{tenantSlug}/api/identity/providers'), request: { params: TenantPathSchema }, responses: { 200: { description: 'Backward-compatible alias for tenant identity providers', content: { 'application/json': { schema: z.array(identityProviderMigrationSchemas.IdentityProviderResponseSchema) } } } } });
registry.registerPath({ method: 'post', path: '/t/{tenantSlug}/api/identity/provider-secrets', ...authzExtension('tenant.sso.providers.manage', 'POST', '/t/{tenantSlug}/api/identity/provider-secrets'), request: { params: TenantPathSchema, body: { content: { 'application/json': { schema: identityProviderMigrationSchemas.TenantIdentitySecretProvisionRequestSchema } } } }, responses: { 201: { description: 'Backward-compatible alias for tenant secret provisioning', content: { 'application/json': { schema: identityProviderMigrationSchemas.TenantIdentitySecretMetadataResponseSchema } } } } });
registry.registerPath({ method: 'post', path: '/t/{tenantSlug}/api/identity/provider-secrets/retire', ...authzExtension('tenant.sso.providers.manage', 'POST', '/t/{tenantSlug}/api/identity/provider-secrets/retire'), request: { params: TenantPathSchema, body: { content: { 'application/json': { schema: identityProviderMigrationSchemas.TenantIdentitySecretReferenceRetireRequestSchema } } } }, responses: { 200: { description: 'Backward-compatible alias for unattached tenant secret retirement', content: { 'application/json': { schema: identityProviderMigrationSchemas.TenantIdentitySecretRetireResponseSchema } } } } });
registry.registerPath({ method: 'get', path: '/t/{tenantSlug}/api/identity/providers/{key}', ...authzExtension('tenant.sso.providers.read', 'GET', '/t/{tenantSlug}/api/identity/providers/{key}'), request: { params: TenantProviderPathSchema }, responses: { 200: { description: 'Current tenant identity provider', content: { 'application/json': { schema: identityProviderMigrationSchemas.IdentityProviderResponseSchema } } }, 404: { description: 'Identity provider not found in this tenant' } } });
registry.registerPath({ method: 'get', path: '/t/{tenantSlug}/api/identity/providers/{key}/sync-runs', ...authzExtension('tenant.sso.providers.read', 'GET', '/t/{tenantSlug}/api/identity/providers/{key}/sync-runs'), request: { params: TenantProviderPathSchema, query: identityProviderDiagnosticSchemas.IdentityProviderSyncRunsQuerySchema }, responses: { 200: { description: 'Current tenant provider synchronization runs', content: { 'application/json': { schema: z.array(identityProviderDiagnosticSchemas.SsoSyncRunSchema) } } } } });
registry.registerPath({ method: 'get', path: '/t/{tenantSlug}/api/identity/providers/{key}/sync-runs/{runId}/events', ...authzExtension('tenant.sso.providers.read', 'GET', '/t/{tenantSlug}/api/identity/providers/{key}/sync-runs/{runId}/events'), request: { params: TenantProviderRunPathSchema, query: identityProviderDiagnosticSchemas.IdentityProviderSyncEventsQuerySchema }, responses: { 200: { description: 'Current tenant provider synchronization events', content: { 'application/json': { schema: z.array(identityProviderDiagnosticSchemas.SsoSyncEventSchema) } } } } });
registry.registerPath({ method: 'post', path: '/t/{tenantSlug}/api/identity/providers', ...authzExtension('tenant.sso.providers.manage', 'POST', '/t/{tenantSlug}/api/identity/providers'), request: { params: TenantPathSchema, body: { content: { 'application/json': { schema: identityProviderMigrationSchemas.IdentityProviderRequestSchema } } } }, responses: { 201: { description: 'Tenant identity provider created', content: { 'application/json': { schema: identityProviderMigrationSchemas.IdentityProviderResponseSchema } } } } });
registry.registerPath({ method: 'post', path: '/t/{tenantSlug}/api/identity/providers/{key}/external-identities/unlink', ...authzExtension('tenant.sso.providers.manage', 'POST', '/t/{tenantSlug}/api/identity/providers/{key}/external-identities/unlink'), request: { params: TenantProviderPathSchema, body: { content: { 'application/json': { schema: identityProviderMigrationSchemas.IdentityProviderExternalIdentityUnlinkRequestSchema } } } }, responses: { 200: { description: 'Tenant provider subject unlinked', content: { 'application/json': { schema: identityProviderMigrationSchemas.IdentityProviderExternalIdentityUnlinkResponseSchema } } } } });
registry.registerPath({ method: 'put', path: '/t/{tenantSlug}/api/identity/providers/{key}/secrets/{purpose}', ...authzExtension('tenant.sso.providers.manage', 'PUT', '/t/{tenantSlug}/api/identity/providers/{key}/secrets/{purpose}'), request: { params: TenantProviderSecretPathSchema, body: { content: { 'application/json': { schema: identityProviderMigrationSchemas.TenantIdentitySecretPutRequestSchema } } } }, responses: { 200: { description: 'Backward-compatible alias for provider secret rotation', content: { 'application/json': { schema: identityProviderMigrationSchemas.TenantIdentitySecretMetadataResponseSchema } } } } });
registry.registerPath({ method: 'get', path: '/t/{tenantSlug}/api/identity/providers/{key}/secrets/{purpose}/availability', ...authzExtension('tenant.sso.providers.manage', 'GET', '/t/{tenantSlug}/api/identity/providers/{key}/secrets/{purpose}/availability'), request: { params: TenantProviderSecretPathSchema }, responses: { 200: { description: 'Backward-compatible alias for provider secret availability', content: { 'application/json': { schema: identityProviderMigrationSchemas.TenantIdentitySecretAvailabilityResponseSchema } } } } });
registry.registerPath({ method: 'post', path: '/t/{tenantSlug}/api/identity/providers/{key}/secrets/{purpose}/retire', ...authzExtension('tenant.sso.providers.manage', 'POST', '/t/{tenantSlug}/api/identity/providers/{key}/secrets/{purpose}/retire'), request: { params: TenantProviderSecretPathSchema, body: { content: { 'application/json': { schema: identityProviderMigrationSchemas.TenantIdentitySecretRetireRequestSchema } } } }, responses: { 200: { description: 'Backward-compatible alias for provider secret retirement', content: { 'application/json': { schema: identityProviderMigrationSchemas.TenantIdentitySecretRetireResponseSchema } } } } });
registry.registerPath({ method: 'put', path: '/t/{tenantSlug}/api/identity/providers/{key}', ...authzExtension('tenant.sso.providers.manage', 'PUT', '/t/{tenantSlug}/api/identity/providers/{key}'), request: { params: TenantProviderPathSchema, body: { content: { 'application/json': { schema: identityProviderMigrationSchemas.IdentityProviderUpdateSchema } } } }, responses: { 200: { description: 'Tenant identity provider updated', content: { 'application/json': { schema: identityProviderMigrationSchemas.IdentityProviderResponseSchema } } } } });
registry.registerPath({ method: 'post', path: '/t/{tenantSlug}/api/identity/providers/{key}/reconcile', ...authzExtension('tenant.sso.providers.manage', 'POST', '/t/{tenantSlug}/api/identity/providers/{key}/reconcile'), request: { params: TenantProviderPathSchema }, responses: { 200: { description: 'Tenant LDAP provider reconciliation page', content: { 'application/json': { schema: z.object({ skipped: z.string().optional(), processed: z.number().int().optional(), runId: z.string().nullable().optional() }) } } } } });
registry.registerPath({ method: 'post', path: '/t/{tenantSlug}/api/identity/providers/{key}/reconciliation-preview', ...authzExtension('tenant.sso.providers.manage', 'POST', '/t/{tenantSlug}/api/identity/providers/{key}/reconciliation-preview'), request: { params: TenantProviderPathSchema, body: { content: { 'application/json': { schema: identityProviderDiagnosticSchemas.IdentityProviderMembershipReplayRequestSchema } } } }, responses: { 200: { description: 'Tenant provider membership preview', content: { 'application/json': { schema: identityProviderDiagnosticSchemas.IdentityProviderReconciliationPreviewSchema } } } } });
registry.registerPath({ method: 'post', path: '/t/{tenantSlug}/api/identity/providers/{key}/replay-memberships', ...authzExtension('tenant.sso.providers.manage', 'POST', '/t/{tenantSlug}/api/identity/providers/{key}/replay-memberships'), request: { params: TenantProviderPathSchema, body: { content: { 'application/json': { schema: identityProviderDiagnosticSchemas.IdentityProviderMembershipReplayRequestSchema } } } }, responses: { 200: { description: 'Tenant provider membership replay', content: { 'application/json': { schema: identityProviderDiagnosticSchemas.IdentityProviderMembershipReplayResponseSchema } } } } });
registry.registerPath({ method: 'post', path: '/t/{tenantSlug}/api/identity/providers/{key}/test-connection', ...authzExtension('tenant.sso.providers.manage', 'POST', '/t/{tenantSlug}/api/identity/providers/{key}/test-connection'), request: { params: TenantProviderPathSchema }, responses: { 200: { description: 'Tenant identity provider connection test', content: { 'application/json': { schema: identityProviderMigrationSchemas.IdentityProviderConnectionTestResponseSchema } } } } });
registry.registerPath({ method: 'delete', path: '/t/{tenantSlug}/api/identity/providers/{key}', ...authzExtension('tenant.sso.providers.manage', 'DELETE', '/t/{tenantSlug}/api/identity/providers/{key}'), request: { params: TenantProviderPathSchema }, responses: { 204: { description: 'Tenant identity provider archived' } } });

// Authoritative provisioning directories are deliberately separate from
// sign-in providers. Credential responses expose token material only on create
// or rotate; all list/read contracts contain metadata and fingerprints only.
const ProvisioningDirectoryParamsSchema = z.object({ key: IdentityProvisioningDirectoryKeySchema });
const ProvisioningCredentialParamsSchema = ProvisioningDirectoryParamsSchema.extend({ credentialId: z.string().min(1).max(255) });
registry.register('IdentityProvisioningDirectory', IdentityProvisioningDirectoryRecordSchema);
registry.register('IdentityProvisioningCredentialMetadata', IdentityProvisioningCredentialMetadataSchema);
registry.registerPath({ method: 'get', path: '/api/identity/provisioning-directories', ...authzExtension('platform.sso.providers.read', 'GET', '/api/identity/provisioning-directories'), request: { query: IdentityProvisioningDirectoryQuerySchema }, responses: { 200: { description: 'List tenant-scoped authoritative provisioning directories', content: { 'application/json': { schema: IdentityProvisioningDirectoryListResponseSchema } } } } });
registry.registerPath({ method: 'post', path: '/api/identity/provisioning-directories', ...authzExtension('platform.sso.providers.manage', 'POST', '/api/identity/provisioning-directories'), request: { body: { content: { 'application/json': { schema: IdentityProvisioningDirectoryCreateSchema } } } }, responses: { 201: { description: 'Provisioning directory created', content: { 'application/json': { schema: IdentityProvisioningDirectoryRecordSchema } } }, 409: { description: 'Directory key conflict or another authoritative directory is already active' } } });
registry.registerPath({ method: 'get', path: '/api/identity/provisioning-directories/{key}', ...authzExtension('platform.sso.providers.read', 'GET', '/api/identity/provisioning-directories/{key}'), request: { params: ProvisioningDirectoryParamsSchema }, responses: { 200: { description: 'Provisioning directory', content: { 'application/json': { schema: IdentityProvisioningDirectoryRecordSchema } } }, 404: { description: 'Provisioning directory not found' } } });
registry.registerPath({ method: 'put', path: '/api/identity/provisioning-directories/{key}', ...authzExtension('platform.sso.providers.manage', 'PUT', '/api/identity/provisioning-directories/{key}'), request: { params: ProvisioningDirectoryParamsSchema, body: { content: { 'application/json': { schema: IdentityProvisioningDirectoryUpdateSchema } } } }, responses: { 200: { description: 'Provisioning directory updated', content: { 'application/json': { schema: IdentityProvisioningDirectoryRecordSchema } } }, 409: { description: 'Configuration ownership or active-authority conflict' } } });
registry.registerPath({ method: 'delete', path: '/api/identity/provisioning-directories/{key}', ...authzExtension('platform.sso.providers.manage', 'DELETE', '/api/identity/provisioning-directories/{key}'), request: { params: ProvisioningDirectoryParamsSchema }, responses: { 204: { description: 'Provisioning directory archived and all credentials revoked' }, 409: { description: 'Configuration-managed directory must be changed through its source bundle' } } });
registry.registerPath({ method: 'post', path: '/api/identity/provisioning-directories/{key}/test', ...authzExtension('platform.sso.providers.manage', 'POST', '/api/identity/provisioning-directories/{key}/test'), request: { params: ProvisioningDirectoryParamsSchema }, responses: { 200: { description: 'Sanitized provisioning readiness result without testing or returning bearer material', content: { 'application/json': { schema: IdentityProvisioningDirectoryTestResponseSchema } } } } });
registry.registerPath({ method: 'get', path: '/api/identity/provisioning-directories/{key}/credentials', ...authzExtension('platform.sso.providers.read', 'GET', '/api/identity/provisioning-directories/{key}/credentials'), request: { params: ProvisioningDirectoryParamsSchema }, responses: { 200: { description: 'Redacted provisioning credential metadata', content: { 'application/json': { schema: IdentityProvisioningCredentialListResponseSchema } } } } });
registry.registerPath({ method: 'post', path: '/api/identity/provisioning-directories/{key}/credentials', ...authzExtension('platform.sso.providers.manage', 'POST', '/api/identity/provisioning-directories/{key}/credentials'), request: { params: ProvisioningDirectoryParamsSchema, headers: z.object({ 'idempotency-key': IdentityProvisioningIdempotencyKeySchema.optional() }), body: { content: { 'application/json': { schema: IdentityProvisioningCredentialCreateSchema } } } }, responses: { 201: { description: 'Provisioning credential issued; the bearer token is returned exactly once and the response is non-cacheable', headers: { 'Cache-Control': { schema: { type: 'string', example: 'no-store' } }, Pragma: { schema: { type: 'string', example: 'no-cache' } } }, content: { 'application/json': { schema: IdentityProvisioningCredentialIssuedSchema } } }, 400: { description: 'Headless calls require a valid Idempotency-Key header' }, 409: { description: 'The idempotency key already completed a reveal-once operation; the secret cannot be replayed' } } });
registry.registerPath({ method: 'post', path: '/api/identity/provisioning-directories/{key}/credentials/{credentialId}/rotate', ...authzExtension('platform.sso.providers.manage', 'POST', '/api/identity/provisioning-directories/{key}/credentials/{credentialId}/rotate'), request: { params: ProvisioningCredentialParamsSchema, headers: z.object({ 'idempotency-key': IdentityProvisioningIdempotencyKeySchema.optional() }), body: { content: { 'application/json': { schema: IdentityProvisioningCredentialRotateSchema } } } }, responses: { 201: { description: 'Replacement credential issued once with bounded overlap for the old credential; the response is non-cacheable', headers: { 'Cache-Control': { schema: { type: 'string', example: 'no-store' } }, Pragma: { schema: { type: 'string', example: 'no-cache' } } }, content: { 'application/json': { schema: IdentityProvisioningCredentialIssuedSchema } } }, 400: { description: 'Headless calls require a valid Idempotency-Key header' }, 409: { description: 'The idempotency key already completed a reveal-once operation; the secret cannot be replayed' } } });
registry.registerPath({ method: 'delete', path: '/api/identity/provisioning-directories/{key}/credentials/{credentialId}', ...authzExtension('platform.sso.providers.manage', 'DELETE', '/api/identity/provisioning-directories/{key}/credentials/{credentialId}'), request: { params: ProvisioningCredentialParamsSchema }, responses: { 204: { description: 'Provisioning credential revoked immediately' } } });
registry.registerPath({ method: 'get', path: '/api/identity/provisioning-directories/{key}/events', ...authzExtension('platform.sso.providers.read', 'GET', '/api/identity/provisioning-directories/{key}/events'), request: { params: ProvisioningDirectoryParamsSchema, query: IdentityProvisioningDiagnosticsQuerySchema }, responses: { 200: { description: 'Bounded sanitized provisioning diagnostics', content: { 'application/json': { schema: IdentityProvisioningDiagnosticsListResponseSchema } } } } });

// SCIM 2.0 machine provisioning API. Every operation uses a separate
// directory-scoped bearer security scheme and SCIM media/error contracts.
const scimSchemas = await import('./scim.js');
registry.registerComponent('securitySchemes', 'ScimBearer', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'EnterpriseGlue directory credential',
  description: 'Directory-scoped provisioning credential. The credential binds the request to its directory and tenant.',
});
registry.registerComponent('securitySchemes', 'ScimOAuthClient', {
  type: 'http',
  scheme: 'basic',
  description: 'Reveal-once provisioning client ID and client secret used only at the directory token endpoint.',
});
const ScimSecurity = [{ ScimBearer: [] }];
const ScimOAuthClientSecurity = [{ ScimOAuthClient: [] }];
const ScimDirectoryParamsSchema = z.object({ directoryKey: IdentityProvisioningDirectoryKeySchema });
const ScimResourceParamsSchema = ScimDirectoryParamsSchema.extend({ id: scimSchemas.ScimResourceIdSchema });
const ScimSchemaParamsSchema = ScimDirectoryParamsSchema.extend({ schemaId: z.string().min(1).max(512) });
const ScimResourceTypeParamsSchema = ScimDirectoryParamsSchema.extend({ resourceType: z.enum(['User', 'Group']) });
const ScimErrorResponse = { description: 'SCIM protocol error', content: { 'application/scim+json': { schema: scimSchemas.ScimErrorSchema } } };
const ScimSchemaListResponseSchema = scimSchemas.createScimListResponseSchema(scimSchemas.ScimSchemaResourceSchema);
const ScimResourceTypeListResponseSchema = scimSchemas.createScimListResponseSchema(scimSchemas.ScimResourceTypeSchema);
registry.register('ScimUser', scimSchemas.ScimUserResponseSchema);
registry.register('ScimGroup', scimSchemas.ScimGroupResponseSchema);
registry.register('ScimError', scimSchemas.ScimErrorSchema);
registry.registerPath({ method: 'post', path: '/scim/v2/{directoryKey}/oauth/token', security: ScimOAuthClientSecurity, ...authzExemption('POST', '/scim/v2/{directoryKey}/oauth/token'), request: { params: ScimDirectoryParamsSchema, body: { content: { 'application/x-www-form-urlencoded': { schema: ScimOAuthTokenRequestSchema } } } }, responses: { 200: { description: 'Short-lived directory-scoped SCIM access token', content: { 'application/json': { schema: ScimOAuthTokenResponseSchema } } }, 400: { description: 'Invalid OAuth request or scope' }, 401: { description: 'Invalid or revoked client credential' } } });
registry.registerPath({ method: 'get', path: '/scim/v2/{directoryKey}/ServiceProviderConfig', security: ScimSecurity, ...authzExemption('GET', '/scim/v2/{directoryKey}/ServiceProviderConfig'), request: { params: ScimDirectoryParamsSchema }, responses: { 200: { description: 'SCIM service-provider capabilities', content: { 'application/scim+json': { schema: scimSchemas.ScimServiceProviderConfigSchema } } }, 401: ScimErrorResponse } });
registry.registerPath({ method: 'post', path: '/scim/v2/{directoryKey}/Bulk', security: ScimSecurity, ...authzExemption('POST', '/scim/v2/{directoryKey}/Bulk'), request: { params: ScimDirectoryParamsSchema, body: { content: { 'application/scim+json': { schema: scimSchemas.ScimBulkRequestSchema } } } }, responses: { 200: { description: 'Bounded SCIM Bulk operation results', content: { 'application/scim+json': { schema: scimSchemas.ScimBulkResponseSchema } } }, 400: ScimErrorResponse, 401: ScimErrorResponse, 413: ScimErrorResponse } });
registry.registerPath({ method: 'get', path: '/scim/v2/{directoryKey}/Schemas', security: ScimSecurity, ...authzExemption('GET', '/scim/v2/{directoryKey}/Schemas'), request: { params: ScimDirectoryParamsSchema }, responses: { 200: { description: 'SCIM core schemas', content: { 'application/scim+json': { schema: ScimSchemaListResponseSchema } } }, 401: ScimErrorResponse } });
registry.registerPath({ method: 'get', path: '/scim/v2/{directoryKey}/Schemas/{schemaId}', security: ScimSecurity, ...authzExemption('GET', '/scim/v2/{directoryKey}/Schemas/{schemaId}'), request: { params: ScimSchemaParamsSchema }, responses: { 200: { description: 'SCIM schema', content: { 'application/scim+json': { schema: scimSchemas.ScimSchemaResourceSchema } } }, 401: ScimErrorResponse, 404: ScimErrorResponse } });
registry.registerPath({ method: 'get', path: '/scim/v2/{directoryKey}/ResourceTypes', security: ScimSecurity, ...authzExemption('GET', '/scim/v2/{directoryKey}/ResourceTypes'), request: { params: ScimDirectoryParamsSchema }, responses: { 200: { description: 'SCIM resource types', content: { 'application/scim+json': { schema: ScimResourceTypeListResponseSchema } } }, 401: ScimErrorResponse } });
registry.registerPath({ method: 'get', path: '/scim/v2/{directoryKey}/ResourceTypes/{resourceType}', security: ScimSecurity, ...authzExemption('GET', '/scim/v2/{directoryKey}/ResourceTypes/{resourceType}'), request: { params: ScimResourceTypeParamsSchema }, responses: { 200: { description: 'SCIM resource type', content: { 'application/scim+json': { schema: scimSchemas.ScimResourceTypeSchema } } }, 401: ScimErrorResponse, 404: ScimErrorResponse } });
registry.registerPath({ method: 'get', path: '/scim/v2/{directoryKey}/Users', security: ScimSecurity, ...authzExemption('GET', '/scim/v2/{directoryKey}/Users'), request: { params: ScimDirectoryParamsSchema, query: scimSchemas.ScimListQuerySchema }, responses: { 200: { description: 'Filtered and paginated SCIM users', content: { 'application/scim+json': { schema: scimSchemas.ScimUserListResponseSchema } } }, 400: ScimErrorResponse, 401: ScimErrorResponse } });
registry.registerPath({ method: 'post', path: '/scim/v2/{directoryKey}/Users', security: ScimSecurity, ...authzExemption('POST', '/scim/v2/{directoryKey}/Users'), request: { params: ScimDirectoryParamsSchema, body: { content: { 'application/scim+json': { schema: scimSchemas.ScimUserCreateSchema } } } }, responses: { 201: { description: 'SCIM user created', headers: { Location: { schema: { type: 'string', format: 'uri' } }, ETag: { schema: { type: 'string' } } }, content: { 'application/scim+json': { schema: scimSchemas.ScimUserResponseSchema } } }, 400: ScimErrorResponse, 401: ScimErrorResponse, 409: ScimErrorResponse } });
registry.registerPath({ method: 'get', path: '/scim/v2/{directoryKey}/Users/{id}', security: ScimSecurity, ...authzExemption('GET', '/scim/v2/{directoryKey}/Users/{id}'), request: { params: ScimResourceParamsSchema }, responses: { 200: { description: 'SCIM user', headers: { ETag: { schema: { type: 'string' } } }, content: { 'application/scim+json': { schema: scimSchemas.ScimUserResponseSchema } } }, 401: ScimErrorResponse, 404: ScimErrorResponse } });
registry.registerPath({ method: 'put', path: '/scim/v2/{directoryKey}/Users/{id}', security: ScimSecurity, ...authzExemption('PUT', '/scim/v2/{directoryKey}/Users/{id}'), request: { params: ScimResourceParamsSchema, headers: z.object({ 'if-match': scimSchemas.ScimVersionSchema.optional() }), body: { content: { 'application/scim+json': { schema: scimSchemas.ScimUserReplaceSchema } } } }, responses: { 200: { description: 'SCIM user replaced', headers: { ETag: { schema: { type: 'string' } } }, content: { 'application/scim+json': { schema: scimSchemas.ScimUserResponseSchema } } }, 400: ScimErrorResponse, 401: ScimErrorResponse, 404: ScimErrorResponse, 409: ScimErrorResponse, 412: ScimErrorResponse } });
registry.registerPath({ method: 'patch', path: '/scim/v2/{directoryKey}/Users/{id}', security: ScimSecurity, ...authzExemption('PATCH', '/scim/v2/{directoryKey}/Users/{id}'), request: { params: ScimResourceParamsSchema, headers: z.object({ 'if-match': scimSchemas.ScimVersionSchema.optional() }), body: { content: { 'application/scim+json': { schema: scimSchemas.ScimPatchRequestSchema } } } }, responses: { 200: { description: 'SCIM user patched atomically', headers: { ETag: { schema: { type: 'string' } } }, content: { 'application/scim+json': { schema: scimSchemas.ScimUserResponseSchema } } }, 400: ScimErrorResponse, 401: ScimErrorResponse, 404: ScimErrorResponse, 409: ScimErrorResponse, 412: ScimErrorResponse } });
registry.registerPath({ method: 'delete', path: '/scim/v2/{directoryKey}/Users/{id}', security: ScimSecurity, ...authzExemption('DELETE', '/scim/v2/{directoryKey}/Users/{id}'), request: { params: ScimResourceParamsSchema, headers: z.object({ 'if-match': scimSchemas.ScimVersionSchema.optional() }) }, responses: { 204: { description: 'SCIM user soft-deprovisioned; sessions invalidated and authored resources retained' }, 401: ScimErrorResponse, 404: ScimErrorResponse, 412: ScimErrorResponse } });
registry.registerPath({ method: 'get', path: '/scim/v2/{directoryKey}/Groups', security: ScimSecurity, ...authzExemption('GET', '/scim/v2/{directoryKey}/Groups'), request: { params: ScimDirectoryParamsSchema, query: scimSchemas.ScimListQuerySchema }, responses: { 200: { description: 'Filtered and paginated SCIM groups', content: { 'application/scim+json': { schema: scimSchemas.ScimGroupListResponseSchema } } }, 400: ScimErrorResponse, 401: ScimErrorResponse } });
registry.registerPath({ method: 'post', path: '/scim/v2/{directoryKey}/Groups', security: ScimSecurity, ...authzExemption('POST', '/scim/v2/{directoryKey}/Groups'), request: { params: ScimDirectoryParamsSchema, body: { content: { 'application/scim+json': { schema: scimSchemas.ScimGroupCreateSchema } } } }, responses: { 201: { description: 'SCIM group created', headers: { Location: { schema: { type: 'string', format: 'uri' } }, ETag: { schema: { type: 'string' } } }, content: { 'application/scim+json': { schema: scimSchemas.ScimGroupResponseSchema } } }, 400: ScimErrorResponse, 401: ScimErrorResponse, 409: ScimErrorResponse } });
registry.registerPath({ method: 'get', path: '/scim/v2/{directoryKey}/Groups/{id}', security: ScimSecurity, ...authzExemption('GET', '/scim/v2/{directoryKey}/Groups/{id}'), request: { params: ScimResourceParamsSchema }, responses: { 200: { description: 'SCIM group', headers: { ETag: { schema: { type: 'string' } } }, content: { 'application/scim+json': { schema: scimSchemas.ScimGroupResponseSchema } } }, 401: ScimErrorResponse, 404: ScimErrorResponse } });
registry.registerPath({ method: 'put', path: '/scim/v2/{directoryKey}/Groups/{id}', security: ScimSecurity, ...authzExemption('PUT', '/scim/v2/{directoryKey}/Groups/{id}'), request: { params: ScimResourceParamsSchema, headers: z.object({ 'if-match': scimSchemas.ScimVersionSchema.optional() }), body: { content: { 'application/scim+json': { schema: scimSchemas.ScimGroupReplaceSchema } } } }, responses: { 200: { description: 'SCIM group replaced', headers: { ETag: { schema: { type: 'string' } } }, content: { 'application/scim+json': { schema: scimSchemas.ScimGroupResponseSchema } } }, 400: ScimErrorResponse, 401: ScimErrorResponse, 404: ScimErrorResponse, 409: ScimErrorResponse, 412: ScimErrorResponse } });
registry.registerPath({ method: 'patch', path: '/scim/v2/{directoryKey}/Groups/{id}', security: ScimSecurity, ...authzExemption('PATCH', '/scim/v2/{directoryKey}/Groups/{id}'), request: { params: ScimResourceParamsSchema, headers: z.object({ 'if-match': scimSchemas.ScimVersionSchema.optional() }), body: { content: { 'application/scim+json': { schema: scimSchemas.ScimPatchRequestSchema } } } }, responses: { 200: { description: 'SCIM group membership patched atomically', headers: { ETag: { schema: { type: 'string' } } }, content: { 'application/scim+json': { schema: scimSchemas.ScimGroupResponseSchema } } }, 400: ScimErrorResponse, 401: ScimErrorResponse, 404: ScimErrorResponse, 409: ScimErrorResponse, 412: ScimErrorResponse } });
registry.registerPath({ method: 'delete', path: '/scim/v2/{directoryKey}/Groups/{id}', security: ScimSecurity, ...authzExemption('DELETE', '/scim/v2/{directoryKey}/Groups/{id}'), request: { params: ScimResourceParamsSchema, headers: z.object({ 'if-match': scimSchemas.ScimVersionSchema.optional() }) }, responses: { 204: { description: 'SCIM group archived; internal users and groups retained' }, 401: ScimErrorResponse, 404: ScimErrorResponse, 412: ScimErrorResponse } });

const identityMappingSchemas = await import('./platform-admin/authz.js');
registry.register('IdentityMapping', identityMappingSchemas.IdentityMappingResponseSchema);
registry.registerPath({ method: 'get', path: '/api/identity/mappings', ...authzExtension('platform.sso.group-mappings.read', 'GET', '/api/identity/mappings'), responses: { 200: { description: 'List provider-neutral identity mappings', content: { 'application/json': { schema: z.array(identityMappingSchemas.IdentityMappingResponseSchema) } } } } });
registry.registerPath({ method: 'post', path: '/api/identity/mappings', ...authzExtension('platform.sso.group-mappings.manage', 'POST', '/api/identity/mappings'), request: { body: { content: { 'application/json': { schema: identityMappingSchemas.IdentityMappingRequestSchema } } } }, responses: { 201: { description: 'Identity mapping created', content: { 'application/json': { schema: identityMappingSchemas.IdentityMappingResponseSchema } } } } });
registry.registerPath({ method: 'post', path: '/api/identity/mappings/provision-access', ...authzExtension('platform.sso.group-mappings.manage', 'POST', '/api/identity/mappings/provision-access'), request: { body: { content: { 'application/json': { schema: identityMappingSchemas.IdentityMappingProvisionAccessRequestSchema } } } }, responses: { 201: { description: 'Identity mapping, optional new group, and scoped group access provisioned atomically', content: { 'application/json': { schema: identityMappingSchemas.IdentityMappingProvisionAccessResponseSchema } } } } });
registry.registerPath({ method: 'post', path: '/api/identity/mappings/{id}/access', ...authzExtension('platform.sso.group-mappings.manage', 'POST', '/api/identity/mappings/{id}/access'), request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: identityMappingSchemas.IdentityMappingAccessGrantRequestSchema } } } }, responses: { 201: { description: 'SSO-lineage access assignment granted to the mapping target group', content: { 'application/json': { schema: identityMappingSchemas.IdentityMappingAccessGrantResponseSchema } } }, 403: { description: 'Identity mapping is configuration-locked or the caller lacks permission' }, 404: { description: 'Active identity mapping not found' } } });
registry.registerPath({ method: 'put', path: '/api/identity/mappings/{id}', ...authzExtension('platform.sso.group-mappings.manage', 'PUT', '/api/identity/mappings/{id}'), request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: identityMappingSchemas.IdentityMappingUpdateSchema } } } }, responses: { 200: { description: 'Identity mapping updated', content: { 'application/json': { schema: identityMappingSchemas.IdentityMappingResponseSchema } } } } });
registry.registerPath({ method: 'delete', path: '/api/identity/mappings/{id}', ...authzExtension('platform.sso.group-mappings.manage', 'DELETE', '/api/identity/mappings/{id}'), request: { params: z.object({ id: z.string() }) }, responses: { 204: { description: 'Identity mapping removed' } } });
registry.registerPath({ method: 'post', path: '/api/identity/mappings/test', ...authzExtension('platform.sso.group-mappings.manage', 'POST', '/api/identity/mappings/test'), request: { body: { content: { 'application/json': { schema: identityMappingSchemas.IdentityMappingTestRequestSchema } } } }, responses: { 200: { description: 'Identity mapping test result', content: { 'application/json': { schema: identityMappingSchemas.IdentityMappingTestResponseSchema } } } } });
registry.registerPath({ method: 'post', path: '/api/identity/mappings/stored-snapshot-preview', ...authzExtension('platform.sso.group-mappings.manage', 'POST', '/api/identity/mappings/stored-snapshot-preview'), request: { body: { content: { 'application/json': { schema: identityMappingSchemas.IdentityMappingStoredSnapshotPreviewRequestSchema } } } }, responses: { 200: { description: 'Aggregate proposed mapping matches from stored normalized identity snapshots', content: { 'application/json': { schema: identityMappingSchemas.IdentityMappingStoredSnapshotPreviewResponseSchema } } } } });

// -----------------------------
// Project Members API
// -----------------------------
registry.register('ProjectMember', ProjectMemberSchema);

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
  responses: { 200: { description: 'Deploy permission grant updated', content: { 'application/json': { schema: ProjectDeployGrantResponseSchema } } }, 403: { description: 'Project access is SSO-managed or the caller lacks permission' } },
});

registry.registerPath({
  method: 'get',
  path: '/starbase-api/projects/{projectId}/members',
  ...authzExtension('project.members.read', 'GET', '/starbase-api/projects/{projectId}/members'),
  request: { params: z.object({ projectId: z.string().uuid() }) },
  responses: { 200: { description: 'Project members and unresolved invitations', content: { 'application/json': { schema: ProjectMembersResponseSchema } } } },
});

registry.registerPath({
  method: 'post',
  path: '/starbase-api/projects/{projectId}/pending-invites/{invitationId}/reissue',
  ...authzExtension('project.members.invite', 'POST', '/starbase-api/projects/{projectId}/pending-invites/{invitationId}/reissue'),
  request: { params: z.object({ projectId: z.string().uuid(), invitationId: z.string().uuid() }) },
  responses: { 200: { description: 'Manual project invitation reissued', content: { 'application/json': { schema: ReissuedManualProjectInvitationSchema } } }, 403: { description: 'Project access is SSO-managed or the caller lacks permission' } },
});

registry.registerPath({
  method: 'post',
  path: '/starbase-api/projects/{projectId}/members',
  ...authzExtension('project.members.add', 'POST', '/starbase-api/projects/{projectId}/members'),
  request: { params: z.object({ projectId: z.string().uuid() }), body: { content: { 'application/json': { schema: AddProjectMemberRequest } } } },
  responses: { 201: { description: 'Member added directly or invitation created', content: { 'application/json': { schema: ProjectMemberAddResponseSchema } } }, 403: { description: 'Project access is SSO-managed or the caller lacks permission' } },
});

registry.registerPath({
  method: 'patch',
  path: '/starbase-api/projects/{projectId}/members/{userId}',
  ...authzExtension('project.members.update-role', 'PATCH', '/starbase-api/projects/{projectId}/members/{userId}'),
  request: { params: z.object({ projectId: z.string().uuid(), userId: z.string().uuid() }), body: { content: { 'application/json': { schema: UpdateProjectMemberRoleRequest } } } },
  responses: { 200: { description: 'Role updated', content: { 'application/json': { schema: z.object({ message: z.string() }) } } }, 403: { description: 'Project access is SSO-managed or the caller lacks permission' } },
});

registry.registerPath({
  method: 'delete',
  path: '/starbase-api/projects/{projectId}/members/{userId}',
  ...authzExtension('project.members.remove', 'DELETE', '/starbase-api/projects/{projectId}/members/{userId}'),
  request: { params: z.object({ projectId: z.string().uuid(), userId: z.string().uuid() }) },
  responses: { 204: { description: 'Member removed' }, 403: { description: 'Project access is SSO-managed or the caller lacks permission' } },
});

registry.registerPath({
  method: 'post',
  path: '/starbase-api/projects/{projectId}/transfer-ownership',
  ...authzExtension('project.ownership.transfer', 'POST', '/starbase-api/projects/{projectId}/transfer-ownership'),
  request: { params: z.object({ projectId: z.string().uuid() }), body: { content: { 'application/json': { schema: TransferProjectOwnershipRequest } } } },
  responses: { 200: { description: 'Ownership transferred', content: { 'application/json': { schema: z.object({ message: z.string() }) } } }, 403: { description: 'Project access is SSO-managed or the caller lacks permission' } },
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
  responses: { 200: { description: 'Engine member invitation capabilities', content: { 'application/json': { schema: EngineMemberCapabilitiesSchema } } } },
});

registry.registerPath({
  method: 'get',
  path: '/engines-api/engines/{engineId}/members/lookup',
  ...authzExtension('engine.members.lookup', 'GET', '/engines-api/engines/{engineId}/members/lookup'),
  request: { params: z.object({ engineId: z.string() }), query: z.object({ email: z.string().email().optional(), role: z.enum(['delegate', 'operator', 'deployer']).optional() }) },
  responses: { 200: { description: 'Engine member lookup result', content: { 'application/json': { schema: EngineMemberLookupSchema } } } },
});

registry.registerPath({
  method: 'post',
  path: '/engines-api/engines/{engineId}/members',
  ...authzExtension('engine.members.add', 'POST', '/engines-api/engines/{engineId}/members'),
  request: { params: z.object({ engineId: z.string() }), body: { content: { 'application/json': { schema: AddEngineMemberRequest } } } },
  responses: { 201: { description: 'Member added directly or invitation created', content: { 'application/json': { schema: EngineMemberAddResponseSchema } } }, 403: { description: 'Engine access is SSO-managed or the caller lacks permission' } },
});

registry.registerPath({
  method: 'patch',
  path: '/engines-api/engines/{engineId}/members/{userId}',
  ...authzExtension('engine.members.update-role', 'PATCH', '/engines-api/engines/{engineId}/members/{userId}'),
  request: { params: z.object({ engineId: z.string(), userId: z.string().uuid() }), body: { content: { 'application/json': { schema: UpdateEngineMemberRoleRequest } } } },
  responses: { 200: { description: 'Role updated', content: { 'application/json': { schema: z.object({ message: z.string() }) } } }, 403: { description: 'Engine access is SSO-managed or the caller lacks permission' } },
});

registry.registerPath({
  method: 'delete',
  path: '/engines-api/engines/{engineId}/members/{userId}',
  ...authzExtension('engine.members.remove', 'DELETE', '/engines-api/engines/{engineId}/members/{userId}'),
  request: { params: z.object({ engineId: z.string(), userId: z.string().uuid() }) },
  responses: { 204: { description: 'Member removed' }, 403: { description: 'Engine access is SSO-managed or the caller lacks permission' } },
});

registry.registerPath({
  method: 'post',
  path: '/engines-api/engines/{engineId}/pending-invites/{invitationId}/reissue',
  ...authzExtension('engine.members.invite', 'POST', '/engines-api/engines/{engineId}/pending-invites/{invitationId}/reissue'),
  request: { params: z.object({ engineId: z.string(), invitationId: z.string().uuid() }) },
  responses: { 200: { description: 'Manual invitation reissued', content: { 'application/json': { schema: ReissuedManualEngineInvitationSchema } } }, 403: { description: 'Engine access is SSO-managed or the caller lacks permission' } },
});

registry.registerPath({
  method: 'post',
  path: '/engines-api/engines/{engineId}/delegate',
  ...authzExtension('engine.delegate.manage', 'POST', '/engines-api/engines/{engineId}/delegate'),
  request: { params: z.object({ engineId: z.string() }), body: { content: { 'application/json': { schema: AssignDelegateRequest } } } },
  responses: { 200: { description: 'Delegate assigned', content: { 'application/json': { schema: z.object({ message: z.string() }) } } }, 403: { description: 'Engine access is SSO-managed or the caller lacks permission' } },
});

registry.registerPath({
  method: 'post',
  path: '/engines-api/engines/{engineId}/transfer-ownership',
  ...authzExtension('engine.ownership.transfer', 'POST', '/engines-api/engines/{engineId}/transfer-ownership'),
  request: { params: z.object({ engineId: z.string() }), body: { content: { 'application/json': { schema: TransferEngineOwnershipRequest } } } },
  responses: { 200: { description: 'Ownership transferred', content: { 'application/json': { schema: z.object({ message: z.string() }) } } }, 403: { description: 'Engine access is SSO-managed or the caller lacks permission' } },
});

registry.registerPath({
  method: 'post',
  path: '/engines-api/engines/{engineId}/environment',
  ...authzExtension('engine.environment.set', 'POST', '/engines-api/engines/{engineId}/environment'),
  request: { params: z.object({ engineId: z.string() }), body: { content: { 'application/json': { schema: SetEnvironmentRequest } } } },
  responses: { 200: { description: 'Environment set', content: { 'application/json': { schema: EngineEnvironmentUpdateResponseSchema } } } },
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
  responses: { 200: { description: 'Access request result', content: { 'application/json': { schema: EngineProjectAccessRequestResultSchema } } } },
});

registry.registerPath({
  method: 'get',
  path: '/engines-api/engines/{engineId}/access-requests',
  ...authzExtension('engine.project-access.requests.read', 'GET', '/engines-api/engines/{engineId}/access-requests'),
  request: { params: z.object({ engineId: z.string() }) },
  responses: { 200: { description: 'Pending engine access requests', content: { 'application/json': { schema: z.array(EngineProjectAccessRequestSchema) } } } },
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
  responses: { 201: { description: 'Folder created', content: { 'application/json': { schema: CreateFolderResponseSchema } } } },
});

// PATCH /starbase-api/folders/:folderId (rename/move folder)
registry.register('UpdateFolderRequest', UpdateFolderRequest);
registry.registerPath({
  method: 'patch',
  path: '/starbase-api/folders/{folderId}',
  ...authzExtension('project.files.update', 'PATCH', '/starbase-api/folders/{folderId}'),
  request: { params: z.object({ folderId: z.string() }), body: { content: { 'application/json': { schema: UpdateFolderRequest } } } },
  responses: { 200: { description: 'Folder updated', content: { 'application/json': { schema: UpdateFolderResponseSchema } } } },
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
    body: { content: { 'application/json': { schema: RestoreFileFromCommitRequestSchema } } },
  },
  responses: { 200: { description: 'File restored', content: { 'application/json': { schema: RestoreFileFromCommitResponseSchema } } } },
});

registry.register('ProjectEngineAccessResponse', ProjectEngineAccessResponseSchema);

// GET /starbase-api/projects/:projectId/engine-access
registry.registerPath({
  method: 'get',
  path: '/starbase-api/projects/{projectId}/engine-access',
  ...authzExtension('project.deployment-options.read', 'GET', '/starbase-api/projects/:projectId/engine-access'),
  request: { params: z.object({ projectId: z.string() }) },
  responses: { 200: { description: 'Engine access status and deployment eligibility for project', content: { 'application/json': { schema: ProjectEngineAccessResponseSchema } } } },
});

// GET /starbase-api/projects/:projectId/engine-deployments
registry.registerPath({
  method: 'get',
  path: '/starbase-api/projects/{projectId}/engine-deployments',
  ...authzExtension('project.deployments.read', 'GET', '/starbase-api/projects/:projectId/engine-deployments'),
  request: { params: z.object({ projectId: z.string() }), query: z.object({ limit: z.string().optional() }) },
  responses: { 200: { description: 'Sanitized engine deployments for project', content: { 'application/json': { schema: z.array(ProjectEngineDeploymentViewSchema) } } } },
});

// GET /starbase-api/projects/:projectId/engine-deployments/latest
registry.registerPath({
  method: 'get',
  path: '/starbase-api/projects/{projectId}/engine-deployments/latest',
  ...authzExtension('project.deployments.read', 'GET', '/starbase-api/projects/:projectId/engine-deployments/latest'),
  request: { params: z.object({ projectId: z.string() }) },
  responses: { 200: { description: 'Latest engine deployments per file', content: { 'application/json': { schema: z.array(LatestProjectDeploymentArtifactSchema) } } } },
});

// GET /starbase-api/projects/:projectId/files/:fileId/deployments
registry.registerPath({
  method: 'get',
  path: '/starbase-api/projects/{projectId}/files/{fileId}/deployments',
  ...authzExtension('project.deployments.read', 'GET', '/starbase-api/projects/:projectId/files/:fileId/deployments'),
  request: { params: z.object({ projectId: z.string(), fileId: z.string() }) },
  responses: { 200: { description: 'Deployments for a specific file', content: { 'application/json': { schema: z.array(FileDeploymentSummarySchema) } } } },
});

// GET /starbase-api/projects/:projectId/files/:fileId/deployments/history
registry.registerPath({
  method: 'get',
  path: '/starbase-api/projects/{projectId}/files/{fileId}/deployments/history',
  ...authzExtension('project.deployments.read', 'GET', '/starbase-api/projects/:projectId/files/:fileId/deployments/history'),
  request: { params: z.object({ projectId: z.string(), fileId: z.string() }) },
  responses: { 200: { description: 'Full deployment history for a file', content: { 'application/json': { schema: z.array(FileDeploymentSummarySchema) } } } },
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
  responses: { 200: { description: 'Activity counts grouped by state', content: { 'application/json': { schema: ActivityCountsByStateSchema } } } },
});

// POST /mission-control-api/process-definitions/key/{key}/start
registry.register('ProcessInstanceStartResponse', ProcessInstanceStartResponseSchema)
registry.registerPath({
  method: 'post',
  path: '/mission-control-api/process-definitions/key/{key}/start',
  ...authzExtension('engine.runtime.process-definitions.start', 'POST', '/mission-control-api/process-definitions/key/{key}/start'),
  request: { params: z.object({ key: z.string() }), body: { content: { 'application/json': { schema: z.object({ variables: z.record(z.string(), z.unknown()).optional(), businessKey: z.string().optional() }) } } } },
  responses: { 200: { description: 'Process instance started', content: { 'application/json': { schema: ProcessInstanceStartResponseSchema } } } },
});

// GET /mission-control-api/process-definitions/key/{key}/statistics
registry.registerPath({
  method: 'get',
  path: '/mission-control-api/process-definitions/key/{key}/statistics',
  ...authzExtension('engine.runtime.process-definitions.read', 'GET', '/mission-control-api/process-definitions/key/{key}/statistics'),
  request: { params: z.object({ key: z.string() }) },
  responses: { 200: { description: 'Process definition statistics', content: { 'application/json': { schema: ActivityCountByActivityIdSchema } } } },
});

// GET /mission-control-api/process-instances/{id}/activity-instances (runtime)
const RuntimeActivityInstanceTreeOpenApiSchema = z.object({
  id: z.string().nullable().optional(),
  activityId: z.string().nullable().optional(),
  activityName: z.string().nullable().optional(),
  activityType: z.string().nullable().optional(),
  parentActivityInstanceId: z.string().nullable().optional(),
  executionIds: z.array(z.string()).nullable().optional(),
  childActivityInstances: z.array(z.object({ id: z.string().nullable().optional(), activityId: z.string().nullable().optional() }).passthrough()).nullable().optional(),
  childTransitionInstances: z.array(z.object({ id: z.string().nullable().optional(), activityId: z.string().nullable().optional() }).passthrough()).nullable().optional(),
}).passthrough();
registry.registerPath({
  method: 'get',
  path: '/mission-control-api/process-instances/{id}/activity-instances',
  ...authzExtension('engine.runtime.process-instances.activity-tree.read', 'GET', '/mission-control-api/process-instances/{id}/activity-instances'),
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: 'Runtime activity instance tree', content: { 'application/json': { schema: RuntimeActivityInstanceTreeOpenApiSchema } } } },
});

// GET /mission-control-api/process-instances/{id}/jobs
registry.registerPath({
  method: 'get',
  path: '/mission-control-api/process-instances/{id}/jobs',
  ...authzExtension('engine.runtime.jobs.read', 'GET', '/mission-control-api/process-instances/{id}/jobs'),
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: 'Jobs for process instance', content: { 'application/json': { schema: ProcessInstanceJobListSchema } } } },
});

// GET /mission-control-api/process-instances/{id}/failed-external-tasks
registry.registerPath({
  method: 'get',
  path: '/mission-control-api/process-instances/{id}/failed-external-tasks',
  ...authzExtension('engine.runtime.external-tasks.read', 'GET', '/mission-control-api/process-instances/{id}/failed-external-tasks'),
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: 'Failed external tasks for instance', content: { 'application/json': { schema: ProcessInstanceExternalTaskListSchema } } } },
});

// POST /mission-control-api/process-instances/{id}/variables (modify)
registry.registerPath({
  method: 'post',
  path: '/mission-control-api/process-instances/{id}/variables',
  ...authzExtension('engine.runtime.process-instances.variables.update', 'POST', '/mission-control-api/process-instances/{id}/variables'),
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: ProcessInstanceVariablesModifyRequestSchema } } } },
  responses: { 204: { description: 'Variables modified' } },
});

// POST /mission-control-api/decision-definitions/key/{key}/evaluate
registry.registerPath({
  method: 'post',
  path: '/mission-control-api/decision-definitions/key/{key}/evaluate',
  ...authzExtension('engine.runtime.decisions.evaluate', 'POST', '/mission-control-api/decision-definitions/key/{key}/evaluate'),
  request: { params: z.object({ key: z.string() }), body: { content: { 'application/json': { schema: EvaluateDecisionRequest } } } },
  responses: { 200: { description: 'Decision result', content: { 'application/json': { schema: DecisionEvaluationResultSchema } } } },
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
  request: { body: { content: { 'application/json': { schema: MigrationGenerateRequestSchema } } } },
  responses: { 200: { description: 'Generated migration plan', content: { 'application/json': { schema: MigrationPlanSchema } } } },
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

// POST /api/auth/login
registry.registerPath({
  method: 'post',
  path: '/api/auth/login',
  ...authzExemption('POST', '/api/auth/login'),
  request: { body: { content: { 'application/json': { schema: z.object({ email: z.string().email(), password: z.string() }) } } } },
  responses: { 200: { description: 'Login successful', content: { 'application/json': { schema: AuthenticatedSessionLoginResponseSchema } } }, 401: { description: 'Invalid credentials' } },
});

registry.registerPath({
  method: 'post',
  path: '/api/auth/recovery/login',
  ...authzExemption('POST', '/api/auth/recovery/login'),
  request: { body: { content: { 'application/json': { schema: z.object({ email: z.string().email(), password: z.string() }) } } } },
  responses: {
    200: { description: 'Canonical platform-administrator recovery login successful', content: { 'application/json': { schema: AuthenticatedSessionLoginResponseSchema } } },
    401: { description: 'Invalid credentials or recovery is unavailable' },
  },
});

// POST /api/auth/complete-onboarding
registry.registerPath({
  method: 'post',
  path: '/api/auth/complete-onboarding',
  ...authzExemption('POST', '/api/auth/complete-onboarding'),
  request: { body: { content: { 'application/json': { schema: CompleteOnboardingRequestSchema } } } },
  responses: { 200: { description: 'Onboarding completed and session established', content: { 'application/json': { schema: AuthenticatedSessionOnboardingResponseSchema } } }, 400: { description: 'Invalid onboarding input or token' }, 401: { description: 'Invalid onboarding token' }, 403: { description: 'The invitation targets an engine or project whose access became SSO-managed' } },
});

// POST /api/auth/logout
registry.registerPath({
  method: 'post',
  path: '/api/auth/logout',
  ...authzExemption('POST', '/api/auth/logout'),
  request: { body: { content: { 'application/json': { schema: z.object({ refreshToken: z.string().optional() }).strict() } } } },
  responses: { 200: { description: 'Local sessions revoked; optional standards-based provider logout target returned', content: { 'application/json': { schema: LogoutResponseSchema } } } },
});
registry.registerPath({
  method: 'get',
  path: '/api/invitations/{token}',
  ...authzExemption('GET', '/api/invitations/:token'),
  request: { params: InvitationTokenParamsSchema },
  responses: { 200: { description: 'Public invitation status', content: { 'application/json': { schema: InvitationInfoSchema } } }, 404: { description: 'Invitation not found' } },
});
registry.registerPath({
  method: 'post',
  path: '/api/invitations/{token}/verify-otp',
  ...authzExemption('POST', '/api/invitations/:token/verify-otp'),
  request: {
    params: InvitationTokenParamsSchema,
    body: { content: { 'application/json': { schema: VerifyInvitationOtpRequestSchema } } },
  },
  responses: { 200: { description: 'Manual invitation verified for onboarding', content: { 'application/json': { schema: InvitationOnboardingResponseSchema } } }, 400: { description: 'Invalid or expired invitation' } },
});
registry.registerPath({
  method: 'post',
  path: '/api/invitations/{token}/redeem',
  ...authzExemption('POST', '/api/invitations/:token/redeem'),
  request: { params: InvitationTokenParamsSchema },
  responses: { 200: { description: 'Email invitation redeemed for onboarding', content: { 'application/json': { schema: InvitationOnboardingResponseSchema } } }, 400: { description: 'Invalid or expired invitation' } },
});

// POST /api/auth/refresh
registry.registerPath({
  method: 'post',
  path: '/api/auth/refresh',
  ...authzExemption('POST', '/api/auth/refresh'),
  responses: { 200: { description: 'Token refreshed', content: { 'application/json': { schema: RefreshAccessTokenResponseSchema } } }, 401: { description: 'Not authenticated' } },
});

// GET /api/auth/me
registry.registerPath({
  method: 'get',
  path: '/api/auth/me',
  ...authzExemption('GET', '/api/auth/me'),
  responses: { 200: { description: 'Current user profile', content: { 'application/json': { schema: AuthenticatedSessionUserSchema } } }, 401: { description: 'Not authenticated' } },
});

// PATCH /api/auth/me
registry.registerPath({
  method: 'patch',
  path: '/api/auth/me',
  ...authzExemption('PATCH', '/api/auth/me'),
  request: { body: { content: { 'application/json': { schema: z.object({ firstName: z.string().optional(), lastName: z.string().optional() }) } } } },
  responses: { 200: { description: 'Profile updated', content: { 'application/json': { schema: AuthenticatedSessionUserSchema } } } },
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
  responses: { 200: { description: 'Public non-secret platform branding', content: { 'application/json': { schema: PublicPlatformBrandingSchema } } } },
});

// GET /api/auth/platform-settings (authenticated UI)
registry.registerPath({
  method: 'get',
  path: '/api/auth/platform-settings',
  summary: 'Read non-secret settings and effective governance behavior for the authenticated UI',
  description: 'Returns policy modes plus derived read-only behavior. The behavior describes platform policy only; clients must still enforce the current principal permission snapshot and per-record ownership.',
  ...authzExemption('GET', '/api/auth/platform-settings'),
  responses: { 200: { description: 'Public platform settings', content: { 'application/json': { schema: PublicPlatformSettingsSchema } } } },
});

registry.registerPath({ method: 'get', path: '/api/auth/identity/{key}/start', ...authzExemption('GET', '/api/auth/identity/{key}/start'), request: { params: z.object({ key: z.string() }) }, responses: { 302: { description: 'Redirect to the selected OIDC identity provider' } } });
registry.registerPath({ method: 'get', path: '/api/auth/identity/callback', ...authzExemption('GET', '/api/auth/identity/callback'), responses: { 302: { description: 'Provider-neutral OIDC callback redirect' } } });
registry.registerPath({ method: 'post', path: '/api/auth/identity/{key}/ldap/login', ...authzExemption('POST', '/api/auth/identity/{key}/ldap/login'), request: { params: z.object({ key: z.string() }), body: { content: { 'application/json': { schema: z.object({ username: z.string(), password: z.string() }) } } } }, responses: { 200: { description: 'LDAP identity login', content: { 'application/json': { schema: AuthenticatedSessionLoginResponseSchema } } }, 401: { description: 'Invalid directory credentials' } } });
registry.registerPath({ method: 'get', path: '/api/auth/providers/enabled', ...authzExemption('GET', '/api/auth/providers/enabled'), responses: { 200: { description: 'Compatibility response for enabled provider-neutral direct-login options. New clients use /api/auth/login-methods.', content: { 'application/json': { schema: z.array(z.object({ id: z.string(), key: z.string(), displayName: z.string(), organization: z.string().nullable(), protocol: z.enum(['oidc', 'saml', 'ldap']), loginMethod: z.enum(['redirect', 'password']) })) } } } } });
registry.registerPath({ method: 'get', path: '/api/auth/login-methods', ...authzExemption('GET', '/api/auth/login-methods'), responses: { 200: { description: 'Policy-resolved login methods safe to show before authentication', content: { 'application/json': { schema: identityProviderMigrationSchemas.PublicLoginMethodsResponseSchema } } } } });
registry.registerPath({ method: 'get', path: '/api/auth/providers/{providerId}/start', ...authzExemption('GET', '/api/auth/providers/{providerId}/start'), request: { params: z.object({ providerId: z.string() }) }, responses: { 302: { description: 'Redirect to the selected provider-neutral OIDC or SAML identity provider' }, 404: { description: 'Identity provider not found' } } });
registry.registerPath({ method: 'post', path: '/api/auth/providers/{providerId}/login', ...authzExemption('POST', '/api/auth/providers/{providerId}/login'), request: { params: z.object({ providerId: z.string() }), body: { content: { 'application/json': { schema: z.object({ username: z.string(), password: z.string() }) } } } }, responses: { 200: { description: 'Provider-neutral LDAP identity login', content: { 'application/json': { schema: AuthenticatedSessionLoginResponseSchema } } }, 401: { description: 'Invalid directory credentials' } } });
registry.registerPath({ method: 'post', path: '/api/auth/providers/saml/callback', ...authzExemption('POST', '/api/auth/providers/saml/callback'), request: { body: { content: { 'application/x-www-form-urlencoded': { schema: z.object({ SAMLResponse: z.string(), RelayState: z.string() }) } } } }, responses: { 302: { description: 'Provider-neutral SAML callback redirect' }, 401: { description: 'Invalid identity provider state' } } });
registry.registerPath({
  method: 'post',
  path: '/api/auth/providers/{providerId}/oidc/backchannel-logout',
  ...authzExemption('POST', '/api/auth/providers/{providerId}/oidc/backchannel-logout'),
  request: {
    params: z.object({ providerId: z.string() }),
    body: { content: { 'application/x-www-form-urlencoded': { schema: z.object({ logout_token: z.string() }).strict() } } },
  },
  responses: { 200: { description: 'Verified provider sessions revoked' }, 400: { description: 'Invalid logout request' }, 401: { description: 'Logout token validation failed' } },
});
registry.registerPath({
  method: 'post',
  path: '/api/auth/identity/{providerKey}/saml/logout',
  ...authzExemption('POST', '/api/auth/identity/{providerKey}/saml/logout'),
  request: {
    params: z.object({ providerKey: z.string() }),
    body: { content: { 'application/x-www-form-urlencoded': { schema: z.object({ SAMLRequest: z.string().optional(), SAMLResponse: z.string().optional(), RelayState: z.string().optional() }).strict() } } },
  },
  responses: { 302: { description: 'Signed SAML logout request handled or correlated response completed' }, 401: { description: 'Signature or correlation validation failed' } },
});
registry.registerPath({
  method: 'get',
  path: '/api/auth/identity/{providerKey}/saml/logout',
  ...authzExemption('GET', '/api/auth/identity/{providerKey}/saml/logout'),
  request: { params: z.object({ providerKey: z.string() }), query: z.object({ SAMLResponse: z.string(), RelayState: z.string(), SigAlg: z.string(), Signature: z.string() }) },
  responses: { 302: { description: 'Signed and correlated SAML Redirect LogoutResponse completed' }, 401: { description: 'Signature or correlation validation failed' } },
});

const TenantProviderParamsSchema = z.object({ tenantSlug: z.string(), providerId: z.string() });
registry.registerPath({ method: 'get', path: '/api/t/{tenantSlug}/auth/login-methods', ...authzExemption('GET', '/api/t/{tenantSlug}/auth/login-methods'), request: { params: z.object({ tenantSlug: z.string() }) }, responses: { 200: { description: 'Tenant-scoped policy-resolved login methods safe to show before authentication', content: { 'application/json': { schema: identityProviderMigrationSchemas.PublicLoginMethodsResponseSchema } } } } });
registry.registerPath({ method: 'get', path: '/api/t/{tenantSlug}/auth/providers/{providerId}/start', ...authzExemption('GET', '/api/t/{tenantSlug}/auth/providers/{providerId}/start'), request: { params: TenantProviderParamsSchema }, responses: { 302: { description: 'Redirect to the selected tenant-scoped OIDC or SAML identity provider' }, 404: { description: 'Identity provider not found in the resolved tenant scope' } } });
registry.registerPath({ method: 'post', path: '/api/t/{tenantSlug}/auth/providers/{providerId}/login', ...authzExemption('POST', '/api/t/{tenantSlug}/auth/providers/{providerId}/login'), request: { params: TenantProviderParamsSchema, body: { content: { 'application/json': { schema: z.object({ username: z.string(), password: z.string() }) } } } }, responses: { 200: { description: 'Tenant-scoped provider-neutral LDAP identity login', content: { 'application/json': { schema: AuthenticatedSessionLoginResponseSchema } } }, 401: { description: 'Invalid directory credentials' } } });

// Tenant SSO config
const TenantSsoConfigResponseSchema = z.object({
  ssoRequired: z.boolean(),
}).strict();

registry.registerPath({
  method: 'get',
  path: '/api/t/{tenantSlug}/auth/sso-config',
  ...authzExemption('GET', '/api/t/{tenantSlug}/auth/sso-config'),
  request: { params: z.object({ tenantSlug: z.string() }) },
  responses: { 200: { description: 'Resolved SSO requirement for the tenant login experience', content: { 'application/json': { schema: TenantSsoConfigResponseSchema } } } },
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
      content: { 'application/json': { schema: InvitationCapabilitiesResponseSchema } },
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
          schema: CreateInvitationRequestSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Invitation created. Manual delivery may include reveal-once onboarding details.',
      content: {
        'application/json': {
          schema: CreateInvitationResponseSchema,
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
  responses: { 200: { description: 'List email configs', content: { 'application/json': { schema: z.array(EmailConfigurationAdminResponseSchema) } } } },
});
registry.registerPath({
  method: 'get',
  path: '/api/admin/email-configs/{id}',
  ...authzExtension('platform.settings.read', 'GET', '/api/admin/email-configs/{id}'),
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: 'Get email config', content: { 'application/json': { schema: EmailConfigurationAdminResponseSchema } } } },
});
registry.registerPath({
  method: 'post',
  path: '/api/admin/email-configs',
  ...authzExtension('platform.settings.manage', 'POST', '/api/admin/email-configs'),
  request: { body: { content: { 'application/json': { schema: CreateEmailConfigurationRequestSchema } } } },
  responses: { 201: { description: 'Created', content: { 'application/json': { schema: EmailConfigurationAdminResponseSchema } } } },
});
registry.registerPath({
  method: 'patch',
  path: '/api/admin/email-configs/{id}',
  ...authzExtension('platform.settings.manage', 'PATCH', '/api/admin/email-configs/{id}'),
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: UpdateEmailConfigurationRequestSchema } } } },
  responses: { 200: { description: 'Updated', content: { 'application/json': { schema: AdminMutationSuccessResponseSchema } } } },
});
registry.registerPath({
  method: 'delete',
  path: '/api/admin/email-configs/{id}',
  ...authzExtension('platform.settings.manage', 'DELETE', '/api/admin/email-configs/{id}'),
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: 'Deleted', content: { 'application/json': { schema: AdminMutationSuccessResponseSchema } } } },
});
registry.registerPath({
  method: 'post',
  path: '/api/admin/email-configs/{id}/set-default',
  ...authzExtension('platform.settings.manage', 'POST', '/api/admin/email-configs/{id}/set-default'),
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: 'Set as default', content: { 'application/json': { schema: AdminMutationSuccessResponseSchema } } } },
});
registry.registerPath({
  method: 'post',
  path: '/api/admin/email-configs/{id}/test',
  ...authzExtension('platform.settings.manage', 'POST', '/api/admin/email-configs/{id}/test'),
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: EmailTestRequestSchema } } } },
  responses: { 200: { description: 'Test email sent', content: { 'application/json': { schema: EmailTestResponseSchema } } } },
});

// Email platform name
registry.registerPath({
  method: 'get',
  path: '/api/admin/email-platform-name',
  ...authzExtension('platform.settings.read', 'GET', '/api/admin/email-platform-name'),
  responses: { 200: { description: 'Platform email name and ownership', content: { 'application/json': { schema: EmailPlatformNameResponseSchema } } } },
});
registry.registerPath({
  method: 'put',
  path: '/api/admin/email-platform-name',
  ...authzExtension('platform.settings.manage', 'PUT', '/api/admin/email-platform-name'),
  request: { body: { content: { 'application/json': { schema: UpdateEmailPlatformNameRequestSchema } } } },
  responses: { 200: { description: 'Platform name updated', content: { 'application/json': { schema: AdminMutationSuccessResponseSchema } } } },
});

// Email templates
registry.registerPath({
  method: 'get',
  path: '/api/admin/email-templates',
  ...authzExtension('platform.settings.read', 'GET', '/api/admin/email-templates'),
  responses: { 200: { description: 'List email templates', content: { 'application/json': { schema: z.array(EmailTemplateAdminResponseSchema) } } } },
});
registry.registerPath({
  method: 'get',
  path: '/api/admin/email-templates/{id}',
  ...authzExtension('platform.settings.read', 'GET', '/api/admin/email-templates/{id}'),
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: 'Get email template', content: { 'application/json': { schema: EmailTemplateAdminResponseSchema } } } },
});
registry.registerPath({
  method: 'patch',
  path: '/api/admin/email-templates/{id}',
  ...authzExtension('platform.settings.manage', 'PATCH', '/api/admin/email-templates/{id}'),
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: UpdateEmailTemplateRequestSchema } } } },
  responses: { 200: { description: 'Template updated', content: { 'application/json': { schema: AdminMutationSuccessResponseSchema } } } },
});
registry.registerPath({
  method: 'post',
  path: '/api/admin/email-templates/{id}/preview',
  ...authzExtension('platform.settings.read', 'POST', '/api/admin/email-templates/{id}/preview'),
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: EmailTemplatePreviewRequestSchema } } },
  },
  responses: { 200: { description: 'Rendered template preview', content: { 'application/json': { schema: EmailTemplatePreviewResponseSchema } } } },
});
registry.registerPath({
  method: 'post',
  path: '/api/admin/email-templates/{id}/reset',
  ...authzExtension('platform.settings.manage', 'POST', '/api/admin/email-templates/{id}/reset'),
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: 'Template reset to default', content: { 'application/json': { schema: AdminMutationSuccessResponseSchema } } } },
});

// -----------------------------
// Authorization (Authz) API
// -----------------------------
const {
  ApiClientCreateSchema,
  ApiClientSchema,
  ApiClientWithTokenSchema,
  AuthzAuditQuerySchema,
  AuthzAuditLogResponseSchema,
  AuthzCheckBatchRequestSchema,
  AuthzCheckBatchResponseSchema,
  AuthzCheckRequestSchema,
  AuthzCheckResponseSchema,
  AuthzCreatedIdResponseSchema,
  AuthzPolicyCreateSchema,
  AuthzPolicyResponseSchema,
  AuthzPolicyUpdateSchema,
  AuthzPrincipalTypeSchema,
  AuthzMutationSuccessResponseSchema,
  AuthzGroupCreateSchema,
  AuthzGroupMembershipCreateSchema,
  AuthzGroupMembershipSchema,
  AuthzGroupSchema,
  AuthzGroupUpdateSchema,
  AuthzResourceTypeSchema,
  CurrentUserPermissionsSchema,
  CustomPermissionCreateSchema,
  CustomPermissionCreateResponseSchema,
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
  ExternalEngineLifecycleRequestSchema,
  ExternalEngineMaterializationDiagnosticsSchema,
  ExternalEngineReactivateResponseSchema,
  ExternalEngineReconcileResponseSchema,
  ExternalEngineRegistrationAuditEntrySchema,
  ExternalEngineRegistrationAuditQuerySchema,
  ExternalEngineRegistrationSchema,
  ExternalEngineSystemCreateSchema,
  ExternalEngineSystemSchema,
  ExternalEngineSystemUpdateSchema,
  IdentityMappingProvisionAccessRequestSchema,
  IdentityMappingProvisionAccessResponseSchema,
  IdentityMappingAccessGrantRequestSchema,
  IdentityMappingAccessGrantResponseSchema,
  IdentityMappingRequestSchema,
  IdentityMappingResponseSchema,
  IdentityMappingStoredSnapshotPreviewRequestSchema,
  IdentityMappingStoredSnapshotPreviewResponseSchema,
  IdentityMappingTestRequestSchema,
  IdentityMappingTestResponseSchema,
  IdentityMappingUpdateSchema,
  PermissionCatalogEntrySchema,
  ProjectEngineTargetCreateSchema,
  ProjectEngineTargetSyncLegacyRequestSchema,
  ProjectEngineTargetSyncLegacyResponseSchema,
  ProjectEngineTargetSchema,
  ProjectEngineTargetUpdateSchema,
  DeploymentEligibilityEvaluateRequestSchema,
  DeploymentEligibilityEvaluateResponseSchema,
  RoleAssignmentCreateSchema,
  RoleAssignmentCreateResponseSchema,
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
  SsoSyncDiagnosticsRunRequestSchema,
  SsoSyncDiagnosticsScanResultSchema,
  SsoSyncEventSchema,
  SsoSyncEventsQuerySchema,
  SsoSyncRunSchema,
  SsoSyncRunsQuerySchema,
  BridgeDecisionRequestSchema,
  BridgeDecisionResponseSchema,
} = await import('./platform-admin/authz.js');

const {
  CamundaNativeGrantImportRunHistorySchema,
  CamundaNativeGrantImportRunSummarySchema,
} = await import('./platform-admin/camunda-native-grants.js');

const {
  EngineBackstopGroupMappingSummarySchema,
  EngineBackstopGroupMappingWriteRequestSchema,
  EngineBackstopGroupMappingWriteResponseSchema,
  EngineBackstopSyncDetailResponseSchema,
  EngineBackstopSyncOperationResponseSchema,
  EngineBackstopSyncApplyRequestSchema,
  EngineBackstopSyncRollbackRequestSchema,
  EngineBackstopSyncRunHistorySchema,
  EngineBackstopSyncRunSummarySchema,
} = await import('./platform-admin/engine-backstop.js');

registry.registerPath({
  method: 'get',
  path: '/engines-api/engines/{id}/project-targets',
  ...authzExtension('engine.project-access.requests.read', 'GET', '/engines-api/engines/{id}/project-targets'),
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: 'Project-engine deployment targets for an engine', content: { 'application/json': { schema: z.array(ProjectEngineTargetSchema) } } } },
});
const ConfigBundleFilesOpenApiSchema = z.object({
  './roles.json': ConfigRolesFileSchema.optional(),
  './groups.json': ConfigGroupsFileSchema.optional(),
  './engines.json': ConfigEnginesFileSchema.optional(),
  './engine-backstop-mappings.json': ConfigEngineBackstopMappingsFileSchema.optional(),
  './engine-tenant-mappings.json': ConfigEngineTenantMappingsFileSchema.optional(),
  './engine-sets.json': ConfigEngineSetsFileSchema.optional(),
  './runtime-resource-sets.json': ConfigRuntimeResourceSetsFileSchema.optional(),
  './assignments.json': ConfigAssignmentsFileSchema.optional(),
  './project-engine-targets.json': ConfigProjectEngineTargetsFileSchema.optional(),
  './identity-providers.json': ConfigIdentityProvidersFileSchema.optional(),
  './identity-provisioning-directories.json': ConfigIdentityProvisioningDirectoriesFileSchema.optional(),
  './identity-mappings.json': ConfigIdentityMappingsFileSchema.optional(),
}).strict();
registry.register('ConfigEngineRegistration', ConfigEngineSchema);
registry.register('ConfigBundleGovernanceV1Beta1', ConfigBundleGovernanceV1Beta1Schema);
registry.register('ConfigBundleGovernanceV1Alpha1Aliases', ConfigBundleSettingsSchema);

const ConfigBundleRequestOpenApiSchema = z.object({
  bundle: EnterpriseGlueConfigBundleSchema,
  files: ConfigBundleFilesOpenApiSchema,
  contract: ConfigBundleContractMetadataSchema.optional(),
});
const ConfigBundleExportResponseOpenApiSchema = ConfigBundleRequestOpenApiSchema.extend({
  contract: ConfigBundleContractMetadataSchema,
});

const ConfigBundleValidationIssueOpenApiSchema = ConfigBundleValidationIssueSchema;
const ConfigBundlePreviewResponseOpenApiSchema = ConfigBundlePreviewResponseSchema;
const ConfigBundleSecretPreflightResponseOpenApiSchema = ConfigBundleSecretPreflightResponseSchema;
const ConfigBundleDiffChangeOpenApiSchema = ConfigBundleDiffChangeSchema;
const ConfigBundleDiffResponseOpenApiSchema = ConfigBundleDiffResponseSchema;
const ConfigBundleApplyRequestOpenApiSchema = ConfigBundleApplyRequestSchema;
const ConfigBundleApplyResponseOpenApiSchema = ConfigBundleApplyResultSchema;
const ConfigBundleApplyRunOpenApiSchema = ConfigBundleApplyRunSchema;
const GovernanceOwnershipRequestOpenApiSchema = GovernanceOwnershipRequestSchema;
const GovernanceOwnershipApplyRequestOpenApiSchema = GovernanceOwnershipApplyRequestSchema;
const GovernanceOwnershipStateOpenApiSchema = GovernanceOwnershipStateSchema;
const GovernanceOwnershipPreviewOpenApiSchema = GovernanceOwnershipPreviewResponseSchema;
const GovernanceOwnershipReceiptOpenApiSchema = GovernanceOwnershipReceiptSchema;

// POST /api/authz/check
registry.registerPath({
  method: 'post',
  path: '/api/authz/check',
  ...authzExemption('POST', '/api/authz/check'),
  request: { body: { content: { 'application/json': { schema: AuthzCheckRequestSchema } } } },
  responses: { 200: { description: 'Authorization check result', content: { 'application/json': { schema: AuthzCheckResponseSchema } } } },
});

// POST /api/authz/check-batch
registry.registerPath({
  method: 'post',
  path: '/api/authz/check-batch',
  ...authzExemption('POST', '/api/authz/check-batch'),
  request: { body: { content: { 'application/json': { schema: AuthzCheckBatchRequestSchema } } } },
  responses: { 200: { description: 'Batch authorization results', content: { 'application/json': { schema: AuthzCheckBatchResponseSchema } } } },
});

// Authz policies
registry.registerPath({ method: 'get', path: '/api/authz/me/permissions', ...authzExemption('GET', '/api/authz/me/permissions'), responses: { 200: { description: 'Current user effective permissions', content: { 'application/json': { schema: CurrentUserPermissionsSchema } } } } });
registry.registerPath({ method: 'get', path: '/api/authz/permissions', ...authzExtension('platform.authz.permissions.read', 'GET', '/api/authz/permissions'), responses: { 200: { description: 'Permission catalog', content: { 'application/json': { schema: z.array(PermissionCatalogEntrySchema) } } } } });
registry.registerPath({ method: 'post', path: '/api/authz/permissions', ...authzExtension('platform.authz.roles.manage', 'POST', '/api/authz/permissions'), request: { body: { content: { 'application/json': { schema: CustomPermissionCreateSchema } } } }, responses: { 201: { description: 'Custom permission created', content: { 'application/json': { schema: CustomPermissionCreateResponseSchema } } } } });
registry.registerPath({ method: 'get', path: '/api/authz/roles', ...authzExtension('platform.authz.roles.read', 'GET', '/api/authz/roles'), responses: { 200: { description: 'List roles', content: { 'application/json': { schema: z.array(RoleSummarySchema) } } } } });
registry.registerPath({ method: 'get', path: '/api/authz/roles/{id}', ...authzExtension('platform.authz.roles.read', 'GET', '/api/authz/roles/{id}'), request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'Get role details', content: { 'application/json': { schema: RoleDetailSchema } } } } });
registry.registerPath({ method: 'post', path: '/api/authz/roles', ...authzExtension('platform.authz.roles.manage', 'POST', '/api/authz/roles'), request: { body: { content: { 'application/json': { schema: CustomRoleCreateSchema } } } }, responses: { 201: { description: 'Custom role created', content: { 'application/json': { schema: AuthzCreatedIdResponseSchema } } } } });
registry.registerPath({ method: 'put', path: '/api/authz/roles/{id}', ...authzExtension('platform.authz.roles.manage', 'PUT', '/api/authz/roles/{id}'), request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: CustomRoleUpdateSchema } } } }, responses: { 200: { description: 'Custom role updated', content: { 'application/json': { schema: AuthzMutationSuccessResponseSchema } } } } });
registry.registerPath({ method: 'delete', path: '/api/authz/roles/{id}', ...authzExtension('platform.authz.roles.manage', 'DELETE', '/api/authz/roles/{id}'), request: { params: z.object({ id: z.string() }) }, responses: { 204: { description: 'Custom role archived' } } });
registry.registerPath({ method: 'post', path: '/api/authz/config-bundles/import-zip', ...authzExtension('platform.config-bundles.preview', 'POST', '/api/authz/config-bundles/import-zip'), request: { body: { content: { 'application/zip': { schema: z.string() }, 'application/octet-stream': { schema: z.string() } } } }, responses: { 200: { description: 'Convert a validated folder-style configuration ZIP into the standard bundle envelope', content: { 'application/json': { schema: ConfigBundleRequestOpenApiSchema } } }, 422: { description: 'Invalid configuration ZIP archive' } } });
registry.registerPath({ method: 'post', path: '/api/authz/config-bundles/import-url', ...authzExtension('platform.config-bundles.preview', 'POST', '/api/authz/config-bundles/import-url'), request: { body: { content: { 'application/json': { schema: ConfigBundleRemoteImportRequestSchema } } } }, responses: { 200: { description: 'Import a bounded GitHub or GitLab raw JSON/ZIP configuration file into the standard bundle envelope', content: { 'application/json': { schema: ConfigBundleRequestOpenApiSchema } } }, 422: { description: 'Unsupported or invalid remote configuration source' } } });
registry.registerPath({ method: 'post', path: '/api/authz/config-bundles/preview', summary: 'Preview a headless authorization and engine configuration bundle', description: 'Validates the manifest and imported object files without persistence. Use v1beta1 governance names for new bundles. Omit bundle.governance for engine-only or identity-only bundles that must not claim platform governance settings; v1alpha1 settings aliases remain accepted with warnings.', ...authzExtension('platform.config-bundles.preview', 'POST', '/api/authz/config-bundles/preview'), request: { body: { content: { 'application/json': { schema: ConfigBundleRequestOpenApiSchema } } } }, responses: { 200: { description: 'Validated config bundle preview', content: { 'application/json': { schema: ConfigBundlePreviewResponseOpenApiSchema } } }, 422: { description: 'Invalid config bundle preview', content: { 'application/json': { schema: ConfigBundlePreviewResponseOpenApiSchema } } } } });
registry.registerPath({ method: 'post', path: '/api/authz/config-bundles/validate-secret-refs', ...authzExtension('platform.config-bundles.preview', 'POST', '/api/authz/config-bundles/validate-secret-refs'), request: { body: { content: { 'application/json': { schema: ConfigBundleRequestOpenApiSchema } } } }, responses: { 200: { description: 'Secret-reference availability without secret values', content: { 'application/json': { schema: ConfigBundleSecretPreflightResponseOpenApiSchema } } }, 422: { description: 'Invalid configuration bundle', content: { 'application/json': { schema: ConfigBundleSecretPreflightResponseOpenApiSchema } } } } });
registry.registerPath({ method: 'post', path: '/api/authz/config-bundles/diff', summary: 'Diff a headless configuration bundle against persisted state', description: 'Reports persisted changes without mutation. Platform governance appears only when the raw manifest explicitly declares at least one governance field.', ...authzExtension('platform.config-bundles.preview', 'POST', '/api/authz/config-bundles/diff'), request: { body: { content: { 'application/json': { schema: ConfigBundleRequestOpenApiSchema } } } }, responses: { 200: { description: 'Persisted config bundle diff', content: { 'application/json': { schema: ConfigBundleDiffResponseOpenApiSchema } } }, 422: { description: 'Invalid config bundle input', content: { 'application/json': { schema: ConfigBundleDiffResponseOpenApiSchema } } } } });
registry.registerPath({ method: 'post', path: '/api/authz/config-bundles/apply', summary: 'Apply an exact reviewed headless configuration preview', description: 'Applies the exact canonical preview hash. Platform governance is changed only when the raw manifest explicitly declares at least one version-appropriate governance field; omitted v1beta1 governance (or v1alpha1 settings) never claims or resets portal-owned values.', ...authzExtension('platform.config-bundles.apply', 'POST', '/api/authz/config-bundles/apply'), request: { body: { content: { 'application/json': { schema: ConfigBundleApplyRequestOpenApiSchema } } } }, responses: { 200: { description: 'Applied config bundle with all requested reconciliation complete', content: { 'application/json': { schema: ConfigBundleApplyResponseOpenApiSchema } } }, 202: { description: 'Applied config bundle with durable identity or runtime reconciliation queued; inspect applyRunId and task receipts', content: { 'application/json': { schema: ConfigBundleApplyResponseOpenApiSchema } } }, 409: { description: 'Preview hash or ownership conflict' }, 422: { description: 'Invalid or unsupported config bundle' } } });
registry.registerPath({ method: 'get', path: '/api/authz/config-bundles/governance-ownership', summary: 'Read current governance-settings ownership', description: 'Returns only the provenance state needed to create a transfer, release, or retirement preview.', ...authzExtension('platform.config-bundles.view', 'GET', '/api/authz/config-bundles/governance-ownership'), responses: { 200: { description: 'Current governance ownership state', content: { 'application/json': { schema: GovernanceOwnershipStateOpenApiSchema } } } } });
registry.registerPath({ method: 'post', path: '/api/authz/config-bundles/governance-ownership/preview', summary: 'Preview transfer, release, or retirement of governance settings ownership', description: 'Previews only governance-settings provenance. Engines, roles, groups, assignments, identity providers, mappings, and project-engine targets are explicitly preserved.', ...authzExtension('platform.config-bundles.preview', 'POST', '/api/authz/config-bundles/governance-ownership/preview'), request: { body: { content: { 'application/json': { schema: GovernanceOwnershipRequestOpenApiSchema } } } }, responses: { 200: { description: 'Hash-bound governance ownership preview', content: { 'application/json': { schema: GovernanceOwnershipPreviewOpenApiSchema } } }, 409: { description: 'Current source owner mismatch', content: { 'application/json': { schema: GovernanceOwnershipPreviewOpenApiSchema } } } } });
registry.registerPath({ method: 'post', path: '/api/authz/config-bundles/governance-ownership/apply', summary: 'Apply an exact governance ownership preview', description: 'Requires an unexpired hash, every acknowledgement, and an idempotency key. The transaction updates only governance provenance and writes an immutable receipt.', ...authzExtension('platform.config-bundles.apply', 'POST', '/api/authz/config-bundles/governance-ownership/apply'), request: { body: { content: { 'application/json': { schema: GovernanceOwnershipApplyRequestOpenApiSchema } } } }, responses: { 200: { description: 'Governance ownership transfer receipt', content: { 'application/json': { schema: GovernanceOwnershipReceiptOpenApiSchema } } }, 409: { description: 'Stale or conflicting preview' } } });
registry.registerPath({ method: 'get', path: '/api/authz/config-bundles/governance-ownership/receipts', ...authzExtension('platform.config-bundles.view', 'GET', '/api/authz/config-bundles/governance-ownership/receipts'), request: { query: z.object({ limit: z.coerce.number().int().min(1).max(100).optional() }) }, responses: { 200: { description: 'Immutable governance ownership receipts', content: { 'application/json': { schema: z.array(GovernanceOwnershipReceiptOpenApiSchema) } } } } });
registry.registerPath({ method: 'get', path: '/api/authz/config-bundles/governance-ownership/receipts/{id}', ...authzExtension('platform.config-bundles.view', 'GET', '/api/authz/config-bundles/governance-ownership/receipts/{id}'), request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'One governance ownership receipt', content: { 'application/json': { schema: GovernanceOwnershipReceiptOpenApiSchema } } }, 404: { description: 'Governance ownership receipt not found' } } });
registry.registerPath({ method: 'get', path: '/api/authz/config-bundles/runs', ...authzExtension('platform.config-bundles.view', 'GET', '/api/authz/config-bundles/runs'), request: { query: z.object({ limit: z.coerce.number().int().min(1).max(100).optional() }) }, responses: { 200: { description: 'Recent hash-bound configuration bundle applies', content: { 'application/json': { schema: z.array(ConfigBundleApplyRunOpenApiSchema) } } } } });
registry.registerPath({ method: 'get', path: '/api/authz/config-bundles/runs/{id}', ...authzExtension('platform.config-bundles.view', 'GET', '/api/authz/config-bundles/runs/{id}'), request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'One hash-bound configuration bundle apply receipt', content: { 'application/json': { schema: ConfigBundleApplyRunOpenApiSchema } } }, 404: { description: 'Configuration bundle apply run not found' } } });
registry.registerPath({ method: 'get', path: '/api/authz/config-bundles/runs/{id}/identity-replay-tasks', ...authzExtension('platform.config-bundles.view', 'GET', '/api/authz/config-bundles/runs/{id}/identity-replay-tasks'), request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'Durable stored identity replay continuation tasks for one configuration apply, cross-linked to their SSO sync runs', content: { 'application/json': { schema: z.array(z.object({ id: z.string(), providerId: z.string(), syncRunId: z.string().nullable(), status: z.enum(['queued', 'running', 'completed', 'cancelled']), attempts: z.number().int().nonnegative(), nextAttemptAt: z.number().int().nullable(), scanned: z.number().int().nonnegative(), created: z.number().int().nonnegative(), removed: z.number().int().nonnegative(), failed: z.number().int().nonnegative(), lastError: z.string().nullable(), completedAt: z.number().int().nullable(), createdAt: z.number().int(), updatedAt: z.number().int() })) } } }, 404: { description: 'Configuration bundle apply run not found' } } });
registry.registerPath({ method: 'get', path: '/api/authz/config-bundles/runs/{id}/runtime-reconciliation-tasks', ...authzExtension('platform.config-bundles.view', 'GET', '/api/authz/config-bundles/runs/{id}/runtime-reconciliation-tasks'), request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'Durable post-apply Engine Set and runtime-resource reconciliation tasks for one configuration apply', content: { 'application/json': { schema: z.array(z.object({ id: z.string(), status: z.enum(['queued', 'running', 'completed']), attempts: z.number().int().nonnegative(), nextAttemptAt: z.number().int().nullable(), engineSetIds: z.array(z.string()), runtimeResourceSetIds: z.array(z.string()), engineIds: z.array(z.string()), lastError: z.string().nullable(), completedAt: z.number().int().nullable(), createdAt: z.number().int(), updatedAt: z.number().int() })) } } }, 404: { description: 'Configuration bundle apply run not found' } } });
registry.registerPath({ method: 'get', path: '/api/authz/config-bundles/export', summary: 'Export source-owned records as a reusable v1beta1 headless bundle', description: 'Exports apply-supported configuration-owned authorization, identity, engine, and deployment-target records. The v1beta1 governance block is included only when this bundle owns the current platform-governance row; otherwise it is omitted. Contract metadata records that the export is already normalized.', ...authzExtension('platform.config-bundles.export', 'GET', '/api/authz/config-bundles/export'), request: { query: z.object({ bundleKey: z.string(), tenantKey: z.string().optional() }) }, responses: { 200: { description: 'Reusable v1beta1 configuration bundle envelope', content: { 'application/json': { schema: ConfigBundleExportResponseOpenApiSchema } } } } });
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
registry.registerPath({ method: 'post', path: '/api/authz/role-assignments', ...authzExtension('platform.authz.assignments.create', 'POST', '/api/authz/role-assignments'), request: { body: { content: { 'application/json': { schema: RoleAssignmentCreateSchema } } } }, responses: { 201: { description: 'Role assignment created', content: { 'application/json': { schema: RoleAssignmentCreateResponseSchema } } }, 403: { description: 'The selected engine/project access domain is SSO-managed or the caller lacks permission' } } });
registry.registerPath({ method: 'delete', path: '/api/authz/role-assignments/{id}', ...authzExtension('platform.authz.assignments.delete', 'DELETE', '/api/authz/role-assignments/:id'), request: { params: z.object({ id: z.string() }) }, responses: { 204: { description: 'Manual role assignment removed' }, 403: { description: 'The assignment access domain is SSO-managed, source-owned, or the caller lacks permission' } } });
registry.registerPath({ method: 'get', path: '/api/authz/groups', ...authzExtension('platform.authz.groups.read', 'GET', '/api/authz/groups'), request: { query: z.object({ includeArchived: z.enum(['true', 'false']).optional() }) }, responses: { 200: { description: 'List authorization groups', content: { 'application/json': { schema: z.array(AuthzGroupSchema) } } } } });
registry.registerPath({ method: 'post', path: '/api/authz/groups', ...authzExtension('platform.authz.groups.manage', 'POST', '/api/authz/groups'), request: { body: { content: { 'application/json': { schema: AuthzGroupCreateSchema } } } }, responses: { 201: { description: 'Authorization group created', content: { 'application/json': { schema: AuthzCreatedIdResponseSchema } } } } });
registry.registerPath({ method: 'put', path: '/api/authz/groups/{id}', ...authzExtension('platform.authz.groups.manage', 'PUT', '/api/authz/groups/:id'), request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: AuthzGroupUpdateSchema } } } }, responses: { 200: { description: 'Authorization group updated', content: { 'application/json': { schema: AuthzMutationSuccessResponseSchema } } } } });
registry.registerPath({ method: 'delete', path: '/api/authz/groups/{id}', ...authzExtension('platform.authz.groups.manage', 'DELETE', '/api/authz/groups/:id'), request: { params: z.object({ id: z.string() }) }, responses: { 204: { description: 'Authorization group archived' } } });
registry.registerPath({ method: 'get', path: '/api/authz/group-memberships', ...authzExtension('platform.authz.groups.read', 'GET', '/api/authz/group-memberships'), request: { query: z.object({ groupId: z.string().optional(), userId: z.string().optional() }) }, responses: { 200: { description: 'List authorization group memberships', content: { 'application/json': { schema: z.array(AuthzGroupMembershipSchema) } } } } });
registry.registerPath({ method: 'post', path: '/api/authz/group-memberships', ...authzExtension('platform.authz.groups.manage', 'POST', '/api/authz/group-memberships'), request: { body: { content: { 'application/json': { schema: AuthzGroupMembershipCreateSchema } } } }, responses: { 201: { description: 'Authorization group membership created', content: { 'application/json': { schema: AuthzCreatedIdResponseSchema } } } } });
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
registry.registerPath({ method: 'get', path: '/api/authz/external-engines/{id}/audit', ...authzExtension('platform.external-engines.audit.read', 'GET', '/api/authz/external-engines/{id}/audit'), request: { params: z.object({ id: z.string() }), query: ExternalEngineRegistrationAuditQuerySchema }, responses: { 200: { description: 'List external engine registration audit entries', content: { 'application/json': { schema: z.array(ExternalEngineRegistrationAuditEntrySchema) } } } } });
registry.registerPath({ method: 'post', path: '/api/authz/external-engines/{id}/decommission', ...authzExtension('platform.external-engines.lifecycle.manage', 'POST', '/api/authz/external-engines/{id}/decommission'), request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: ExternalEngineLifecycleRequestSchema } } } }, responses: { 200: { description: 'Externally registered engine decommissioned by platform admin', content: { 'application/json': { schema: ExternalEngineDecommissionResponseSchema } } } } });
registry.registerPath({ method: 'post', path: '/api/authz/external-engines/{id}/reactivate', ...authzExtension('platform.external-engines.lifecycle.manage', 'POST', '/api/authz/external-engines/{id}/reactivate'), request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: ExternalEngineLifecycleRequestSchema } } } }, responses: { 200: { description: 'Externally registered engine reactivated by platform admin', content: { 'application/json': { schema: ExternalEngineReactivateResponseSchema } } } } });
registry.registerPath({ method: 'post', path: '/api/authz/external-engines/{id}/reconcile', ...authzExtension('platform.external-engines.reconcile', 'POST', '/api/authz/external-engines/{id}/reconcile'), request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'Reconcile external engine capability and Engine Set materialization state', content: { 'application/json': { schema: ExternalEngineReconcileResponseSchema } } } } });
registry.registerPath({ method: 'get', path: '/api/authz/engine-sets', ...authzExtension('platform.engine-sets.read', 'GET', '/api/authz/engine-sets'), request: { query: z.object({ includeArchived: z.enum(['true', 'false']).optional() }) }, responses: { 200: { description: 'List Engine Sets', content: { 'application/json': { schema: z.array(EngineSetSummarySchema) } } } } });
registry.registerPath({ method: 'post', path: '/api/authz/engine-sets/preview', ...authzExtension('platform.engine-sets.manage', 'POST', '/api/authz/engine-sets/preview'), request: { body: { content: { 'application/json': { schema: z.object({ selector: EngineSetSelectorSchema }) } } } }, responses: { 200: { description: 'Preview Engine Set selector matches', content: { 'application/json': { schema: EngineSetPreviewSchema } } } } });
registry.registerPath({ method: 'post', path: '/api/authz/engine-sets', ...authzExtension('platform.engine-sets.manage', 'POST', '/api/authz/engine-sets'), request: { body: { content: { 'application/json': { schema: EngineSetCreateSchema } } } }, responses: { 201: { description: 'Engine Set created', content: { 'application/json': { schema: AuthzCreatedIdResponseSchema } } } } });
registry.registerPath({ method: 'get', path: '/api/authz/engine-sets/{id}', ...authzExtension('platform.engine-sets.read', 'GET', '/api/authz/engine-sets/:id'), request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'Get Engine Set details', content: { 'application/json': { schema: EngineSetDetailSchema } } } } });
registry.registerPath({ method: 'put', path: '/api/authz/engine-sets/{id}', ...authzExtension('platform.engine-sets.manage', 'PUT', '/api/authz/engine-sets/:id'), request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: EngineSetCreateSchema.partial() } } } }, responses: { 200: { description: 'Engine Set updated', content: { 'application/json': { schema: AuthzMutationSuccessResponseSchema } } } } });
registry.registerPath({ method: 'delete', path: '/api/authz/engine-sets/{id}', ...authzExtension('platform.engine-sets.manage', 'DELETE', '/api/authz/engine-sets/:id'), request: { params: z.object({ id: z.string() }) }, responses: { 204: { description: 'Engine Set archived' } } });
registry.registerPath({ method: 'post', path: '/api/authz/engine-sets/{id}/materialize', ...authzExtension('platform.engine-sets.manage', 'POST', '/api/authz/engine-sets/:id/materialize'), request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'Refresh Engine Set materialization', content: { 'application/json': { schema: EngineSetMaterializationResultSchema } } } } });
registry.registerPath({ method: 'get', path: '/api/authz/runtime-resources', ...authzExtension('platform.engine-sets.read', 'GET', '/api/authz/runtime-resources'), request: { query: RuntimeResourceQuerySchema }, responses: { 200: { description: 'List persisted runtime resource inventory for an engine', content: { 'application/json': { schema: z.array(RuntimeResourceSchema) } } } } });
registry.registerPath({ method: 'get', path: '/api/authz/runtime-resource-sets', ...authzExtension('platform.engine-sets.read', 'GET', '/api/authz/runtime-resource-sets'), request: { query: RuntimeResourceSetQuerySchema }, responses: { 200: { description: 'List Runtime Resource Sets', content: { 'application/json': { schema: z.array(RuntimeResourceSetSchema) } } } } });
registry.registerPath({ method: 'post', path: '/api/authz/runtime-resource-sets/{id}/materialize', ...authzExtension('platform.engine-sets.manage', 'POST', '/api/authz/runtime-resource-sets/:id/materialize'), request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'Refresh Runtime Resource Set materialization', content: { 'application/json': { schema: RuntimeResourceSetMaterializationResultSchema } } } } });
registry.registerPath({ method: 'post', path: '/api/authz/runtime-resources/{id}/reconcile', ...authzExtension('platform.engine-sets.manage', 'POST', '/api/authz/runtime-resources/:id/reconcile'), request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'Discover runtime definitions and deployments, deactivate absent resources, and refresh Runtime Resource Set materializations', content: { 'application/json': { schema: EngineMetadataReconciliationResultSchema } } } } });
registry.registerPath({ method: 'get', path: '/engines-api/engines/{id}/runtime-resources', ...authzExtension('engine.inventory.read', 'GET', '/engines-api/engines/{id}/runtime-resources'), request: { params: z.object({ id: z.string() }), query: z.object({ resourceKind: z.enum(['process_definition', 'decision_definition']).optional(), includeInactive: z.enum(['true', 'false']).optional() }) }, responses: { 200: { description: 'Sanitized runtime resource inventory for one engine', content: { 'application/json': { schema: z.array(RuntimeResourceSchema) } } } } });
registry.registerPath({ method: 'post', path: '/engines-api/engines/{id}/runtime-resources/reconcile', ...authzExtension('engine.inventory.update', 'POST', '/engines-api/engines/{id}/runtime-resources/reconcile'), request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'Reconcile runtime and deployment metadata for one engine', content: { 'application/json': { schema: EngineMetadataReconciliationResultSchema } } } } });
const CamundaNativeGrantPreviewRequestSchema = z.object({ sourceKind: z.enum(['live_api', 'customer_export']), customerExport: z.unknown().optional() });
const CamundaNativeGrantDraftRequestSchema = z.object({ base: z.object({ bundle: z.unknown(), files: z.record(z.string(), z.unknown()) }), groupMappings: z.array(z.unknown()) });
const CamundaNativeGrantApplyRequestSchema = z.object({ expectedDraftHash: z.string().regex(/^[a-f0-9]{64}$/), acknowledgements: z.array(z.string()).optional() });
const CamundaNativeGrantRollbackRequestSchema = z.object({ expectedRollbackHash: z.string().regex(/^[a-f0-9]{64}$/), acknowledgements: z.array(z.string()) });
registry.registerPath({ method: 'post', path: '/engines-api/engines/{id}/camunda-native-grants/imports/preview', ...authzExtension('platform.camunda-native-grants.preview', 'POST', '/engines-api/engines/{id}/camunda-native-grants/imports/preview'), request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: CamundaNativeGrantPreviewRequestSchema } } } }, responses: { 201: { description: 'Sanitized Camunda 7 native-grant migration preview', content: { 'application/json': { schema: z.object({ run: z.unknown() }) } } } } });
registry.registerPath({ method: 'get', path: '/engines-api/engines/{id}/camunda-native-grants/imports', ...authzExtension('platform.camunda-native-grants.history.read', 'GET', '/engines-api/engines/{id}/camunda-native-grants/imports'), request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'Bounded newest-first sanitized Camunda native-grant migration receipts for one engine and tenant', content: { 'application/json': { schema: CamundaNativeGrantImportRunHistorySchema } } } } });
registry.registerPath({ method: 'get', path: '/engines-api/engines/{id}/camunda-native-grants/imports/{runId}', ...authzExtension('platform.camunda-native-grants.history.read', 'GET', '/engines-api/engines/{id}/camunda-native-grants/imports/{runId}'), request: { params: z.object({ id: z.string(), runId: z.string() }) }, responses: { 200: { description: 'Sanitized Camunda native-grant migration receipt', content: { 'application/json': { schema: z.object({ run: CamundaNativeGrantImportRunSummarySchema }) } } } } });
registry.registerPath({ method: 'get', path: '/engines-api/engines/{id}/camunda-native-grants/imports/{runId}/detail', ...authzExtension('platform.camunda-native-grants.sensitive.read', 'GET', '/engines-api/engines/{id}/camunda-native-grants/imports/{runId}/detail'), request: { params: z.object({ id: z.string(), runId: z.string() }) }, responses: { 200: { description: 'Permission-gated, short-lived Camunda native-grant detail', content: { 'application/json': { schema: z.object({ run: z.unknown(), detail: z.unknown() }) } } } } });
registry.registerPath({ method: 'post', path: '/engines-api/engines/{id}/camunda-native-grants/imports/{runId}/draft', ...authzExtension('platform.camunda-native-grants.draft', 'POST', '/engines-api/engines/{id}/camunda-native-grants/imports/{runId}/draft'), request: { params: z.object({ id: z.string(), runId: z.string() }), body: { content: { 'application/json': { schema: CamundaNativeGrantDraftRequestSchema } } } }, responses: { 200: { description: 'Hash-bound EnterpriseGlue configuration draft generated from reviewed native grants', content: { 'application/json': { schema: z.object({ run: z.unknown().nullable(), draft: z.unknown() }) } } } } });
registry.registerPath({ method: 'post', path: '/engines-api/engines/{id}/camunda-native-grants/imports/{runId}/apply', ...authzExtension('platform.config-bundles.apply', 'POST', '/engines-api/engines/{id}/camunda-native-grants/imports/{runId}/apply'), request: { params: z.object({ id: z.string(), runId: z.string() }), body: { content: { 'application/json': { schema: CamundaNativeGrantApplyRequestSchema } } } }, responses: { 200: { description: 'Applies the exact encrypted, reviewed native-grant configuration draft and records its apply receipt', content: { 'application/json': { schema: z.object({ run: z.unknown(), result: z.unknown() }) } } } } });
registry.registerPath({ method: 'post', path: '/engines-api/engines/{id}/camunda-native-grants/imports/{runId}/rollback/preview', ...authzExtension('platform.config-bundles.preview', 'POST', '/engines-api/engines/{id}/camunda-native-grants/imports/{runId}/rollback/preview'), request: { params: z.object({ id: z.string(), runId: z.string() }), body: { content: { 'application/json': { schema: z.object({}) } } } }, responses: { 200: { description: 'Hash-bound, no-change rollback preview for import-owned configuration records', content: { 'application/json': { schema: z.object({ rollback: z.unknown() }) } } } } });
registry.registerPath({ method: 'post', path: '/engines-api/engines/{id}/camunda-native-grants/imports/{runId}/rollback', ...authzExtension('platform.config-bundles.apply', 'POST', '/engines-api/engines/{id}/camunda-native-grants/imports/{runId}/rollback'), request: { params: z.object({ id: z.string(), runId: z.string() }), body: { content: { 'application/json': { schema: CamundaNativeGrantRollbackRequestSchema } } } }, responses: { 200: { description: 'Archives only the records owned by the reviewed native-grant import and records its rollback receipt', content: { 'application/json': { schema: z.object({ run: z.unknown(), result: z.unknown() }) } } } } });
registry.registerPath({
  method: 'get',
  path: '/engines-api/engines/{id}/backstop/status',
  summary: 'Read mirrored-backstop status',
  description: customerSidecarBackstopDescription,
  ...authzExtension('platform.engine-backstop.read', 'GET', '/engines-api/engines/{id}/backstop/status'),
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: 'Sanitized mirrored-engine backstop status', content: { 'application/json': { schema: z.object({ mappings: z.array(EngineBackstopGroupMappingSummarySchema), latestRun: EngineBackstopSyncRunSummarySchema.nullable() }) } } } },
});
registry.registerPath({
  method: 'get',
  path: '/engines-api/engines/{id}/backstop/mappings',
  summary: 'List opaque mirrored-backstop mappings',
  description: customerSidecarBackstopDescription,
  ...authzExtension('platform.engine-backstop.read', 'GET', '/engines-api/engines/{id}/backstop/mappings'),
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: 'Opaque EnterpriseGlue-to-native-engine group mappings', content: { 'application/json': { schema: z.object({ mappings: z.array(EngineBackstopGroupMappingSummarySchema) }) } } } },
});
registry.registerPath({
  method: 'post',
  path: '/engines-api/engines/{id}/backstop/mappings',
  summary: 'Write opaque mirrored-backstop mappings',
  description: customerSidecarBackstopDescription,
  ...authzExtension('platform.engine-backstop.manage', 'POST', '/engines-api/engines/{id}/backstop/mappings'),
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: EngineBackstopGroupMappingWriteRequestSchema } } } },
  responses: { 200: { description: 'Encrypted group mappings updated', content: { 'application/json': { schema: EngineBackstopGroupMappingWriteResponseSchema } } } },
});
registry.registerPath({
  method: 'post',
  path: '/engines-api/engines/{id}/backstop/sync/preview',
  summary: 'Preview a mirrored-backstop synchronization',
  description: customerSidecarBackstopDescription,
  ...authzExtension('platform.engine-backstop.preview', 'POST', '/engines-api/engines/{id}/backstop/sync/preview'),
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: z.object({}) } } } },
  responses: { 201: { description: 'Hash-bound sanitized mirrored-engine backstop preview', content: { 'application/json': { schema: z.object({ run: EngineBackstopSyncRunSummarySchema }) } } } },
});
registry.registerPath({ method: 'get', path: '/engines-api/engines/{id}/backstop/sync', summary: 'List mirrored-backstop synchronization receipts', description: customerSidecarBackstopDescription, ...authzExtension('platform.engine-backstop.read', 'GET', '/engines-api/engines/{id}/backstop/sync'), request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'Bounded sanitized mirrored-engine backstop history', content: { 'application/json': { schema: EngineBackstopSyncRunHistorySchema } } } } });
registry.registerPath({ method: 'get', path: '/engines-api/engines/{id}/backstop/sync/{runId}', summary: 'Read a mirrored-backstop receipt', description: customerSidecarBackstopDescription, ...authzExtension('platform.engine-backstop.read', 'GET', '/engines-api/engines/{id}/backstop/sync/{runId}'), request: { params: z.object({ id: z.string(), runId: z.string() }) }, responses: { 200: { description: 'Sanitized mirrored-engine backstop receipt', content: { 'application/json': { schema: z.object({ run: EngineBackstopSyncRunSummarySchema }) } } } } });
registry.registerPath({ method: 'get', path: '/engines-api/engines/{id}/backstop/sync/{runId}/detail', summary: 'Read permission-gated mirrored-backstop detail', description: customerSidecarBackstopDescription, ...authzExtension('platform.engine-backstop.sensitive.read', 'GET', '/engines-api/engines/{id}/backstop/sync/{runId}/detail'), request: { params: z.object({ id: z.string(), runId: z.string() }) }, responses: { 200: { description: 'Permission-gated encrypted mirrored-engine backstop detail', content: { 'application/json': { schema: EngineBackstopSyncDetailResponseSchema } } } } });
registry.registerPath({
  method: 'post',
  path: '/engines-api/engines/{id}/backstop/sync/{runId}/apply',
  summary: 'Apply a reviewed mirrored-backstop preview',
  description: customerSidecarBackstopDescription,
  ...authzExtension('platform.engine-backstop.apply', 'POST', '/engines-api/engines/{id}/backstop/sync/{runId}/apply'),
  request: { params: z.object({ id: z.string(), runId: z.string() }), body: { content: { 'application/json': { schema: EngineBackstopSyncApplyRequestSchema } } } },
  responses: { 200: { description: 'Applies an acknowledged mirrored-engine backstop preview', content: { 'application/json': { schema: EngineBackstopSyncOperationResponseSchema } } } },
});
registry.registerPath({
  method: 'post',
  path: '/engines-api/engines/{id}/backstop/sync/{runId}/rollback',
  summary: 'Roll back owned mirrored-backstop grants',
  description: customerSidecarBackstopDescription,
  ...authzExtension('platform.engine-backstop.apply', 'POST', '/engines-api/engines/{id}/backstop/sync/{runId}/rollback'),
  request: { params: z.object({ id: z.string(), runId: z.string() }), body: { content: { 'application/json': { schema: EngineBackstopSyncRollbackRequestSchema } } } },
  responses: { 200: { description: 'Deletes only native authorization IDs owned by a successful mirrored-engine backstop run', content: { 'application/json': { schema: EngineBackstopSyncOperationResponseSchema } } } },
});
registry.registerPath({
  method: 'post',
  path: '/engines-api/engines/{id}/backstop/sync/{runId}/drift-check',
  summary: 'Check tracked mirrored-backstop grants for drift',
  description: customerSidecarBackstopDescription,
  ...authzExtension('platform.engine-backstop.drift-check', 'POST', '/engines-api/engines/{id}/backstop/sync/{runId}/drift-check'),
  request: { params: z.object({ id: z.string(), runId: z.string() }), body: { content: { 'application/json': { schema: z.object({}) } } } },
  responses: { 200: { description: 'Reads only tracked native authorization IDs and records a sanitized drift receipt', content: { 'application/json': { schema: EngineBackstopSyncOperationResponseSchema } } } },
});
registry.registerPath({ method: 'get', path: '/api/authz/project-engine-targets', ...authzExtension('platform.project-engine-targets.read', 'GET', '/api/authz/project-engine-targets'), request: { query: z.object({ projectId: z.string().optional(), engineId: z.string().optional(), status: z.enum(['active', 'disabled', 'archived', 'all']).optional(), source: z.enum(['manual', 'legacy', 'ci', 'api', 'import', 'deployment_history', 'external', 'system', 'automation', 'config']).optional() }) }, responses: { 200: { description: 'List project-engine targets', content: { 'application/json': { schema: z.array(ProjectEngineTargetSchema) } } } } });
registry.registerPath({ method: 'post', path: '/api/authz/project-engine-targets/evaluate', ...authzExtension('project.deployment-eligibility.evaluate', 'POST', '/api/authz/project-engine-targets/evaluate'), request: { body: { content: { 'application/json': { schema: DeploymentEligibilityEvaluateRequestSchema } } } }, responses: { 200: { description: 'Deployment eligibility evaluation', content: { 'application/json': { schema: DeploymentEligibilityEvaluateResponseSchema } } } } });
registry.registerPath({ method: 'post', path: '/api/authz/project-engine-targets/sync-legacy', ...authzExtension('platform.project-engine-targets.manage', 'POST', '/api/authz/project-engine-targets/sync-legacy'), request: { body: { content: { 'application/json': { schema: ProjectEngineTargetSyncLegacyRequestSchema } } } }, responses: { 200: { description: 'Legacy project-engine access mirrored into targets', content: { 'application/json': { schema: ProjectEngineTargetSyncLegacyResponseSchema } } } } });
registry.registerPath({ method: 'post', path: '/api/authz/project-engine-targets', ...authzExtension('platform.project-engine-targets.manage', 'POST', '/api/authz/project-engine-targets'), request: { body: { content: { 'application/json': { schema: ProjectEngineTargetCreateSchema } } } }, responses: { 201: { description: 'Project-engine target created', content: { 'application/json': { schema: AuthzCreatedIdResponseSchema } } } } });
registry.registerPath({ method: 'get', path: '/api/authz/project-engine-targets/{id}', ...authzExtension('platform.project-engine-targets.read', 'GET', '/api/authz/project-engine-targets/:id'), request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'Get project-engine target', content: { 'application/json': { schema: ProjectEngineTargetSchema } } } } });
registry.registerPath({ method: 'put', path: '/api/authz/project-engine-targets/{id}', ...authzExtension('platform.project-engine-targets.manage', 'PUT', '/api/authz/project-engine-targets/:id'), request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: ProjectEngineTargetUpdateSchema } } } }, responses: { 200: { description: 'Project-engine target updated', content: { 'application/json': { schema: AuthzMutationSuccessResponseSchema } } } } });
registry.registerPath({ method: 'delete', path: '/api/authz/project-engine-targets/{id}', ...authzExtension('platform.project-engine-targets.manage', 'DELETE', '/api/authz/project-engine-targets/:id'), request: { params: z.object({ id: z.string() }) }, responses: { 204: { description: 'Project-engine target archived' } } });
registry.registerPath({ method: 'get', path: '/starbase-api/projects/{projectId}/deployment-targets', ...authzExtension('project.deployment-targets.read', 'GET', '/starbase-api/projects/{projectId}/deployment-targets'), request: { params: z.object({ projectId: z.string() }), query: z.object({ status: z.enum(['active', 'disabled', 'archived', 'all']).optional(), source: z.enum(['manual', 'legacy', 'ci', 'api', 'import', 'deployment_history', 'external', 'system', 'automation', 'config']).optional() }) }, responses: { 200: { description: 'List deployment targets for one project', content: { 'application/json': { schema: z.array(ProjectEngineTargetSchema) } } } } });
registry.registerPath({ method: 'post', path: '/starbase-api/projects/{projectId}/deployment-targets/sync-legacy', ...authzExtension('project.deployment-targets.manage', 'POST', '/starbase-api/projects/{projectId}/deployment-targets/sync-legacy'), request: { params: z.object({ projectId: z.string() }) }, responses: { 200: { description: 'Legacy project-engine access mirrored into project targets', content: { 'application/json': { schema: ProjectEngineTargetSyncLegacyResponseSchema } } } } });
registry.registerPath({ method: 'post', path: '/starbase-api/projects/{projectId}/deployment-targets', ...authzExtension('project.deployment-targets.manage', 'POST', '/starbase-api/projects/{projectId}/deployment-targets'), request: { params: z.object({ projectId: z.string() }), body: { content: { 'application/json': { schema: ProjectEngineTargetCreateSchema.omit({ projectId: true, source: true, sourceRef: true, externalSystemId: true, externalProjectId: true, externalEngineId: true, externalTargetId: true, approvedById: true, approvalStatus: true, approvedAt: true, policyTags: true, diagnostics: true }).partial({ status: true, allowManualDeploy: true, allowCiDeploy: true, allowApiDeploy: true, allowImport: true }).required({ engineId: true }) } } } }, responses: { 201: { description: 'Project deployment target created', content: { 'application/json': { schema: AuthzCreatedIdResponseSchema } } } } });
registry.registerPath({ method: 'put', path: '/starbase-api/projects/{projectId}/deployment-targets/{targetId}', ...authzExtension('project.deployment-targets.manage', 'PUT', '/starbase-api/projects/{projectId}/deployment-targets/{targetId}'), request: { params: z.object({ projectId: z.string(), targetId: z.string() }), body: { content: { 'application/json': { schema: ProjectEngineTargetUpdateSchema.omit({ source: true, sourceRef: true, externalSystemId: true, externalProjectId: true, externalEngineId: true, externalTargetId: true, approvedById: true, approvalStatus: true, approvedAt: true, policyTags: true, diagnostics: true }) } } } }, responses: { 200: { description: 'Project deployment target updated', content: { 'application/json': { schema: AuthzMutationSuccessResponseSchema } } } } });
registry.registerPath({ method: 'delete', path: '/starbase-api/projects/{projectId}/deployment-targets/{targetId}', ...authzExtension('project.deployment-targets.manage', 'DELETE', '/starbase-api/projects/{projectId}/deployment-targets/{targetId}'), request: { params: z.object({ projectId: z.string(), targetId: z.string() }) }, responses: { 204: { description: 'Project deployment target archived' } } });
registry.registerPath({ method: 'get', path: '/api/authz/policies', ...authzExtension('platform.authz.policies.read', 'GET', '/api/authz/policies'), responses: { 200: { description: 'List policies', content: { 'application/json': { schema: z.array(AuthzPolicyResponseSchema) } } } } });
registry.registerPath({ method: 'post', path: '/api/authz/policies', ...authzExtension('platform.authz.policies.manage', 'POST', '/api/authz/policies'), request: { body: { content: { 'application/json': { schema: AuthzPolicyCreateSchema } } } }, responses: { 201: { description: 'Policy created', content: { 'application/json': { schema: AuthzCreatedIdResponseSchema } } } } });
registry.registerPath({ method: 'put', path: '/api/authz/policies/{id}', ...authzExtension('platform.authz.policies.manage', 'PUT', '/api/authz/policies/{id}'), request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: AuthzPolicyUpdateSchema } } } }, responses: { 200: { description: 'Policy updated', content: { 'application/json': { schema: AuthzMutationSuccessResponseSchema } } } } });
registry.registerPath({ method: 'delete', path: '/api/authz/policies/{id}', ...authzExtension('platform.authz.policies.manage', 'DELETE', '/api/authz/policies/{id}'), request: { params: z.object({ id: z.string() }) }, responses: { 204: { description: 'Policy deleted' } } });

// Authz audit
registry.registerPath({ method: 'get', path: '/api/authz/audit', ...authzExtension('platform.audit.read', 'GET', '/api/authz/audit'), request: { query: AuthzAuditQuerySchema }, responses: { 200: { description: 'Authorization audit log', content: { 'application/json': { schema: z.array(AuthzAuditLogResponseSchema) } } } } });

registry.registerPath({ method: 'post', path: '/api/mission-control/bridge/starbase-edit/evaluate', ...authzExtension('mission-control.bridge.starbase-edit.evaluate', 'POST', '/api/mission-control/bridge/starbase-edit/evaluate'), request: { body: { content: { 'application/json': { schema: BridgeDecisionRequestSchema } } } }, responses: { 200: { description: 'Evaluate Mission Control to Starbase edit bridge access', content: { 'application/json': { schema: BridgeDecisionResponseSchema } } } } });
registry.registerPath({ method: 'post', path: '/api/starbase/bridge/mission-control/evaluate', ...authzExtension('starbase.bridge.mission-control.evaluate', 'POST', '/api/starbase/bridge/mission-control/evaluate'), request: { body: { content: { 'application/json': { schema: BridgeDecisionRequestSchema } } } }, responses: { 200: { description: 'Evaluate Starbase to Mission Control runtime bridge access', content: { 'application/json': { schema: BridgeDecisionResponseSchema } } } } });
registry.registerPath({ method: 'get', path: '/api/authz/sso-sync-runs', ...authzExtension('platform.sso.engine-assignments.read', 'GET', '/api/authz/sso-sync-runs'), request: { query: SsoSyncRunsQuerySchema }, responses: { 200: { description: 'List SSO authorization sync runs', content: { 'application/json': { schema: z.array(SsoSyncRunSchema) } } } } });
registry.registerPath({ method: 'post', path: '/api/authz/sso-sync-runs/reconcile', ...authzExtension('platform.sso.engine-assignments.manage', 'POST', '/api/authz/sso-sync-runs/reconcile'), request: { body: { content: { 'application/json': { schema: SsoSyncDiagnosticsRunRequestSchema } } } }, responses: { 200: { description: 'Run SSO authorization reconciliation diagnostics and optional provider/snapshot/cleanup passes', content: { 'application/json': { schema: SsoSyncDiagnosticsScanResultSchema } } } } });
registry.registerPath({ method: 'get', path: '/api/authz/sso-sync-runs/{id}/events', ...authzExtension('platform.sso.engine-assignments.read', 'GET', '/api/authz/sso-sync-runs/:id/events'), request: { params: z.object({ id: z.string() }), query: SsoSyncEventsQuerySchema }, responses: { 200: { description: 'List SSO authorization sync run events', content: { 'application/json': { schema: z.array(SsoSyncEventSchema) } } } } });

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
registry.register('DashboardContext', DashboardContextSchema);
registry.register('DashboardStats', DashboardStatsSchema);
registry.registerPath({ method: 'get', path: '/api/dashboard/context', ...authzExtension('platform.dashboard.read', 'GET', '/api/dashboard/context'), responses: { 200: { description: 'Dashboard context data', content: { 'application/json': { schema: DashboardContextSchema } } } } });
registry.registerPath({ method: 'get', path: '/api/dashboard/stats', ...authzExtension('platform.dashboard.read', 'GET', '/api/dashboard/stats'), responses: { 200: { description: 'Dashboard statistics', content: { 'application/json': { schema: DashboardStatsSchema } } } } });

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
registry.registerPath({ method: 'get', path: '/api/users', ...authzExtension('platform.users.read', 'GET', '/api/users'), responses: { 200: { description: 'List users', content: { 'application/json': { schema: z.array(PlatformUserResponseSchema) } } } } });
registry.registerPath({ method: 'post', path: '/api/users', ...authzExtension('platform.users.create', 'POST', '/api/users'), request: { body: { content: { 'application/json': { schema: PlatformUserCreateRequestSchema } } } }, responses: { 201: { description: 'User created', content: { 'application/json': { schema: PlatformUserCreateResponseSchema } } } } });
const UserDirectoryParamsSchema = z.object({ id: z.string().min(1).max(255) });
registry.registerPath({ method: 'get', path: '/api/users/directory', summary: 'List users with authentication and provisioning lineage', ...authzExtension('platform.users.read', 'GET', '/api/users/directory'), request: { query: UserDirectoryQuerySchema }, responses: { 200: { description: 'Bounded source-aware user directory page', content: { 'application/json': { schema: UserDirectoryListResponseSchema } } } } });
registry.registerPath({ method: 'get', path: '/api/users/{id}/identity-context', ...authzExtension('platform.users.read', 'GET', '/api/users/{id}/identity-context'), request: { params: UserDirectoryParamsSchema }, responses: { 200: { description: 'Linked identities and field ownership', content: { 'application/json': { schema: UserIdentityContextSchema } } }, 404: { description: 'User not found' } } });
registry.registerPath({ method: 'get', path: '/api/users/{id}/effective-access', ...authzExtension('platform.users.read', 'GET', '/api/users/{id}/effective-access'), request: { params: UserDirectoryParamsSchema }, responses: { 200: { description: 'Effective access with source lineage', content: { 'application/json': { schema: UserEffectiveAccessResponseSchema } } }, 404: { description: 'User not found' } } });
registry.registerPath({ method: 'get', path: '/api/users/{id}/sessions', ...authzExtension('platform.users.read', 'GET', '/api/users/{id}/sessions'), request: { params: UserDirectoryParamsSchema }, responses: { 200: { description: 'Redacted user refresh-session inventory', content: { 'application/json': { schema: UserSessionsResponseSchema } } }, 404: { description: 'User not found' } } });
registry.registerPath({ method: 'get', path: '/api/users/{id}/audit', ...authzExtension('platform.users.read', 'GET', '/api/users/{id}/audit'), request: { params: UserDirectoryParamsSchema, query: UserAuditQuerySchema }, responses: { 200: { description: 'Bounded user audit summary', content: { 'application/json': { schema: UserAuditResponseSchema } } }, 404: { description: 'User not found' } } });
registry.registerPath({ method: 'post', path: '/api/users/{id}/deactivate', ...authzExtension('platform.users.deactivate', 'POST', '/api/users/{id}/deactivate'), request: { params: UserDirectoryParamsSchema, body: { content: { 'application/json': { schema: UserDeactivateRequestSchema } } } }, responses: { 200: { description: 'User deactivated and sessions invalidated', content: { 'application/json': { schema: UserLifecycleMutationResponseSchema } } }, 409: { description: 'Recovery continuity conflict' } } });
registry.registerPath({ method: 'post', path: '/api/users/{id}/reactivate', ...authzExtension('platform.users.update', 'POST', '/api/users/{id}/reactivate'), request: { params: UserDirectoryParamsSchema, body: { content: { 'application/json': { schema: UserReactivateRequestSchema } } } }, responses: { 200: { description: 'Locally managed user reactivated', content: { 'application/json': { schema: UserLifecycleMutationResponseSchema } } }, 409: { description: 'Directory-managed users must be reactivated in their source directory' } } });
registry.registerPath({ method: 'post', path: '/api/users/{id}/revoke-sessions', ...authzExtension('platform.users.update', 'POST', '/api/users/{id}/revoke-sessions'), request: { params: UserDirectoryParamsSchema, body: { content: { 'application/json': { schema: UserRevokeSessionsRequestSchema } } } }, responses: { 200: { description: 'Every current session revoked and access-session version advanced', content: { 'application/json': { schema: UserLifecycleMutationResponseSchema } } } } });
registry.registerPath({ method: 'get', path: '/api/users/{id}', ...authzExtension('platform.users.read', 'GET', '/api/users/{id}'), request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'User details', content: { 'application/json': { schema: PlatformUserResponseSchema } } }, 404: { description: 'Not found' } } });
registry.registerPath({ method: 'put', path: '/api/users/{id}', ...authzExtension('platform.users.update', 'PUT', '/api/users/{id}'), request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: PlatformUserUpdateRequestSchema } } } }, responses: { 200: { description: 'User updated', content: { 'application/json': { schema: PlatformUserResponseSchema } } } } });
registry.registerPath({ method: 'delete', path: '/api/users/{id}', ...authzExtension('platform.users.deactivate', 'DELETE', '/api/users/{id}'), request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'User deactivated', content: { 'application/json': { schema: UserOperationMessageSchema } } } } });
registry.registerPath({ method: 'delete', path: '/api/users/{id}/permanent', ...authzExtension('platform.users.permanent-delete', 'DELETE', '/api/users/{id}/permanent'), request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'User permanently deleted', content: { 'application/json': { schema: UserOperationMessageSchema } } } } });
registry.registerPath({ method: 'post', path: '/api/users/{id}/unlock', ...authzExtension('platform.users.unlock', 'POST', '/api/users/{id}/unlock'), request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'User unlocked', content: { 'application/json': { schema: UserOperationMessageSchema } } } } });

// -----------------------------
// Git API - Extended
// -----------------------------

// Admin providers
registry.registerPath({ method: 'get', path: '/git-api/admin/providers', ...authzExtension('platform.git.providers.manage', 'GET', '/git-api/admin/providers'), responses: { 200: { description: 'List admin git providers', content: { 'application/json': { schema: z.array(GitProviderAdminSummarySchema) } } } } });
registry.registerPath({ method: 'put', path: '/git-api/admin/providers/{id}', ...authzExtension('platform.git.providers.manage', 'PUT', '/git-api/admin/providers/:id'), request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: UpdateGitProviderRequestSchema } } } }, responses: { 200: { description: 'Provider updated without OAuth client settings', content: { 'application/json': { schema: GitProviderAdminUpdateResponseSchema } } } } });

// Providers
registry.registerPath({ method: 'get', path: '/git-api/providers', ...authzExemption('GET', '/git-api/providers'), responses: { 200: { description: 'List safe git provider metadata', content: { 'application/json': { schema: z.array(GitProviderSummarySchema) } } } } });
registry.registerPath({ method: 'get', path: '/git-api/providers/{id}', ...authzExemption('GET', '/git-api/providers/:id'), request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'Safe provider details without OAuth client configuration', content: { 'application/json': { schema: GitProviderDetailSchema } } } } });
registry.registerPath({ method: 'get', path: '/git-api/providers/{id}/repos', ...authzExemption('GET', '/git-api/providers/:id/repos'), request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'List sanitized repos for provider', content: { 'application/json': { schema: z.array(GitProviderRepositorySchema) } } } } });

// Credentials
registry.registerPath({ method: 'get', path: '/git-api/credentials', ...authzExemption('GET', '/git-api/credentials'), responses: { 200: { description: 'List redacted git credentials', content: { 'application/json': { schema: z.array(GitCredentialSchema) } } } } });
registry.registerPath({ method: 'get', path: '/git-api/credentials/{providerId}', ...authzExemption('GET', '/git-api/credentials/:providerId'), request: { params: GitProviderIdParamsSchema }, responses: { 200: { description: 'Git credential metadata for provider', content: { 'application/json': { schema: GitCredentialSchema } } }, 404: { description: 'Not found' } } });
registry.registerPath({ method: 'post', path: '/git-api/credentials', ...authzExemption('POST', '/git-api/credentials'), request: { body: { content: { 'application/json': { schema: SaveGitCredentialRequestSchema } } } }, responses: { 201: { description: 'Credential created', content: { 'application/json': { schema: GitCredentialSchema } } } } });
registry.registerPath({ method: 'patch', path: '/git-api/credentials/{credentialId}', ...authzExemption('PATCH', '/git-api/credentials/:credentialId'), request: { params: GitCredentialIdParamsSchema, body: { content: { 'application/json': { schema: RenameGitCredentialRequestSchema } } } }, responses: { 200: { description: 'Credential updated', content: { 'application/json': { schema: GitCredentialOperationReceiptSchema } } } } });
registry.registerPath({ method: 'delete', path: '/git-api/credentials/{providerId}', ...authzExemption('DELETE', '/git-api/credentials/:providerId'), request: { params: GitProviderIdParamsSchema }, responses: { 204: { description: 'Provider credentials deleted' } } });
registry.registerPath({ method: 'get', path: '/git-api/credentials/{providerId}/validate', ...authzExemption('GET', '/git-api/credentials/:providerId/validate'), request: { params: GitProviderIdParamsSchema }, responses: { 200: { description: 'Credential validation result', content: { 'application/json': { schema: GitCredentialValidationResponseSchema } } } } });
registry.registerPath({ method: 'get', path: '/git-api/credentials/{credentialId}/namespaces', ...authzExemption('GET', '/git-api/credentials/:credentialId/namespaces'), request: { params: GitCredentialIdParamsSchema }, responses: { 200: { description: 'Available namespaces', content: { 'application/json': { schema: z.array(GitCredentialNamespaceSchema) } } } } });

// Clone & create
registry.registerPath({ method: 'post', path: '/git-api/clone', ...authzExtension('project.create.git.create', 'POST', '/git-api/clone'), request: { body: { content: { 'application/json': { schema: CloneFromGitRequestSchema } } } }, responses: { 201: { description: 'Repository cloned', content: { 'application/json': { schema: CloneFromGitResponseSchema } } } } });
registry.register('CreateOnlineProjectResponse', CreateOnlineProjectResponseSchema);
registry.registerPath({ method: 'post', path: '/git-api/create-online', ...authzExtension('project.create.git.create', 'POST', '/git-api/create-online'), request: { body: { content: { 'application/json': { schema: CreateOnlineProjectRequestSchema } } } }, responses: { 201: { description: 'Online repo created without submitted credentials', content: { 'application/json': { schema: CreateOnlineProjectResponseSchema } } } } });
registry.registerPath({ method: 'post', path: '/git-api/check-repo-exists', ...authzExtension('project.create.git.inspect', 'POST', '/git-api/check-repo-exists'), request: { body: { content: { 'application/json': { schema: CheckRepositoryExistsRequestSchema } } } }, responses: { 200: { description: 'Check result', content: { 'application/json': { schema: CheckRepositoryExistsResponseSchema } } } } });
registry.registerPath({ method: 'post', path: '/git-api/repo-info', ...authzExtension('project.create.git.inspect', 'POST', '/git-api/repo-info'), request: { body: { content: { 'application/json': { schema: RepositoryInfoRequestSchema } } } }, responses: { 200: { description: 'Repository info', content: { 'application/json': { schema: RepositoryInfoResponseSchema } } } } });

// Git deployments
registry.registerPath({ method: 'get', path: '/git-api/deployments', ...authzExtension('project.deployments.read', 'GET', '/git-api/deployments'), request: { query: z.object({ projectId: z.string().optional() }).passthrough() }, responses: { 200: { description: 'List git deployments', content: { 'application/json': { schema: z.array(DeploymentSelectSchema) } } } } });
registry.registerPath({ method: 'get', path: '/git-api/deployments/{id}', ...authzExtension('project.deployments.read', 'GET', '/git-api/deployments/:id'), request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'Deployment details', content: { 'application/json': { schema: DeploymentSelectSchema } } }, 404: { description: 'Not found' } } });
registry.registerPath({ method: 'get', path: '/git-api/projects/{projectId}/deployments', ...authzExtension('project.deployments.read', 'GET', '/git-api/projects/:projectId/deployments'), request: { params: z.object({ projectId: z.string() }) }, responses: { 200: { description: 'Deployments for project', content: { 'application/json': { schema: z.array(DeploymentSelectSchema) } } } } });

// Git sync
registry.registerPath({ method: 'post', path: '/git-api/sync', ...authzExtension('project.git.sync.run', 'POST', '/git-api/sync'), request: { body: { content: { 'application/json': { schema: GitSyncRequestSchema } } } }, responses: { 200: { description: 'Sync started', content: { 'application/json': { schema: GitSyncResponseSchema } } } } });
registry.registerPath({ method: 'get', path: '/git-api/sync/status', ...authzExtension('project.git.sync.status', 'GET', '/git-api/sync/status'), request: { query: GitSyncStatusQuerySchema }, responses: { 200: { description: 'Sync status', content: { 'application/json': { schema: GitSyncStatusResponseSchema } } } } });

// Git lock heartbeat
registry.registerPath({ method: 'put', path: '/git-api/locks/{lockId}/heartbeat', ...authzExtension('project.git.locks.heartbeat', 'PUT', '/git-api/locks/:lockId/heartbeat'), request: { params: z.object({ lockId: z.string() }) }, responses: { 200: { description: 'Lock heartbeat renewed', content: { 'application/json': { schema: LockHeartbeatResponseSchema } } } } });
registry.registerPath({ method: 'get', path: '/git-api/locks/{fileId}/events', ...authzExtension('project.git.locks.read', 'GET', '/git-api/locks/:fileId/events'), request: { params: z.object({ fileId: z.string().uuid() }) }, responses: { 200: { description: 'SSE stream of lock and file events', content: { 'text/event-stream': { schema: z.string() } } } } });

// Git OAuth
registry.registerPath({ method: 'get', path: '/git-api/oauth/{providerId}/authorize', ...authzExemption('GET', '/git-api/oauth/:providerId/authorize'), request: { params: GitProviderIdParamsSchema }, responses: { 200: { description: 'OAuth authorization URL and opaque state', content: { 'application/json': { schema: GitOAuthAuthorizeResponseSchema } } } } });
registry.registerPath({ method: 'get', path: '/git-api/oauth/{providerId}/authorize/redirect', ...authzExemption('GET', '/git-api/oauth/:providerId/authorize/redirect'), request: { params: GitProviderIdParamsSchema }, responses: { 302: { description: 'OAuth redirect' } } });
registry.registerPath({ method: 'get', path: '/git-api/oauth/{providerId}/config', ...authzExemption('GET', '/git-api/oauth/:providerId/config'), request: { params: GitProviderIdParamsSchema }, responses: { 200: { description: 'OAuth capability metadata without client configuration', content: { 'application/json': { schema: GitOAuthConfigSchema } } } } });
registry.registerPath({ method: 'post', path: '/git-api/oauth/{providerId}/refresh', ...authzExemption('POST', '/git-api/oauth/:providerId/refresh'), request: { params: GitProviderIdParamsSchema }, responses: { 200: { description: 'Token refreshed' } } });
registry.registerPath({ method: 'get', path: '/git-api/oauth/authorize/redirect', ...authzExemption('GET', '/git-api/oauth/authorize/redirect'), responses: { 302: { description: 'Generic OAuth redirect' } } });
registry.registerPath({ method: 'post', path: '/git-api/oauth/callback', ...authzExemption('POST', '/git-api/oauth/callback'), request: { body: { content: { 'application/json': { schema: GitOAuthCallbackRequestSchema } } } }, responses: { 200: { description: 'OAuth credential saved without token material', content: { 'application/json': { schema: GitCredentialSchema } } } } });

// Git project connection
registry.registerPath({ method: 'get', path: '/git-api/project-connection', ...authzExtension('project.git.repositories.read', 'GET', '/git-api/project-connection'), request: { query: ProjectGitConnectionQuerySchema }, responses: { 200: { description: 'Project connection state without a service token', content: { 'application/json': { schema: ProjectGitConnectionSchema } } } } });
registry.registerPath({ method: 'post', path: '/git-api/project-connection', ...authzExtension('project.git.repositories.manage', 'POST', '/git-api/project-connection'), request: { body: { content: { 'application/json': { schema: ProjectGitConnectionRequestSchema } } } }, responses: { 200: { description: 'Project connection established', content: { 'application/json': { schema: ProjectGitConnectionReceiptSchema } } } } });
registry.registerPath({ method: 'put', path: '/git-api/project-connection/token', ...authzExtension('project.git.repositories.manage', 'PUT', '/git-api/project-connection/token'), request: { body: { content: { 'application/json': { schema: UpdateProjectGitConnectionTokenRequestSchema } } } }, responses: { 200: { description: 'Connection token updated', content: { 'application/json': { schema: ProjectGitConnectionOperationReceiptSchema } } } } });
registry.registerPath({ method: 'delete', path: '/git-api/project-connection', ...authzExtension('project.git.repositories.manage', 'DELETE', '/git-api/project-connection'), request: { body: { content: { 'application/json': { schema: DisconnectProjectGitConnectionRequestSchema } } } }, responses: { 200: { description: 'Project connection disconnected', content: { 'application/json': { schema: ProjectGitConnectionOperationReceiptSchema } } } } });

export function generateOpenApi(): any {
  const generator = new OpenApiGeneratorV3(registry.definitions);
  return generator.generateDocument({
    openapi: '3.0.3',
    info: { title: 'Voyager API', version: '0.1.0' },
  });
}
