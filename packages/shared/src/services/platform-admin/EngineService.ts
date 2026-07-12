/**
 * Engine Service
 * Handles engine ownership, membership, and environment tagging
 * 
 * Engines are stored in the database
 */

import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { EngineMember } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineMember.js';
import { EnvironmentTag } from '@enterpriseglue/shared/infrastructure/persistence/entities/EnvironmentTag.js';
import { User } from '@enterpriseglue/shared/infrastructure/persistence/entities/User.js';
import { RbacRoleAssignment } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRoleAssignment.js';
import { RbacRole } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRole.js';
import { RbacRolePermission } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRolePermission.js';
import { In, IsNull } from 'typeorm';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import type { EngineRole } from '@enterpriseglue/shared/constants/roles.js';
import { ENGINE_SYSTEM_ROLE_TO_LEGACY_ROLE, EnginePermissions, permissionService, SYSTEM_ROLE_IDS } from './permissions.js';

export type EngineAccessRole = EngineRole | 'custom';

export interface EngineWithDetails {
  engine: Engine;
  role: EngineAccessRole;
  environmentTag: EnvironmentTag | null;
}

export interface EngineMemberWithUser {
  id: string;
  engineId: string;
  userId: string;
  role: string;
  grantedById: string | null;
  createdAt: number;
  user: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
  } | null;
}

const ENGINE_ACCESS_DISPLAY_SYSTEM_ROLE_IDS = [
  SYSTEM_ROLE_IDS.ENGINE_OWNER,
  SYSTEM_ROLE_IDS.ENGINE_DELEGATE,
  SYSTEM_ROLE_IDS.ENGINE_OPERATOR,
  SYSTEM_ROLE_IDS.ENGINE_DEPLOYER,
] as const;

const ENGINE_STANDARD_MEMBER_SYSTEM_ROLE_IDS = [
  SYSTEM_ROLE_IDS.ENGINE_OPERATOR,
  SYSTEM_ROLE_IDS.ENGINE_DEPLOYER,
] as const;

const ENGINE_MEMBER_ROLE_TO_SYSTEM_ROLE_ID: Record<'operator' | 'deployer', string> = {
  operator: SYSTEM_ROLE_IDS.ENGINE_OPERATOR,
  deployer: SYSTEM_ROLE_IDS.ENGINE_DEPLOYER,
};

const ENGINE_GOVERNANCE_SOURCE = 'system';

function engineGovernanceSourceRef(engineId: string, slot: 'owner' | 'delegate'): string {
  return `engine:${engineId}:governance-${slot}`;
}

async function syncLegacyEngineAssignments(engineId: string): Promise<void> {
  try {
    await permissionService.syncLegacyRoleAssignments({ engineIds: [engineId] });
  } catch (error) {
    logger.warn('Failed to sync legacy engine role assignments', { engineId, error });
  }
}

export class EngineService {
  /**
   * Get user's role on an engine
   */
  async getEngineRole(userId: string, engineId: string, tenantId?: string | null): Promise<EngineRole | null> {
    const dataSource = await getDataSource();
    const engineRepo = dataSource.getRepository(Engine);
    const memberRepo = dataSource.getRepository(EngineMember);
    
    // Get engine to check owner/delegate
    const engine = await engineRepo.findOne({ where: { id: engineId } });

    if (!engine) return null;
    if (tenantId && engine.tenantId && engine.tenantId !== tenantId) return null;
    
    // Check if owner or delegate
    if (engine.ownerId === userId) return 'owner';
    if (engine.delegateId === userId) return 'delegate';
    
    // Check engine_members table
    const membership = await memberRepo.findOne({
      where: { engineId, userId }
    });

    if (membership?.role) {
      return membership.role as EngineRole;
    }

    return await permissionService.getAssignedEngineRole(userId, engineId, tenantId);
  }

  /**
   * Check if user has access to engine with at least the required role
   */
  async hasEngineAccess(userId: string, engineId: string, requiredRoles: EngineRole[], tenantId?: string | null): Promise<boolean> {
    const role = await this.getEngineRole(userId, engineId, tenantId);
    if (!role) return false;
    return requiredRoles.includes(role);
  }

  /**
   * Get all engines a user has access to, optionally filtered by tenant
   */
  async getUserEngines(userId: string, tenantId?: string | null): Promise<EngineWithDetails[]> {
    const dataSource = await getDataSource();
    const engineRepo = dataSource.getRepository(Engine);
    const memberRepo = dataSource.getRepository(EngineMember);
    const tagRepo = dataSource.getRepository(EnvironmentTag);
    const results: EngineWithDetails[] = [];

    // Get engines where user is owner (include null tenantId for legacy data)
    const ownedEngines = tenantId
      ? await engineRepo.find({ where: [{ ownerId: userId, tenantId }, { ownerId: userId, tenantId: IsNull() }] })
      : await engineRepo.find({ where: { ownerId: userId } });
    const tagIds = new Set<string>();
    ownedEngines.forEach(e => e.environmentTagId && tagIds.add(e.environmentTagId));
    
    for (const engine of ownedEngines) {
      results.push({
        engine,
        role: 'owner',
        environmentTag: null, // Will populate below
      });
    }

    // Get engines where user is delegate (include null tenantId for legacy data)
    const delegatedEngines = tenantId
      ? await engineRepo.find({ where: [{ delegateId: userId, tenantId }, { delegateId: userId, tenantId: IsNull() }] })
      : await engineRepo.find({ where: { delegateId: userId } });
    delegatedEngines.forEach(e => e.environmentTagId && tagIds.add(e.environmentTagId));
    
    for (const engine of delegatedEngines) {
      const alreadyAdded = results.some(r => r.engine.id === engine.id);
      if (!alreadyAdded) {
        results.push({
          engine,
          role: 'delegate',
          environmentTag: null,
        });
      }
    }

    // Get engines where user is a member (operator/deployer)
    const memberships = await memberRepo.find({ where: { userId } });

    if (memberships.length > 0) {
      const memberEngineIds = memberships.map(m => m.engineId);
      // Filter member engines by tenant if specified (include null tenantId for legacy data)
      const memberEngines = tenantId 
        ? await engineRepo.find({ where: [{ id: In(memberEngineIds), tenantId }, { id: In(memberEngineIds), tenantId: IsNull() }] })
        : await engineRepo.find({ where: { id: In(memberEngineIds) } });
      memberEngines.forEach(e => e.environmentTagId && tagIds.add(e.environmentTagId));

      for (const engine of memberEngines) {
        if (!results.find(r => r.engine.id === engine.id)) {
          const membership = memberships.find(m => m.engineId === engine.id);
          const role = (membership?.role as EngineRole) || null;
          if (!role) continue;
          results.push({
            engine,
            role,
            environmentTag: null,
          });
        }
      }
    }

    // Include engines granted through scoped RBAC role assignments, including all-engine assignments.
    const assignedEngineRoles = await permissionService.getAssignedEngineRoles(userId, tenantId);
    const assignmentQb = dataSource.getRepository(RbacRoleAssignment)
      .createQueryBuilder('assignment')
      .innerJoin(RbacRole, 'role', 'role.id = assignment.roleId')
      .innerJoin(RbacRolePermission, 'rolePermission', 'rolePermission.roleId = assignment.roleId')
      .where('assignment.userId = :userId', { userId })
      .andWhere('assignment.resourceType = :resourceType', { resourceType: 'engine' })
      .andWhere('role.isArchived = :isArchived', { isArchived: false })
      .andWhere('rolePermission.permissionId IN (:...permissions)', { permissions: Object.values(EnginePermissions) });
    if (tenantId) {
      assignmentQb
        .andWhere('(assignment.tenantId = :tenantId OR assignment.tenantId IS NULL)', { tenantId })
        .andWhere('(role.tenantId = :tenantId OR role.tenantId IS NULL)', { tenantId });
    }
    const assignmentRows = await assignmentQb.getMany();
    const allEngineRole = assignedEngineRoles.find((assignment) => assignment.engineId === null)?.role || null;
    const hasAllEngineAssignment = assignmentRows.some((assignment) => assignment.resourceId === null);
    const assignedEngineIds = Array.from(new Set([
      ...assignedEngineRoles.map((assignment) => assignment.engineId),
      ...assignmentRows.map((assignment) => assignment.resourceId),
    ].filter((engineId): engineId is string => Boolean(engineId))));
    let assignedEngines: Engine[] = [];

    if (allEngineRole || hasAllEngineAssignment) {
      assignedEngines = tenantId
        ? await engineRepo.find({ where: [{ tenantId }, { tenantId: IsNull() }] })
        : await engineRepo.find();
    } else if (assignedEngineIds.length > 0) {
      assignedEngines = tenantId
        ? await engineRepo.find({ where: [{ id: In(assignedEngineIds), tenantId }, { id: In(assignedEngineIds), tenantId: IsNull() }] })
        : await engineRepo.find({ where: { id: In(assignedEngineIds) } });
    }

    for (const engine of assignedEngines) {
      if (results.find(r => r.engine.id === engine.id)) {
        continue;
      }

      const role = allEngineRole || assignedEngineRoles.find((assignment) => assignment.engineId === engine.id)?.role || 'custom';
      if (!role) continue;
      if (engine.environmentTagId) tagIds.add(engine.environmentTagId);
      results.push({
        engine,
        role,
        environmentTag: null,
      });
    }

    // Fetch all environment tags at once
    const tags = tagIds.size > 0 ? await tagRepo.find({ where: { id: In(Array.from(tagIds)) } }) : [];
    const tagMap = new Map(tags.map(t => [t.id, t]));

    // Populate environment tags
    for (const result of results) {
      if (result.engine.environmentTagId && String(result.engine.id) !== '__env__') {
        result.environmentTag = tagMap.get(result.engine.environmentTagId) || null;
      }
    }

    return results;
  }

  /**
   * Get engine members (owner, delegate, operators, deployers)
   * Includes owner and delegate from engines table plus members from engine_members table
   */
  async getEngineMembers(engineId: string): Promise<EngineMemberWithUser[]> {
    const dataSource = await getDataSource();
    const engineRepo = dataSource.getRepository(Engine);
    const memberRepo = dataSource.getRepository(EngineMember);
    const userRepo = dataSource.getRepository(User);

    // Get engine to include owner and delegate
    const engine = await engineRepo.findOne({ where: { id: engineId } });

    if (!engine) {
      return [];
    }

    // Get members from engine_members table
    const members = await memberRepo.find({ where: { engineId } });
    const assignmentMembers = await dataSource.getRepository(RbacRoleAssignment)
      .createQueryBuilder('assignment')
      .where('assignment.resourceType = :resourceType', { resourceType: 'engine' })
      .andWhere('(assignment.resourceId = :engineId OR assignment.resourceId IS NULL)', { engineId })
      .andWhere('(assignment.principalType = :principalType OR assignment.principalType IS NULL)', { principalType: 'user' })
      .andWhere('assignment.roleId IN (:...roleIds)', { roleIds: ENGINE_ACCESS_DISPLAY_SYSTEM_ROLE_IDS })
      .andWhere('assignment.source != :legacySource', { legacySource: 'legacy' })
      .getMany();

    // Collect all user IDs (owner, delegate, and members)
    const userIds = new Set<string>();
    if (engine.ownerId) userIds.add(engine.ownerId);
    if (engine.delegateId) userIds.add(engine.delegateId);
    members.forEach(m => userIds.add(m.userId));
    assignmentMembers.forEach(m => userIds.add(m.userId));

    // Get user details
    let userMap = new Map<string, { id: string; email: string; firstName: string | null; lastName: string | null }>();
    if (userIds.size > 0) {
      const userList = await userRepo.find({
        where: { id: In(Array.from(userIds)) },
        select: ['id', 'email', 'firstName', 'lastName']
      });

      userMap = new Map(userList.map(u => [u.id, u]));
    }

    const result: EngineMemberWithUser[] = [];

    // Add owner first
    if (engine.ownerId) {
      result.push({
        id: `owner-${engine.ownerId}`,
        engineId,
        userId: engine.ownerId,
        role: 'owner',
        grantedById: null,
        createdAt: engine.createdAt || Date.now(),
        user: userMap.get(engine.ownerId) || null,
      });
    }

    // Add delegate
    if (engine.delegateId) {
      result.push({
        id: `delegate-${engine.delegateId}`,
        engineId,
        userId: engine.delegateId,
        role: 'delegate',
        grantedById: engine.ownerId,
        createdAt: engine.updatedAt || Date.now(),
        user: userMap.get(engine.delegateId) || null,
      });
    }

    // Add operators and deployers
    for (const member of members) {
      if (member.userId === engine.ownerId || member.userId === engine.delegateId) {
        continue;
      }
      result.push({
        id: member.id,
        engineId: member.engineId,
        userId: member.userId,
        role: member.role,
        grantedById: member.grantedById,
        createdAt: member.createdAt,
        user: userMap.get(member.userId) || null,
      });
    }

    const existingUserIds = new Set(result.map((member) => member.userId));
    for (const assignment of assignmentMembers) {
      if (existingUserIds.has(assignment.userId)) {
        continue;
      }
      const role = ENGINE_SYSTEM_ROLE_TO_LEGACY_ROLE[assignment.roleId];
      if (!role) continue;
      result.push({
        id: assignment.id,
        engineId,
        userId: assignment.userId,
        role,
        grantedById: assignment.createdById,
        createdAt: assignment.createdAt,
        user: userMap.get(assignment.userId) || null,
      });
      existingUserIds.add(assignment.userId);
    }

    return result;
  }

  /**
   * Assign a delegate to an engine (owner only)
   */
  async assignDelegate(engineId: string, delegateId: string | null): Promise<void> {
    const dataSource = await getDataSource();
    const engineRepo = dataSource.getRepository(Engine);
    const engine = await engineRepo.findOne({
      where: { id: engineId },
      select: ['id', 'ownerId', 'delegateId', 'tenantId', 'createdAt', 'updatedAt'],
    });
    if (!engine) {
      throw new Error('Engine not found');
    }

    await engineRepo.update({ id: engineId }, { delegateId, updatedAt: Date.now() });
    await this.syncManagedEngineGovernanceAssignments(dataSource, {
      ...engine,
      delegateId,
      updatedAt: Date.now(),
    });
    await syncLegacyEngineAssignments(engineId);
  }

  /**
   * Transfer engine ownership (owner only)
   */
  async transferOwnership(engineId: string, newOwnerId: string): Promise<void> {
    const dataSource = await getDataSource();
    const engineRepo = dataSource.getRepository(Engine);
    const engine = await engineRepo.findOne({
      where: { id: engineId },
      select: ['id', 'ownerId', 'delegateId', 'tenantId', 'createdAt', 'updatedAt'],
    });
    if (!engine) {
      throw new Error('Engine not found');
    }

    await engineRepo.update({ id: engineId }, { 
      ownerId: newOwnerId, 
      delegateId: null,
      updatedAt: Date.now() 
    });
    await this.syncManagedEngineGovernanceAssignments(dataSource, {
      ...engine,
      ownerId: newOwnerId,
      delegateId: null,
      updatedAt: Date.now(),
    });
    await syncLegacyEngineAssignments(engineId);
  }

  /**
   * Add an operator or deployer to an engine
   */
  async addEngineMember(
    engineId: string,
    userId: string,
    role: 'operator' | 'deployer',
    grantedById: string
  ): Promise<{ id: string }> {
    return permissionService.assignRole({
      principalType: 'user',
      principalId: userId,
      roleId: ENGINE_MEMBER_ROLE_TO_SYSTEM_ROLE_ID[role],
      resourceType: 'engine',
      resourceId: engineId,
      source: 'manual',
      createdById: grantedById,
    });
  }

  /**
   * Update a member's role
   */
  async updateEngineMemberRole(
    engineId: string,
    userId: string,
    newRole: 'operator' | 'deployer',
    updatedById?: string
  ): Promise<void> {
    const dataSource = await getDataSource();
    const memberRepo = dataSource.getRepository(EngineMember);
    
    const existing = await memberRepo.findOne({ where: { engineId, userId } });

    if (existing) {
      await dataSource.transaction(async (manager) => {
        await manager.getRepository(EngineMember).delete({ engineId, userId });

        await manager.getRepository(EngineMember).insert({
          id: generateId(),
          engineId,
          userId,
          role: newRole,
          grantedById: existing.grantedById,
          createdAt: Date.now(),
        });
      });
      await syncLegacyEngineAssignments(engineId);
      return;
    }

    const assignments = await this.getDirectUserEngineMemberAssignments(dataSource, engineId, userId);
    if (assignments.length === 0) {
      throw new Error('Member not found');
    }

    const nextRoleId = ENGINE_MEMBER_ROLE_TO_SYSTEM_ROLE_ID[newRole];
    await permissionService.assignRole({
      principalType: 'user',
      principalId: userId,
      roleId: nextRoleId,
      resourceType: 'engine',
      resourceId: engineId,
      source: 'manual',
      createdById: updatedById || assignments[0]?.createdById || userId,
    });

    await Promise.all(assignments
      .filter((assignment) => assignment.roleId !== nextRoleId)
      .map((assignment) => permissionService.removeRoleAssignment(assignment.id, updatedById))
    );
  }

  /**
   * Remove a member from an engine
   */
  async removeEngineMember(engineId: string, userId: string, removedById?: string): Promise<void> {
    const dataSource = await getDataSource();
    const memberRepo = dataSource.getRepository(EngineMember);
    const existing = await memberRepo.findOne({ where: { engineId, userId } });
    if (existing) {
      await memberRepo.delete({ engineId, userId });
      await syncLegacyEngineAssignments(engineId);
    }

    const assignments = await this.getDirectUserEngineMemberAssignments(dataSource, engineId, userId);
    await Promise.all(assignments.map((assignment) => permissionService.removeRoleAssignment(assignment.id, removedById)));

    if (!existing && assignments.length === 0) {
      throw new Error('Member not found');
    }
  }

  private async getDirectUserEngineMemberAssignments(dataSource: Awaited<ReturnType<typeof getDataSource>>, engineId: string, userId: string): Promise<RbacRoleAssignment[]> {
    return dataSource.getRepository(RbacRoleAssignment)
      .createQueryBuilder('assignment')
      .where('assignment.resourceType = :resourceType', { resourceType: 'engine' })
      .andWhere('assignment.resourceId = :engineId', { engineId })
      .andWhere('(assignment.principalType = :principalType OR assignment.principalType IS NULL)', { principalType: 'user' })
      .andWhere('(assignment.principalId = :userId OR assignment.userId = :userId)', { userId })
      .andWhere('assignment.source = :source', { source: 'manual' })
      .andWhere('assignment.roleId IN (:...roleIds)', { roleIds: ENGINE_STANDARD_MEMBER_SYSTEM_ROLE_IDS })
      .getMany();
  }

  private async syncManagedEngineGovernanceAssignments(
    dataSource: Awaited<ReturnType<typeof getDataSource>>,
    engine: Pick<Engine, 'id' | 'ownerId' | 'delegateId' | 'tenantId' | 'createdAt' | 'updatedAt'>
  ): Promise<void> {
    const now = Date.now();
    const assignmentRepo = dataSource.getRepository(RbacRoleAssignment);
    const sourceRefs = [
      engineGovernanceSourceRef(engine.id, 'owner'),
      engineGovernanceSourceRef(engine.id, 'delegate'),
    ];
    const existing = await assignmentRepo.find({
      where: {
        resourceType: 'engine',
        resourceId: engine.id,
        source: ENGINE_GOVERNANCE_SOURCE,
        sourceMappingId: In(sourceRefs),
      },
    });

    const desired = [
      {
        slot: 'owner' as const,
        userId: engine.ownerId,
        roleId: SYSTEM_ROLE_IDS.ENGINE_OWNER,
        sourceRef: engineGovernanceSourceRef(engine.id, 'owner'),
        createdAt: engine.createdAt || now,
      },
      {
        slot: 'delegate' as const,
        userId: engine.delegateId,
        roleId: SYSTEM_ROLE_IDS.ENGINE_DELEGATE,
        sourceRef: engineGovernanceSourceRef(engine.id, 'delegate'),
        createdAt: engine.updatedAt || engine.createdAt || now,
      },
    ];

    const desiredBySourceRef = new Map(desired.map((entry) => [entry.sourceRef, entry]));
    const staleAssignments = existing.filter((assignment) => {
      const entry = desiredBySourceRef.get(assignment.sourceMappingId || assignment.sourceRef || '');
      return !entry?.userId || assignment.userId !== entry.userId || assignment.roleId !== entry.roleId;
    });
    if (staleAssignments.length > 0) {
      await assignmentRepo.delete({ id: In(staleAssignments.map((assignment) => assignment.id)) });
    }

    for (const entry of desired) {
      if (!entry.userId) {
        continue;
      }

      const current = existing.find((assignment) =>
        !staleAssignments.some((stale) => stale.id === assignment.id) &&
        (assignment.sourceMappingId === entry.sourceRef || assignment.sourceRef === entry.sourceRef) &&
        assignment.userId === entry.userId &&
        assignment.roleId === entry.roleId
      );

      if (current) {
        await assignmentRepo.update({ id: current.id }, {
          tenantId: engine.tenantId ?? null,
          principalType: 'user',
          principalId: entry.userId,
          scopeType: 'engine',
          scopeId: engine.id,
          lastSeenAt: now,
          updatedAt: now,
        });
        continue;
      }

      await assignmentRepo.insert({
        id: `${ENGINE_GOVERNANCE_SOURCE}:engine:${engine.id}:${entry.slot}:${entry.userId}`,
        tenantId: engine.tenantId ?? null,
        userId: entry.userId,
        principalType: 'user',
        principalId: entry.userId,
        roleId: entry.roleId,
        resourceType: 'engine',
        resourceId: engine.id,
        scopeType: 'engine',
        scopeId: engine.id,
        source: ENGINE_GOVERNANCE_SOURCE,
        sourceMappingId: entry.sourceRef,
        sourceRef: entry.sourceRef,
        expiresAt: null,
        lastSeenAt: now,
        createdById: null,
        createdAt: Number(entry.createdAt || now),
        updatedAt: now,
      });
    }
  }

  /**
   * Set environment tag for an engine
   */
  async setEnvironmentTag(engineId: string, environmentTagId: string): Promise<void> {
    const dataSource = await getDataSource();
    const engineRepo = dataSource.getRepository(Engine);
    await engineRepo.update({ id: engineId }, { 
      environmentTagId, 
      updatedAt: Date.now() 
    });
  }

  /**
   * Lock/unlock environment for an engine
   */
  async setEnvironmentLocked(engineId: string, locked: boolean): Promise<void> {
    const dataSource = await getDataSource();
    const engineRepo = dataSource.getRepository(Engine);
    await engineRepo.update({ id: engineId }, { 
      environmentLocked: locked, 
      updatedAt: Date.now() 
    });
  }

  /**
   * Get all environment tags
   */
  async getEnvironmentTags(): Promise<EnvironmentTag[]> {
    const dataSource = await getDataSource();
    const tagRepo = dataSource.getRepository(EnvironmentTag);
    return tagRepo.find({ order: { sortOrder: 'ASC' } });
  }
}

// Export singleton instance
export const engineService = new EngineService();
