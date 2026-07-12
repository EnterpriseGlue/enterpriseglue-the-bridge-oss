import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { File } from '@enterpriseglue/shared/infrastructure/persistence/entities/File.js';
import { Project } from '@enterpriseglue/shared/infrastructure/persistence/entities/Project.js';
import { ProjectEngineTarget } from '@enterpriseglue/shared/infrastructure/persistence/entities/ProjectEngineTarget.js';
import {
  EnginePermissions,
  ProjectPermissions,
  permissionService,
} from '@enterpriseglue/shared/services/platform-admin/index.js';

export interface BridgeDecisionInput {
  engineId?: string;
  projectId?: string;
  fileId?: string;
  targetId?: string;
  definitionId?: string;
  definitionKey?: string;
  decisionDefinitionId?: string;
  decisionDefinitionKey?: string;
  kind?: 'process' | 'decision' | 'bpmn' | 'dmn';
}

export interface BridgeDecisionResponse {
  allowed: boolean;
  reasonCode: string;
  reason: string;
  missingActions: string[];
  projectId: string | null;
  fileId: string | null;
  engineId: string | null;
  targetId: string | null;
  lineage: Record<string, unknown>;
  diagnostics?: {
    effectiveAccessUrl: string;
    label: 'Effective Access';
  };
}

function tenantVisible(rowTenantId: string | null | undefined, tenantId?: string | null): boolean {
  const normalizedTenantId = tenantId?.trim() || null;
  return !normalizedTenantId || !rowTenantId || rowTenantId === normalizedTenantId;
}

function bridgeDiagnosticUrl(resourceType: 'project' | 'engine', resourceId: string | null, permission: string): string | undefined {
  if (!resourceId) return undefined;
  const params = new URLSearchParams({
    resourceType,
    resourceId,
    permission,
  });
  return `/admin/access-control?tab=effective-access&${params.toString()}`;
}

function bridgeResponse(input: {
  allowed: boolean;
  reasonCode: string;
  reason: string;
  missingActions?: string[];
  projectId?: string | null;
  fileId?: string | null;
  engineId?: string | null;
  targetId?: string | null;
  lineage?: Record<string, unknown>;
  diagnosticsPermission?: string;
  diagnosticsResourceType?: 'project' | 'engine';
  diagnosticsResourceId?: string | null;
}): BridgeDecisionResponse {
  const diagnosticsUrl = input.diagnosticsPermission && input.diagnosticsResourceType
    ? bridgeDiagnosticUrl(input.diagnosticsResourceType, input.diagnosticsResourceId ?? null, input.diagnosticsPermission)
    : undefined;
  return {
    allowed: input.allowed,
    reasonCode: input.reasonCode,
    reason: input.reason,
    missingActions: input.missingActions ?? [],
    projectId: input.projectId ?? null,
    fileId: input.fileId ?? null,
    engineId: input.engineId ?? null,
    targetId: input.targetId ?? null,
    lineage: input.lineage ?? {},
    diagnostics: diagnosticsUrl ? { effectiveAccessUrl: diagnosticsUrl, label: 'Effective Access' } : undefined,
  };
}

async function resolveBridgeFileProject(
  dataSource: Awaited<ReturnType<typeof getDataSource>>,
  input: { projectId?: string; fileId?: string },
  tenantId?: string | null
): Promise<{ projectId: string | null; fileId: string | null; fileType: string | null; error?: BridgeDecisionResponse }> {
  if (!input.fileId) {
    return { projectId: input.projectId ?? null, fileId: null, fileType: null };
  }
  const file = await dataSource.getRepository(File).findOne({
    where: { id: input.fileId },
    select: ['id', 'projectId', 'type'],
  });
  if (!file) {
    return {
      projectId: input.projectId ?? null,
      fileId: input.fileId,
      fileType: null,
      error: bridgeResponse({
        allowed: false,
        reasonCode: 'file_not_found',
        reason: 'The Starbase file could not be found.',
        missingActions: ['project.files.read'],
        projectId: input.projectId ?? null,
        fileId: input.fileId,
      }),
    };
  }
  if (input.projectId && input.projectId !== file.projectId) {
    return {
      projectId: input.projectId,
      fileId: input.fileId,
      fileType: file.type,
      error: bridgeResponse({
        allowed: false,
        reasonCode: 'lineage_mismatch',
        reason: 'The requested file does not belong to the requested project.',
        projectId: input.projectId,
        fileId: input.fileId,
      }),
    };
  }
  const targetProjectId = file.projectId;
  const project = await dataSource.getRepository(Project).findOne({ where: { id: targetProjectId }, select: ['id', 'tenantId'] });
  if (!project || !tenantVisible(project.tenantId, tenantId)) {
    return {
      projectId: targetProjectId,
      fileId: input.fileId,
      fileType: file.type,
      error: bridgeResponse({
        allowed: false,
        reasonCode: 'project_not_visible',
        reason: 'The file project is outside the current tenant scope.',
        missingActions: ['project.files.read'],
        projectId: targetProjectId,
        fileId: input.fileId,
      }),
    };
  }
  return { projectId: targetProjectId, fileId: input.fileId, fileType: file.type };
}

async function findActiveBridgeTarget(
  dataSource: Awaited<ReturnType<typeof getDataSource>>,
  projectId: string,
  engineId: string,
  tenantId?: string | null
): Promise<ProjectEngineTarget | null> {
  const target = await dataSource.getRepository(ProjectEngineTarget).findOne({ where: { projectId, engineId } });
  if (!target || !tenantVisible(target.tenantId, tenantId) || target.status !== 'active') return null;
  return target;
}

function bridgeKind(input: BridgeDecisionInput, fileType?: string | null): 'process' | 'decision' {
  if (input.kind === 'decision' || input.kind === 'dmn') return 'decision';
  if (input.kind === 'process' || input.kind === 'bpmn') return 'process';
  if (fileType === 'dmn') return 'decision';
  return 'process';
}

export async function evaluateMissionControlStarbaseBridge(
  input: BridgeDecisionInput,
  userId: string,
  tenantId?: string | null
): Promise<BridgeDecisionResponse> {
  const engineId = input.engineId || null;
  if (!engineId) {
    return bridgeResponse({
      allowed: false,
      reasonCode: 'missing_engine',
      reason: 'Mission Control to Starbase bridge evaluation requires an engine id.',
      missingActions: ['engine.runtime.process-definitions.edit-target.read'],
      projectId: input.projectId ?? null,
      fileId: input.fileId ?? null,
      engineId,
    });
  }
  const dataSource = await getDataSource();
  const fileResolution = await resolveBridgeFileProject(dataSource, input, tenantId);
  if (fileResolution.error) return fileResolution.error;
  const projectId = fileResolution.projectId;
  if (!projectId || !fileResolution.fileId) {
    return bridgeResponse({
      allowed: false,
      reasonCode: 'missing_edit_target_lineage',
      reason: 'The bridge could not resolve a Starbase project and file for this runtime artifact.',
      missingActions: ['project.files.read'],
      projectId,
      fileId: fileResolution.fileId,
      engineId,
      lineage: {
        definitionId: input.definitionId ?? null,
        definitionKey: input.definitionKey ?? null,
        decisionDefinitionId: input.decisionDefinitionId ?? null,
        decisionDefinitionKey: input.decisionDefinitionKey ?? null,
      },
    });
  }

  const kind = bridgeKind(input, fileResolution.fileType);
  const engineAction = kind === 'decision'
    ? 'engine.runtime.decisions.edit-target.read'
    : 'engine.runtime.process-definitions.edit-target.read';
  const enginePermission = await permissionService.hasPermission(EnginePermissions.INSTANCE_VIEW, {
    userId,
    tenantId,
    resourceType: 'engine',
    resourceId: engineId,
  });
  const projectFileRead = await permissionService.hasPermission(ProjectPermissions.FILES_VIEW, {
    userId,
    tenantId,
    resourceType: 'project',
    resourceId: projectId,
  });
  const projectFileEdit = await permissionService.hasPermission(ProjectPermissions.FILES_EDIT, {
    userId,
    tenantId,
    resourceType: 'project',
    resourceId: projectId,
  });
  const target = await findActiveBridgeTarget(dataSource, projectId, engineId, tenantId);

  const missingActions = [
    enginePermission ? null : engineAction,
    projectFileRead ? null : 'project.files.read',
    projectFileEdit ? null : 'project.files.update',
    target ? null : 'project.deployment-targets.read',
  ].filter((value): value is string => Boolean(value));

  return bridgeResponse({
    allowed: missingActions.length === 0,
    reasonCode: missingActions.length === 0
      ? 'allowed'
      : !enginePermission
        ? 'missing_engine_edit_target_permission'
        : !projectFileRead
          ? 'missing_project_file_read_permission'
          : !projectFileEdit
            ? 'missing_project_file_edit_permission'
            : 'missing_active_project_engine_target',
    reason: missingActions.length === 0
      ? 'The runtime artifact can be opened for editing in Starbase.'
      : 'The runtime artifact cannot be opened in Starbase because one or more bridge requirements are missing.',
    missingActions,
    projectId,
    fileId: fileResolution.fileId,
    engineId,
    targetId: target?.id ?? input.targetId ?? null,
    lineage: {
      kind,
      definitionId: input.definitionId ?? null,
      definitionKey: input.definitionKey ?? null,
      decisionDefinitionId: input.decisionDefinitionId ?? null,
      decisionDefinitionKey: input.decisionDefinitionKey ?? null,
      fileType: fileResolution.fileType,
    },
    diagnosticsPermission: !projectFileRead || !projectFileEdit ? ProjectPermissions.FILES_VIEW : EnginePermissions.INSTANCE_VIEW,
    diagnosticsResourceType: !projectFileRead || !projectFileEdit ? 'project' : 'engine',
    diagnosticsResourceId: !projectFileRead || !projectFileEdit ? projectId : engineId,
  });
}

export async function evaluateStarbaseMissionControlBridge(
  input: BridgeDecisionInput,
  userId: string,
  tenantId?: string | null
): Promise<BridgeDecisionResponse> {
  const dataSource = await getDataSource();
  let engineId = input.engineId || null;
  let targetId = input.targetId || null;
  const fileResolution = await resolveBridgeFileProject(dataSource, input, tenantId);
  if (fileResolution.error) return fileResolution.error;
  const projectId = fileResolution.projectId;
  if (!projectId || !fileResolution.fileId) {
    return bridgeResponse({
      allowed: false,
      reasonCode: 'missing_file_lineage',
      reason: 'Starbase to Mission Control bridge evaluation requires a project file lineage.',
      missingActions: ['project.files.read'],
      projectId,
      fileId: fileResolution.fileId,
      engineId,
      targetId,
    });
  }

  if (!engineId && targetId) {
    const target = await dataSource.getRepository(ProjectEngineTarget).findOne({ where: { id: targetId } });
    if (target && tenantVisible(target.tenantId, tenantId) && target.projectId === projectId) {
      engineId = target.engineId;
    }
  }
  if (!engineId) {
    return bridgeResponse({
      allowed: false,
      reasonCode: 'missing_engine_lineage',
      reason: 'The bridge could not resolve which engine runtime should be opened.',
      missingActions: ['engine.runtime.process-definitions.read'],
      projectId,
      fileId: fileResolution.fileId,
      engineId,
      targetId,
    });
  }

  const target = await findActiveBridgeTarget(dataSource, projectId, engineId, tenantId);
  targetId = target?.id ?? targetId;
  const kind = bridgeKind(input, fileResolution.fileType);
  const engineAction = kind === 'decision'
    ? 'engine.runtime.decisions.read'
    : 'engine.runtime.process-definitions.read';
  const projectFileRead = await permissionService.hasPermission(ProjectPermissions.FILES_VIEW, {
    userId,
    tenantId,
    resourceType: 'project',
    resourceId: projectId,
  });
  const engineRuntimeRead = await permissionService.hasPermission(EnginePermissions.INSTANCE_VIEW, {
    userId,
    tenantId,
    resourceType: 'engine',
    resourceId: engineId,
  });

  const missingActions = [
    projectFileRead ? null : 'project.files.read',
    engineRuntimeRead ? null : engineAction,
    target ? null : 'project.deployment-targets.read',
  ].filter((value): value is string => Boolean(value));

  return bridgeResponse({
    allowed: missingActions.length === 0,
    reasonCode: missingActions.length === 0
      ? 'allowed'
      : !projectFileRead
        ? 'missing_project_file_read_permission'
        : !engineRuntimeRead
          ? 'missing_engine_runtime_read_permission'
          : 'missing_active_project_engine_target',
    reason: missingActions.length === 0
      ? 'The Starbase file can be opened in Mission Control.'
      : 'The Starbase file cannot be opened in Mission Control because one or more bridge requirements are missing.',
    missingActions,
    projectId,
    fileId: fileResolution.fileId,
    engineId,
    targetId,
    lineage: {
      kind,
      fileType: fileResolution.fileType,
      definitionId: input.definitionId ?? null,
      definitionKey: input.definitionKey ?? null,
      decisionDefinitionId: input.decisionDefinitionId ?? null,
      decisionDefinitionKey: input.decisionDefinitionKey ?? null,
    },
    diagnosticsPermission: !projectFileRead ? ProjectPermissions.FILES_VIEW : EnginePermissions.INSTANCE_VIEW,
    diagnosticsResourceType: !projectFileRead ? 'project' : 'engine',
    diagnosticsResourceId: !projectFileRead ? projectId : engineId,
  });
}
