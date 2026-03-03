/**
 * Engine Access Service
 * Handles project-engine access requests and grants
 */

import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Engine } from '@enterpriseglue/shared/db/entities/Engine.js';
import { EngineProjectAccess } from '@enterpriseglue/shared/db/entities/EngineProjectAccess.js';
import { EngineAccessRequest } from '@enterpriseglue/shared/db/entities/EngineAccessRequest.js';
import { ProjectMember } from '@enterpriseglue/shared/db/entities/ProjectMember.js';
import { In } from 'typeorm';
import { generateId } from '@enterpriseglue/shared/utils/id.js';

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
    return access !== null;
  }

  /**
   * Get all engines a project has access to
   */
  async getProjectEngines(projectId: string): Promise<string[]> {
    const dataSource = await getDataSource();
    const accessRepo = dataSource.getRepository(EngineProjectAccess);
    const access = await accessRepo.find({ where: { projectId }, select: ['engineId'] });
    return access.map(a => a.engineId);
  }

  /**
   * Get all projects that have access to an engine
   */
  async getEngineProjects(engineId: string): Promise<string[]> {
    const dataSource = await getDataSource();
    const accessRepo = dataSource.getRepository(EngineProjectAccess);
    const access = await accessRepo.find({ where: { engineId }, select: ['projectId'] });
    return access.map(a => a.projectId);
  }

  /**
   * Request access to an engine for a project
   * May auto-approve if project owner/delegate is also engine owner/delegate
   */
  async requestAccess(
    projectId: string,
    engineId: string,
    requestedById: string
  ): Promise<{ status: 'approved' | 'pending'; autoApproved?: boolean; requestId?: string }> {
    const dataSource = await getDataSource();
    const requestRepo = dataSource.getRepository(EngineAccessRequest);
    const engineRepo = dataSource.getRepository(Engine);
    const memberRepo = dataSource.getRepository(ProjectMember);

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

    // Get engine owner/delegate
    const engine = await engineRepo.findOne({
      where: { id: engineId },
      select: ['ownerId', 'delegateId']
    });

    if (!engine) {
      throw new Error('Engine not found');
    }

    const engineOwnerDelegate = [engine.ownerId, engine.delegateId].filter(Boolean) as string[];

    // Get project owners and delegates
    const projectLeaders = await memberRepo.find({
      where: { projectId, role: In(['owner', 'delegate']) },
      select: ['userId']
    });

    const projectUserIds = projectLeaders.map((p) => p.userId);

    // Check for auto-approval: project owner/delegate is also engine owner/delegate
    const shouldAutoApprove = projectUserIds.some((id) => engineOwnerDelegate.includes(id));

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

    return { id };
  }

  /**
   * Revoke project access to an engine
   */
  async revokeAccess(projectId: string, engineId: string): Promise<void> {
    const dataSource = await getDataSource();
    const accessRepo = dataSource.getRepository(EngineProjectAccess);
    await accessRepo.delete({ projectId, engineId });
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
