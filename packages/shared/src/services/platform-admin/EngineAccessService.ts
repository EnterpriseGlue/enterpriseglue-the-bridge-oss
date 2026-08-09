/**
 * Engine Access Service
 * Handles project-engine access requests and grants
 */

import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { EngineProjectAccess } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineProjectAccess.js';
import { EngineAccessRequest } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineAccessRequest.js';
import { Project } from '@enterpriseglue/shared/infrastructure/persistence/entities/Project.js';
import { ProjectEngineTarget } from '@enterpriseglue/shared/infrastructure/persistence/entities/ProjectEngineTarget.js';
import {
  OSS_DEFAULT_TENANT_ID,
  normalizeTenantIdForPersistence,
} from '@enterpriseglue/shared/authz/tenant-scope.js';
import { isEngineVisibleInTenancyContext } from '@enterpriseglue/shared/engine-tenancy/visibility.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import type { DataSource, EntityManager } from 'typeorm';
import { projectEngineTargetService } from './ProjectEngineTargetService.js';
import { EnginePermissions, permissionService, ProjectPermissions } from './permissions.js';

export interface AccessRequest {
  id: string;
  engineId: string;
  projectId: string;
  requestedById: string;
  status: string;
  createdAt: number;
}

export class EngineAccessService {
  private effectiveTenantId(tenantId?: string | null): string {
    return normalizeTenantIdForPersistence(tenantId) || OSS_DEFAULT_TENANT_ID;
  }

  private async assertVisibleTopology(
    store: DataSource | EntityManager,
    projectId: string,
    engineId: string,
    tenantId?: string | null,
  ): Promise<{ project: Project; engine: Engine; tenantId: string }> {
    const effectiveTenantId = this.effectiveTenantId(tenantId);
    const project = await store.getRepository(Project).findOne({
      where: { id: projectId },
      select: ['id', 'tenantId'],
    });
    if (!project || project.tenantId !== effectiveTenantId) {
      throw new Error('Project and engine must belong to the same tenant');
    }
    const engine = await store.getRepository(Engine).findOne({
      where: { id: engineId, lifecycleStatus: 'active' },
      select: ['id', 'tenantId', 'tenancyMode', 'lifecycleStatus'],
    });
    const topologyMatchesProject = engine?.tenancyMode === 'shared'
      ? !engine.tenantId
      : Boolean(engine?.tenantId && engine.tenantId === project.tenantId);
    if (!engine || !isEngineVisibleInTenancyContext(engine, effectiveTenantId) || !topologyMatchesProject) {
      throw new Error('Project and engine must belong to the same tenant');
    }
    return { project, engine, tenantId: effectiveTenantId };
  }

  /**
   * Check if a project has access to an engine
   */
  async hasProjectAccess(projectId: string, engineId: string, tenantId?: string | null): Promise<boolean> {
    const dataSource = await getDataSource();
    try {
      const topology = await this.assertVisibleTopology(dataSource, projectId, engineId, tenantId);
      return await projectEngineTargetService.hasActiveTarget(
        projectId,
        engineId,
        'manual',
        topology.tenantId,
      );
    } catch {
      return false;
    }
  }

  /**
   * Get all engines a project has access to
   */
  async getProjectEngines(projectId: string, tenantId?: string | null): Promise<string[]> {
    return projectEngineTargetService.getProjectEngineIds(projectId, this.effectiveTenantId(tenantId));
  }

  /**
   * Get all projects that have access to an engine
   */
  async getEngineProjects(engineId: string, tenantId?: string | null): Promise<string[]> {
    return projectEngineTargetService.getEngineProjectIds(engineId, this.effectiveTenantId(tenantId));
  }

  /**
   * Request access to an engine for a project
   * May auto-approve only when the requester holds canonical management
   * permissions for both the project and the engine. Accountable owner and
   * delegate metadata is deliberately not an authorization input here.
   */
  async requestAccess(
    projectId: string,
    engineId: string,
    requestedById: string
  ): Promise<{ status: 'approved' | 'pending'; autoApproved?: boolean; requestId?: string }> {
    const dataSource = await getDataSource();
    const requestRepo = dataSource.getRepository(EngineAccessRequest);
    const engineRepo = dataSource.getRepository(Engine);
    const projectRepo = dataSource.getRepository(Project);

    // Validate the persisted topology before honoring compatibility access or
    // pending rows so stale rows cannot resurrect a quarantined engine.
    const engine = await engineRepo.findOne({
      where: { id: engineId },
      select: ['id', 'tenantId', 'tenancyMode']
    });
    if (!engine) {
      throw new Error('Engine not found');
    }
    const project = await projectRepo.findOne({
      where: { id: projectId },
      select: ['id', 'tenantId'],
    });
    if (!project?.tenantId) {
      throw new Error('Project not found');
    }
    if (
      !isEngineVisibleInTenancyContext(engine, project.tenantId)
      || (engine.tenancyMode === 'dedicated' && !project.tenantId)
    ) {
      throw new Error('Project and engine must belong to the same tenant');
    }

    // Check if access already exists
    const existingAccess = await this.hasProjectAccess(projectId, engineId, project.tenantId);
    if (existingAccess) {
      return { status: 'approved', autoApproved: false };
    }

    // Check for pending request
    const pendingRequest = await requestRepo.findOne({
      where: { projectId, engineId, status: 'pending' }
    });

    if (pendingRequest) {
      return { status: 'pending', requestId: pendingRequest.id };
    }

    // Resolve tenant context for the canonical evaluator. Do not infer access
    // from the legacy accountable owner/delegate columns.
    const tenantId = project.tenantId || engine.tenantId || null;
    const [canManageProject, canManageEngine] = await Promise.all([
      permissionService.hasPermission(ProjectPermissions.PROJECT_SETTINGS, {
        userId: requestedById,
        tenantId,
        resourceType: 'project',
        resourceId: projectId,
      }),
      permissionService.hasPermission(EnginePermissions.ENGINE_EDIT, {
        userId: requestedById,
        tenantId,
        resourceType: 'engine',
        resourceId: engineId,
      }),
    ]);
    const shouldAutoApprove = canManageProject && canManageEngine;

    if (shouldAutoApprove) {
      // Auto-approve: directly grant access
      await this.grantAccess(projectId, engineId, requestedById, true, project.tenantId);
      return { status: 'approved', autoApproved: true };
    }

    // Create pending request
    const id = generateId();
    await requestRepo.insert({
      id,
      engineId,
      projectId,
      requestedById,
      status: 'pending',
      createdAt: Date.now(),
    });

    return { status: 'pending', requestId: id };
  }

  /**
   * Grant project access to an engine
   */
  async grantAccess(
    projectId: string,
    engineId: string,
    grantedById: string,
    autoApproved: boolean,
    tenantId: string | null,
  ): Promise<{ id: string }> {
    const dataSource = await getDataSource();
    const effectiveTenantId = this.effectiveTenantId(tenantId);
    return dataSource.transaction(async (manager) => {
      const projectClaim = await manager.getRepository(Project).update(
        { id: projectId, tenantId: effectiveTenantId },
        { id: projectId },
      );
      if (projectClaim.affected !== 1) {
        throw new Error('Project and engine must belong to the same tenant');
      }
      const engineClaim = await manager.getRepository(Engine).update(
        { id: engineId, lifecycleStatus: 'active' },
        { id: engineId },
      );
      if (engineClaim.affected !== 1) {
        throw new Error('Project and engine must belong to the same tenant');
      }
      await this.assertVisibleTopology(manager, projectId, engineId, effectiveTenantId);

      const id = generateId();
      await manager.getRepository(EngineProjectAccess).insert({
        id,
        engineId,
        projectId,
        grantedById,
        autoApproved,
        createdAt: Date.now(),
      });
      const materialized = await projectEngineTargetService.ensureTargetFromLegacyAccess(
        projectId,
        engineId,
        grantedById,
        autoApproved,
        effectiveTenantId,
        manager,
      );
      if (!materialized) {
        const existingTarget = await manager.getRepository(ProjectEngineTarget).findOne({
          where: { projectId, engineId, tenantId: effectiveTenantId, status: 'active' },
          select: ['id', 'allowManualDeploy'],
        });
        if (!existingTarget?.allowManualDeploy) {
          throw new Error('Engine access requires an active project-engine target in the same tenant');
        }
      }
      return { id };
    });
  }

  /**
   * Revoke project access to an engine
   */
  async revokeAccess(projectId: string, engineId: string): Promise<void> {
    const dataSource = await getDataSource();
    const accessRepo = dataSource.getRepository(EngineProjectAccess);
    await accessRepo.delete({ projectId, engineId });
    await projectEngineTargetService.archiveLegacyTarget(projectId, engineId);
  }

  /**
   * Get pending access requests for an engine
   */
  async getPendingRequests(engineId: string): Promise<AccessRequest[]> {
    const dataSource = await getDataSource();
    const requestRepo = dataSource.getRepository(EngineAccessRequest);
    return requestRepo.find({ where: { engineId, status: 'pending' } });
  }

  /**
   * Approve an access request
   */
  async approveRequest(requestId: string, reviewedById: string): Promise<void> {
    const dataSource = await getDataSource();
    const requestRepo = dataSource.getRepository(EngineAccessRequest);
    const now = Date.now();

    // Get the request
    const request = await requestRepo.findOne({ where: { id: requestId } });

    if (!request) {
      throw new Error('Request not found');
    }

    // Grant access
    const project = await dataSource.getRepository(Project).findOne({
      where: { id: request.projectId },
      select: ['id', 'tenantId'],
    });
    if (!project?.tenantId) throw new Error('Project not found');
    await this.grantAccess(request.projectId, request.engineId, reviewedById, false, project.tenantId);

    // Update request status
    await requestRepo.update({ id: requestId }, {
      status: 'approved',
      reviewedById,
      reviewedAt: now,
    });
  }

  /**
   * Deny an access request
   */
  async denyRequest(requestId: string, reviewedById: string): Promise<void> {
    const dataSource = await getDataSource();
    const requestRepo = dataSource.getRepository(EngineAccessRequest);
    const now = Date.now();

    await requestRepo.update({ id: requestId }, {
      status: 'denied',
      reviewedById,
      reviewedAt: now,
    });
  }
}

// Export singleton instance
export const engineAccessService = new EngineAccessService();
