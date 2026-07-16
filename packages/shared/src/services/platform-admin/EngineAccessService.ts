/**
 * Engine Access Service
 * Handles project-engine access requests and grants
 */

import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { EngineProjectAccess } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineProjectAccess.js';
import { EngineAccessRequest } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineAccessRequest.js';
import { Project } from '@enterpriseglue/shared/infrastructure/persistence/entities/Project.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
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
  /**
   * Check if a project has access to an engine
   */
  async hasProjectAccess(projectId: string, engineId: string): Promise<boolean> {
    const dataSource = await getDataSource();
    const accessRepo = dataSource.getRepository(EngineProjectAccess);
    const access = await accessRepo.findOne({ where: { projectId, engineId } });
    if (access !== null) {
      await projectEngineTargetService.ensureTargetFromLegacyAccess(projectId, engineId, access.grantedById, access.autoApproved)
        .catch(() => undefined);
      return true;
    }
    return projectEngineTargetService.hasActiveTarget(projectId, engineId, 'manual');
  }

  /**
   * Get all engines a project has access to
   */
  async getProjectEngines(projectId: string): Promise<string[]> {
    return projectEngineTargetService.getProjectEngineIds(projectId);
  }

  /**
   * Get all projects that have access to an engine
   */
  async getEngineProjects(engineId: string): Promise<string[]> {
    return projectEngineTargetService.getEngineProjectIds(engineId);
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

    // Check if access already exists
    const existingAccess = await this.hasProjectAccess(projectId, engineId);
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
    const engine = await engineRepo.findOne({
      where: { id: engineId },
      select: ['id', 'tenantId']
    });

    if (!engine) {
      throw new Error('Engine not found');
    }
    const project = await projectRepo.findOne({
      where: { id: projectId },
      select: ['id', 'tenantId'],
    });
    if (!project) {
      throw new Error('Project not found');
    }
    if (project.tenantId && engine.tenantId && project.tenantId !== engine.tenantId) {
      throw new Error('Project and engine must belong to the same tenant');
    }

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
      await this.grantAccess(projectId, engineId, requestedById, true);
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
    autoApproved: boolean = false
  ): Promise<{ id: string }> {
    const dataSource = await getDataSource();
    const accessRepo = dataSource.getRepository(EngineProjectAccess);
    const id = generateId();

    await accessRepo.insert({
      id,
      engineId,
      projectId,
      grantedById,
      autoApproved,
      createdAt: Date.now(),
    });

    await projectEngineTargetService.ensureTargetFromLegacyAccess(projectId, engineId, grantedById, autoApproved);

    return { id };
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
    await this.grantAccess(request.projectId, request.engineId, reviewedById, false);

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
