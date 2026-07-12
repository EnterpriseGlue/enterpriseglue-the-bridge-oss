import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { EngineProjectAccess } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineProjectAccess.js';
import { EnvironmentTag } from '@enterpriseglue/shared/infrastructure/persistence/entities/EnvironmentTag.js';
import { Project } from '@enterpriseglue/shared/infrastructure/persistence/entities/Project.js';
import { ProjectEngineTarget } from '@enterpriseglue/shared/infrastructure/persistence/entities/ProjectEngineTarget.js';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import type { ProjectEngineTargetPolicyMode } from '@enterpriseglue/shared/schemas/platform-admin/platform-settings.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { In, type DataSource } from 'typeorm';
import {
  DEFAULT_PROJECT_ENGINE_TARGET_MODE,
  platformSettingsService,
} from './PlatformSettingsService.js';

export type ProjectEngineTargetMode = 'manual' | 'ci' | 'api' | 'import';
export type ProjectEngineTargetSource = 'manual' | 'legacy' | 'ci' | 'api' | 'import' | 'deployment_history' | 'external' | 'system' | 'automation' | 'config';
export type ProjectEngineTargetStatus = 'active' | 'disabled' | 'archived';
export type ProjectEngineTargetApprovalStatus = 'not_required' | 'pending' | 'approved' | 'rejected';

const SOURCE_OWNED_TARGET_SOURCES = new Set<ProjectEngineTargetSource>([
  'ci',
  'api',
  'external',
  'system',
  'automation',
  'config',
]);

export function isSourceOwnedProjectEngineTarget(source: string | null | undefined): boolean {
  return SOURCE_OWNED_TARGET_SOURCES.has(source as ProjectEngineTargetSource);
}

export function projectEngineTargetOwnershipReason(source: string | null | undefined, sourceRef?: string | null): string {
  const owner = source ? source.replace(/_/g, ' ') : 'source';
  const suffix = sourceRef ? ` (${sourceRef})` : '';
  return `Project-engine target is managed by ${owner}${suffix} and cannot be changed through manual target management`;
}

export interface ProjectEngineTargetInput {
  tenantId?: string | null;
  projectId: string;
  engineId: string;
  status?: ProjectEngineTargetStatus;
  source?: ProjectEngineTargetSource;
  sourceRef?: string | null;
  externalSystemId?: string | null;
  externalProjectId?: string | null;
  externalEngineId?: string | null;
  externalTargetId?: string | null;
  allowManualDeploy?: boolean;
  allowCiDeploy?: boolean;
  allowApiDeploy?: boolean;
  allowImport?: boolean;
  createdById?: string | null;
  approvedById?: string | null;
  approvalStatus?: ProjectEngineTargetApprovalStatus;
  approvedAt?: number | null;
  policyTags?: string[];
  diagnostics?: Record<string, unknown> | null;
  allowSourceOwnedMutation?: boolean;
}

export interface ProjectEngineTargetUpdateInput {
  tenantId?: string | null;
  status?: ProjectEngineTargetStatus;
  source?: ProjectEngineTargetSource;
  sourceRef?: string | null;
  externalSystemId?: string | null;
  externalProjectId?: string | null;
  externalEngineId?: string | null;
  externalTargetId?: string | null;
  allowManualDeploy?: boolean;
  allowCiDeploy?: boolean;
  allowApiDeploy?: boolean;
  allowImport?: boolean;
  approvedById?: string | null;
  approvalStatus?: ProjectEngineTargetApprovalStatus;
  approvedAt?: number | null;
  policyTags?: string[];
  diagnostics?: Record<string, unknown> | null;
  allowSourceOwnedMutation?: boolean;
}

export interface ProjectEngineTargetView {
  id: string;
  tenantId: string | null;
  projectId: string;
  projectName: string | null;
  engineId: string;
  engineName: string | null;
  engineBaseUrl: string | null;
  environment: { id: string; name: string; color: string; manualDeployAllowed: boolean } | null;
  status: ProjectEngineTargetStatus;
  source: ProjectEngineTargetSource;
  sourceRef: string | null;
  externalSystemId: string | null;
  externalProjectId: string | null;
  externalEngineId: string | null;
  externalTargetId: string | null;
  allowManualDeploy: boolean;
  allowCiDeploy: boolean;
  allowApiDeploy: boolean;
  allowImport: boolean;
  createdById: string | null;
  approvedById: string | null;
  approvalStatus: ProjectEngineTargetApprovalStatus;
  approvedAt: number | null;
  policyTags: string[];
  diagnostics: Record<string, unknown> | null;
  lastSeenAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectEngineTargetFilters {
  tenantId?: string | null;
  projectId?: string;
  engineId?: string;
  status?: ProjectEngineTargetStatus | 'all';
  source?: ProjectEngineTargetSource;
}

function normalizeTenantId(tenantId?: string | null): string | null {
  const normalized = tenantId?.trim();
  return normalized || null;
}

function isTenantVisible(rowTenantId: string | null | undefined, tenantId?: string | null): boolean {
  const normalizedTenantId = normalizeTenantId(tenantId);
  return !normalizedTenantId || !rowTenantId || rowTenantId === normalizedTenantId;
}

function modeAllowed(target: ProjectEngineTarget, mode: ProjectEngineTargetMode): boolean {
  if (target.status !== 'active') return false;
  if (mode === 'manual') return Boolean(target.allowManualDeploy);
  if (mode === 'ci') return Boolean(target.allowCiDeploy);
  if (mode === 'api') return Boolean(target.allowApiDeploy);
  return Boolean(target.allowImport);
}

function normalizeString(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized || null;
}

function normalizePolicyTags(tags: string[] | undefined): string[] | undefined {
  if (!tags) return undefined;
  return Array.from(new Set(
    tags
      .map((tag) => tag.trim())
      .filter(Boolean)
  )).sort((left, right) => left.localeCompare(right));
}

function stringifyPolicyTags(tags: string[] | undefined): string | null | undefined {
  const normalized = normalizePolicyTags(tags);
  if (!normalized) return undefined;
  return normalized.length > 0 ? JSON.stringify(normalized) : null;
}

function parsePolicyTags(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

function stringifyDiagnostics(value: Record<string, unknown> | null | undefined): string | null | undefined {
  if (typeof value === 'undefined') return undefined;
  return value ? JSON.stringify(value) : null;
}

function parseDiagnostics(value: string | null | undefined): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function defaultApprovalStatus(source: ProjectEngineTargetSource | string | undefined): ProjectEngineTargetApprovalStatus {
  return isSourceOwnedProjectEngineTarget(source) ? 'approved' : 'not_required';
}

function normalizeApprovalStatus(value: string | null | undefined, source?: ProjectEngineTargetSource | string): ProjectEngineTargetApprovalStatus {
  if (value === 'pending' || value === 'approved' || value === 'rejected' || value === 'not_required') {
    return value;
  }
  return defaultApprovalStatus(source);
}

function resolveApprovedAt(
  status: ProjectEngineTargetApprovalStatus,
  inputApprovedAt: number | null | undefined,
  existingApprovedAt: number | null | undefined,
  now: number,
): number | null {
  if (typeof inputApprovedAt !== 'undefined') return inputApprovedAt;
  if (status === 'approved') return existingApprovedAt ?? now;
  return null;
}

function toTargetView(
  target: ProjectEngineTarget,
  projectById: Map<string, Project>,
  engineById: Map<string, Engine>,
  environmentById: Map<string, EnvironmentTag>
): ProjectEngineTargetView {
  const project = projectById.get(target.projectId) || null;
  const engine = engineById.get(target.engineId) || null;
  const environment = engine?.environmentTagId ? environmentById.get(engine.environmentTagId) || null : null;
  return {
    id: target.id,
    tenantId: target.tenantId,
    projectId: target.projectId,
    projectName: project?.name || null,
    engineId: target.engineId,
    engineName: engine?.name || null,
    engineBaseUrl: engine?.baseUrl || null,
    environment: environment ? {
      id: environment.id,
      name: environment.name,
      color: environment.color,
      manualDeployAllowed: environment.manualDeployAllowed,
    } : null,
    status: target.status as ProjectEngineTargetStatus,
    source: target.source as ProjectEngineTargetSource,
    sourceRef: target.sourceRef,
    externalSystemId: target.externalSystemId,
    externalProjectId: target.externalProjectId,
    externalEngineId: target.externalEngineId,
    externalTargetId: target.externalTargetId,
    allowManualDeploy: Boolean(target.allowManualDeploy),
    allowCiDeploy: Boolean(target.allowCiDeploy),
    allowApiDeploy: Boolean(target.allowApiDeploy),
    allowImport: Boolean(target.allowImport),
    createdById: target.createdById,
    approvedById: target.approvedById,
    approvalStatus: normalizeApprovalStatus(target.approvalStatus, target.source),
    approvedAt: target.approvedAt === null ? null : Number(target.approvedAt),
    policyTags: parsePolicyTags(target.policyTagsJson),
    diagnostics: parseDiagnostics(target.diagnosticsJson),
    lastSeenAt: target.lastSeenAt === null ? null : Number(target.lastSeenAt),
    createdAt: Number(target.createdAt),
    updatedAt: Number(target.updatedAt),
  };
}

export class ProjectEngineTargetService {
  async listTargets(filters: ProjectEngineTargetFilters = {}): Promise<ProjectEngineTargetView[]> {
    const dataSource = await getDataSource();
    const targetRepo = dataSource.getRepository(ProjectEngineTarget);
    const where: Record<string, unknown> = {};
    if (filters.projectId) where.projectId = filters.projectId;
    if (filters.engineId) where.engineId = filters.engineId;
    if (filters.status && filters.status !== 'all') where.status = filters.status;
    if (filters.source) where.source = filters.source;
    const rows = (await targetRepo.find({ where, order: { projectId: 'ASC', engineId: 'ASC' } }))
      .filter((target) => isTenantVisible(target.tenantId, filters.tenantId));
    return this.decorateTargets(dataSource, rows);
  }

  async getTarget(id: string, tenantId?: string | null): Promise<ProjectEngineTargetView | null> {
    const dataSource = await getDataSource();
    const target = await dataSource.getRepository(ProjectEngineTarget).findOneBy({ id });
    if (!target || !isTenantVisible(target.tenantId, tenantId)) return null;
    const [view] = await this.decorateTargets(dataSource, [target]);
    return view || null;
  }

  async createTarget(input: ProjectEngineTargetInput): Promise<{ id: string }> {
    if (input.engineId === '__env__') {
      throw Errors.validation('Project engine targets require a concrete engine id');
    }
    this.assertCanSetTargetSource(input.source, input.allowSourceOwnedMutation);
    await this.assertManualTargetManagementAllowed(input.allowSourceOwnedMutation);
    const dataSource = await getDataSource();
    await this.assertProjectAndEngineVisible(dataSource, input.projectId, input.engineId, input.tenantId);
    const targetRepo = dataSource.getRepository(ProjectEngineTarget);
    const existing = await targetRepo.findOne({ where: { projectId: input.projectId, engineId: input.engineId } });
    const now = Date.now();

    if (existing) {
      if (!isTenantVisible(existing.tenantId, input.tenantId)) {
        throw Errors.conflict('Project-engine target already exists in another tenant scope');
      }
      this.assertCanChangeTarget(existing, input.allowSourceOwnedMutation);
      const source = input.source || existing.source || 'manual';
      const approvalStatus = normalizeApprovalStatus(input.approvalStatus, source);
      const policyTagsJson = stringifyPolicyTags(input.policyTags);
      const diagnosticsJson = stringifyDiagnostics(input.diagnostics);
      await targetRepo.update({ id: existing.id }, {
        tenantId: normalizeTenantId(input.tenantId) ?? existing.tenantId,
        status: input.status || 'active',
        source,
        sourceRef: input.sourceRef ?? existing.sourceRef,
        externalSystemId: input.externalSystemId !== undefined ? normalizeString(input.externalSystemId) : existing.externalSystemId,
        externalProjectId: input.externalProjectId !== undefined ? normalizeString(input.externalProjectId) : existing.externalProjectId,
        externalEngineId: input.externalEngineId !== undefined ? normalizeString(input.externalEngineId) : existing.externalEngineId,
        externalTargetId: input.externalTargetId !== undefined ? normalizeString(input.externalTargetId) : existing.externalTargetId,
        allowManualDeploy: input.allowManualDeploy ?? existing.allowManualDeploy ?? true,
        allowCiDeploy: input.allowCiDeploy ?? existing.allowCiDeploy ?? false,
        allowApiDeploy: input.allowApiDeploy ?? existing.allowApiDeploy ?? false,
        allowImport: input.allowImport ?? existing.allowImport ?? true,
        approvedById: input.approvedById ?? existing.approvedById,
        approvalStatus,
        approvedAt: resolveApprovedAt(approvalStatus, input.approvedAt, existing.approvedAt, now),
        policyTagsJson: policyTagsJson !== undefined ? policyTagsJson : existing.policyTagsJson,
        diagnosticsJson: diagnosticsJson !== undefined ? diagnosticsJson : existing.diagnosticsJson,
        lastSeenAt: now,
        updatedAt: now,
      });
      return { id: existing.id };
    }

    const id = generateId();
    const source = input.source || 'manual';
    const approvalStatus = normalizeApprovalStatus(input.approvalStatus, source);
    const approvedById = input.approvedById ?? (approvalStatus === 'approved' ? input.createdById || null : null);
    await targetRepo.insert({
      id,
      tenantId: normalizeTenantId(input.tenantId),
      projectId: input.projectId,
      engineId: input.engineId,
      status: input.status || 'active',
      source,
      sourceRef: input.sourceRef || null,
      externalSystemId: normalizeString(input.externalSystemId),
      externalProjectId: normalizeString(input.externalProjectId),
      externalEngineId: normalizeString(input.externalEngineId),
      externalTargetId: normalizeString(input.externalTargetId),
      allowManualDeploy: input.allowManualDeploy ?? true,
      allowCiDeploy: input.allowCiDeploy ?? false,
      allowApiDeploy: input.allowApiDeploy ?? false,
      allowImport: input.allowImport ?? true,
      createdById: input.createdById || null,
      approvedById,
      approvalStatus,
      approvedAt: resolveApprovedAt(approvalStatus, input.approvedAt, null, now),
      policyTagsJson: stringifyPolicyTags(input.policyTags) ?? null,
      diagnosticsJson: stringifyDiagnostics(input.diagnostics) ?? null,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    });
    return { id };
  }

  async updateTarget(id: string, input: ProjectEngineTargetUpdateInput): Promise<void> {
    const dataSource = await getDataSource();
    const targetRepo = dataSource.getRepository(ProjectEngineTarget);
    const existing = await targetRepo.findOneBy({ id });
    if (!existing || !isTenantVisible(existing.tenantId, input.tenantId)) {
      throw Errors.notFound('Project Engine Target');
    }
    this.assertCanChangeTarget(existing, input.allowSourceOwnedMutation);
    this.assertCanSetTargetSource(input.source, input.allowSourceOwnedMutation);
    await this.assertManualTargetManagementAllowed(input.allowSourceOwnedMutation);
    const source = input.source || existing.source;
    const approvalStatus = normalizeApprovalStatus(input.approvalStatus ?? existing.approvalStatus, source);
    const policyTagsJson = stringifyPolicyTags(input.policyTags);
    const diagnosticsJson = stringifyDiagnostics(input.diagnostics);
    const now = Date.now();

    await targetRepo.update({ id }, {
      status: input.status || existing.status,
      source,
      sourceRef: input.sourceRef !== undefined ? input.sourceRef : existing.sourceRef,
      externalSystemId: input.externalSystemId !== undefined ? normalizeString(input.externalSystemId) : existing.externalSystemId,
      externalProjectId: input.externalProjectId !== undefined ? normalizeString(input.externalProjectId) : existing.externalProjectId,
      externalEngineId: input.externalEngineId !== undefined ? normalizeString(input.externalEngineId) : existing.externalEngineId,
      externalTargetId: input.externalTargetId !== undefined ? normalizeString(input.externalTargetId) : existing.externalTargetId,
      allowManualDeploy: input.allowManualDeploy ?? existing.allowManualDeploy,
      allowCiDeploy: input.allowCiDeploy ?? existing.allowCiDeploy,
      allowApiDeploy: input.allowApiDeploy ?? existing.allowApiDeploy,
      allowImport: input.allowImport ?? existing.allowImport,
      approvedById: input.approvedById !== undefined ? input.approvedById : existing.approvedById,
      approvalStatus,
      approvedAt: resolveApprovedAt(approvalStatus, input.approvedAt, existing.approvedAt, now),
      policyTagsJson: policyTagsJson !== undefined ? policyTagsJson : existing.policyTagsJson,
      diagnosticsJson: diagnosticsJson !== undefined ? diagnosticsJson : existing.diagnosticsJson,
      updatedAt: now,
    });
  }

  async archiveTarget(id: string, tenantId?: string | null, allowSourceOwnedMutation = false): Promise<void> {
    await this.updateTarget(id, { tenantId, status: 'archived', allowSourceOwnedMutation });
  }

  async ensureTargetFromLegacyAccess(
    projectId: string,
    engineId: string,
    grantedById?: string | null,
    autoApproved = false,
    tenantId?: string | null
  ): Promise<{ id: string } | null> {
    if (!engineId || engineId === '__env__') return null;
    if ((await this.getProjectEngineTargetPolicyMode()) === 'external_only') return null;
    const existing = await this.findTargetForPair(projectId, engineId, tenantId);
    if (existing && isSourceOwnedProjectEngineTarget(existing.source)) return null;
    return this.createTarget({
      tenantId,
      projectId,
      engineId,
      source: 'legacy',
      sourceRef: `engine_project_access:${projectId}:${engineId}`,
      allowManualDeploy: true,
      allowCiDeploy: false,
      allowApiDeploy: false,
      allowImport: true,
      createdById: grantedById || null,
      approvedById: autoApproved ? grantedById || null : null,
    });
  }

  async archiveLegacyTarget(projectId: string, engineId: string, tenantId?: string | null): Promise<void> {
    if (!engineId || engineId === '__env__') return;
    const dataSource = await getDataSource();
    const repo = dataSource.getRepository(ProjectEngineTarget);
    const existing = await repo.findOne({ where: { projectId, engineId } });
    if (!existing || !isTenantVisible(existing.tenantId, tenantId)) return;
    if (existing.source !== 'legacy' && !existing.sourceRef?.startsWith('engine_project_access:')) return;
    await repo.update({ id: existing.id }, {
      status: 'archived',
      updatedAt: Date.now(),
    });
  }

  async hasActiveTarget(
    projectId: string,
    engineId: string,
    mode: ProjectEngineTargetMode = 'manual',
    tenantId?: string | null
  ): Promise<boolean> {
    if (!projectId || !engineId || engineId === '__env__') return false;
    const target = await this.findTargetForPair(projectId, engineId, tenantId);
    if (target) {
      const policyMode = await this.getProjectEngineTargetPolicyMode();
      if (policyMode === 'external_only' && !isSourceOwnedProjectEngineTarget(target.source)) return false;
      return modeAllowed(target, mode);
    }

    const dataSource = await getDataSource();
    const legacyAccess = await dataSource.getRepository(EngineProjectAccess).findOne({ where: { projectId, engineId } });
    if (!legacyAccess) return false;
    if ((await this.getProjectEngineTargetPolicyMode()) === 'external_only') return false;
    await this.ensureTargetFromLegacyAccess(projectId, engineId, legacyAccess.grantedById, legacyAccess.autoApproved, tenantId);
    return mode === 'manual' || mode === 'import';
  }

  async getProjectEngineIds(projectId: string, tenantId?: string | null): Promise<string[]> {
    const dataSource = await getDataSource();
    const legacyRows = await dataSource.getRepository(EngineProjectAccess).find({
      where: { projectId },
      select: ['engineId'],
    });
    const targetRows = (await dataSource.getRepository(ProjectEngineTarget).find({
      where: { projectId, status: 'active' },
      select: ['engineId', 'tenantId'],
    }))
      .filter((target) => isTenantVisible(target.tenantId, tenantId));

    return Array.from(new Set([
      ...legacyRows.map((row) => row.engineId),
      ...targetRows.map((row) => row.engineId),
    ]));
  }

  async getEngineProjectIds(engineId: string, tenantId?: string | null): Promise<string[]> {
    const dataSource = await getDataSource();
    const legacyRows = await dataSource.getRepository(EngineProjectAccess).find({
      where: { engineId },
      select: ['projectId'],
    });
    const targetRows = (await dataSource.getRepository(ProjectEngineTarget).find({
      where: { engineId, status: 'active' },
      select: ['projectId', 'tenantId'],
    }))
      .filter((target) => isTenantVisible(target.tenantId, tenantId));

    return Array.from(new Set([
      ...legacyRows.map((row) => row.projectId),
      ...targetRows.map((row) => row.projectId),
    ]));
  }

  async syncLegacyAccessForProject(projectId: string, tenantId?: string | null): Promise<{ createdOrUpdated: number }> {
    if ((await this.getProjectEngineTargetPolicyMode()) === 'external_only') {
      return { createdOrUpdated: 0 };
    }
    const dataSource = await getDataSource();
    const accessRows = await dataSource.getRepository(EngineProjectAccess).find({ where: { projectId } });
    let createdOrUpdated = 0;
    for (const row of accessRows) {
      const result = await this.ensureTargetFromLegacyAccess(row.projectId, row.engineId, row.grantedById, row.autoApproved, tenantId);
      if (result) createdOrUpdated += 1;
    }
    return { createdOrUpdated };
  }

  private async findTargetForPair(projectId: string, engineId: string, tenantId?: string | null): Promise<ProjectEngineTarget | null> {
    const dataSource = await getDataSource();
    const target = await dataSource.getRepository(ProjectEngineTarget).findOne({ where: { projectId, engineId } });
    if (!target || !isTenantVisible(target.tenantId, tenantId)) return null;
    return target;
  }

  private assertCanChangeTarget(target: ProjectEngineTarget, allowSourceOwnedMutation = false): void {
    if (allowSourceOwnedMutation || !isSourceOwnedProjectEngineTarget(target.source)) return;
    throw Errors.conflict(projectEngineTargetOwnershipReason(target.source, target.sourceRef));
  }

  private assertCanSetTargetSource(source: ProjectEngineTargetSource | undefined, allowSourceOwnedMutation = false): void {
    if (!source || allowSourceOwnedMutation || !isSourceOwnedProjectEngineTarget(source)) return;
    throw Errors.conflict('Source-owned project-engine targets must be created or changed through their owning integration');
  }

  private async assertManualTargetManagementAllowed(allowSourceOwnedMutation = false): Promise<void> {
    if (allowSourceOwnedMutation) return;
    if ((await this.getProjectEngineTargetPolicyMode()) !== 'external_only') return;
    throw Errors.conflict('Project-engine target management is external-only by platform policy; use the owning external system to create or change deployment targets');
  }

  private async getProjectEngineTargetPolicyMode(): Promise<ProjectEngineTargetPolicyMode> {
    try {
      return (await platformSettingsService.get()).projectEngineTargetMode;
    } catch {
      return DEFAULT_PROJECT_ENGINE_TARGET_MODE;
    }
  }

  private async assertProjectAndEngineVisible(
    dataSource: DataSource,
    projectId: string,
    engineId: string,
    tenantId?: string | null
  ): Promise<void> {
    const project = await dataSource.getRepository(Project).findOne({ where: { id: projectId }, select: ['id', 'tenantId'] });
    if (!project || !isTenantVisible(project.tenantId, tenantId)) {
      throw Errors.notFound('Project', projectId);
    }
    const engine = await dataSource.getRepository(Engine).findOne({ where: { id: engineId }, select: ['id', 'tenantId'] });
    if (!engine || !isTenantVisible(engine.tenantId, tenantId)) {
      throw Errors.notFound('Engine', engineId);
    }
  }

  private async decorateTargets(dataSource: DataSource, targets: ProjectEngineTarget[]): Promise<ProjectEngineTargetView[]> {
    if (targets.length === 0) return [];
    const projectIds = Array.from(new Set(targets.map((target) => target.projectId)));
    const engineIds = Array.from(new Set(targets.map((target) => target.engineId)));
    const projects = await dataSource.getRepository(Project).find({
      where: { id: In(projectIds) },
      select: ['id', 'name', 'tenantId'],
    });
    const engines = await dataSource.getRepository(Engine).find({
      where: { id: In(engineIds) },
      select: ['id', 'name', 'baseUrl', 'environmentTagId', 'tenantId'],
    });
    const environmentIds = Array.from(new Set(
      engines
        .map((engine) => engine.environmentTagId)
        .filter((id): id is string => Boolean(id))
    ));
    const environments = environmentIds.length > 0
      ? await dataSource.getRepository(EnvironmentTag).find({
        where: { id: In(environmentIds) },
        select: ['id', 'name', 'color', 'manualDeployAllowed'],
      })
      : [];

    return targets.map((target) => toTargetView(
      target,
      new Map(projects.map((project) => [project.id, project])),
      new Map(engines.map((engine) => [engine.id, engine])),
      new Map(environments.map((environment) => [environment.id, environment]))
    ));
  }
}

export const projectEngineTargetService = new ProjectEngineTargetService();
