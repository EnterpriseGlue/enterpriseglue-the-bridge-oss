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
import { canonicalRoleAssignmentKey } from '@enterpriseglue/shared/authz/role-assignment-identity.js';
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
  source?: string;
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

const ENGINE_ACCESS_ROLE_PRECEDENCE = ['owner', 'delegate', 'operator', 'deployer'] as const;

const ENGINE_MEMBER_ROLE_TO_SYSTEM_ROLE_ID: Record<'operator' | 'deployer', string> = {
  operator: SYSTEM_ROLE_IDS.ENGINE_OPERATOR,
  deployer: SYSTEM_ROLE_IDS.ENGINE_DEPLOYER,
};

const ENGINE_GOVERNANCE_SOURCE = 'system';

function engineGovernanceSourceRef(engineId: string, slot: 'owner' | 'delegate'): string {
  return `engine:${engineId}:governance-${slot}`;
}

export class EngineService {
  /**
   * Get user's role on an engine
   */
  async getEngineRole(userId: string, engineId: string, tenantId?: string | null): Promise<EngineRole | null> {
    const dataSource = await getDataSource();
    const engineRepo = dataSource.getRepository(Engine);
    const engine = await engineRepo.findOne({ where: { id: engineId }, select: ['id', 'tenantId'] });

    if (!engine) return null;
    if (tenantId && engine.tenantId && engine.tenantId !== tenantId) return null;

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
    const tagRepo = dataSource.getRepository(EnvironmentTag);
    const results: EngineWithDetails[] = [];
    const tagIds = new Set<string>();

    // Canonical role assignments are the sole source of engine discovery.
    const assignedEngineRoles = await permissionService.getAssignedEngineRoles(userId, tenantId);
    const assignmentQb = dataSource.getRepository(RbacRoleAssignment)
      .createQueryBuilder('assignment')
      .innerJoin(RbacRole, 'role', 'role.id = assignment.roleId')
      .innerJoin(RbacRolePermission, 'rolePermission', 'rolePermission.roleId = assignment.roleId')
      .where('assignment.principalType = :principalType', { principalType: 'user' })
      .andWhere('assignment.principalId = :principalId', { principalId: userId })
      .andWhere('assignment.scopeType = :scopeType', { scopeType: 'engine' })
      .andWhere('role.isArchived = :isArchived', { isArchived: false })
      .andWhere('rolePermission.permissionId IN (:...permissions)', { permissions: Object.values(EnginePermissions) });
    if (tenantId) {
      assignmentQb
        .andWhere('(assignment.tenantId = :tenantId OR assignment.tenantId IS NULL)', { tenantId })
        .andWhere('(role.tenantId = :tenantId OR role.tenantId IS NULL)', { tenantId });
    }
    const assignmentRows = await assignmentQb.getMany();
    const allEngineRole = assignedEngineRoles.find((assignment) => assignment.engineId === null)?.role || null;
    const hasAllEngineAssignment = assignmentRows.some((assignment) => assignment.scopeId === null);
    const assignedEngineIds = Array.from(new Set([
      ...assignedEngineRoles.map((assignment) => assignment.engineId),
      ...assignmentRows.map((assignment) => assignment.scopeId),
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
   * Get effective direct user assignments for an engine. Accountable owner and
   * delegate columns remain governance metadata and are not an access source.
   */
  async getEngineMembers(engineId: string): Promise<EngineMemberWithUser[]> {
    const dataSource = await getDataSource();
    const engineRepo = dataSource.getRepository(Engine);
    const userRepo = dataSource.getRepository(User);

    const engine = await engineRepo.findOne({ where: { id: engineId } });

    if (!engine) {
      return [];
    }

    const assignmentMembers = await dataSource.getRepository(RbacRoleAssignment)
      .createQueryBuilder('assignment')
      .where('assignment.scopeType = :scopeType', { scopeType: 'engine' })
      .andWhere('(assignment.scopeId = :engineId OR assignment.scopeId IS NULL)', { engineId })
      .andWhere('assignment.principalType = :principalType', { principalType: 'user' })
      .andWhere('assignment.roleId IN (:...roleIds)', { roleIds: ENGINE_ACCESS_DISPLAY_SYSTEM_ROLE_IDS })
      .andWhere('(assignment.expiresAt IS NULL OR assignment.expiresAt > :now)', { now: Date.now() })
      .getMany();

    const userIds = new Set<string>();
    assignmentMembers.forEach((assignment) => {
      if (assignment.principalId) userIds.add(assignment.principalId);
    });

    // Get user details
    let userMap = new Map<string, { id: string; email: string; firstName: string | null; lastName: string | null }>();
    if (userIds.size > 0) {
      const userList = await userRepo.find({
        where: { id: In(Array.from(userIds)) },
        select: ['id', 'email', 'firstName', 'lastName']
      });

      userMap = new Map(userList.map(u => [u.id, u]));
    }

    const resultByUserId = new Map<string, EngineMemberWithUser>();
    for (const assignment of assignmentMembers) {
      if (!assignment.principalId) continue;
      const role = ENGINE_SYSTEM_ROLE_TO_LEGACY_ROLE[assignment.roleId];
      if (!role) continue;
      const existing = resultByUserId.get(assignment.principalId);
      if (existing && ENGINE_ACCESS_ROLE_PRECEDENCE.indexOf(existing.role as typeof ENGINE_ACCESS_ROLE_PRECEDENCE[number]) <= ENGINE_ACCESS_ROLE_PRECEDENCE.indexOf(role)) {
        continue;
      }
      resultByUserId.set(assignment.principalId, {
        id: assignment.id,
        engineId,
        userId: assignment.principalId,
        role,
        grantedById: assignment.createdById,
        createdAt: assignment.createdAt,
        source: assignment.source,
        user: userMap.get(assignment.principalId) || null,
      });
    }

    return Array.from(resultByUserId.values()).sort((left, right) => {
      const roleOrder = ENGINE_ACCESS_ROLE_PRECEDENCE.indexOf(left.role as typeof ENGINE_ACCESS_ROLE_PRECEDENCE[number]) - ENGINE_ACCESS_ROLE_PRECEDENCE.indexOf(right.role as typeof ENGINE_ACCESS_ROLE_PRECEDENCE[number]);
      return roleOrder || left.createdAt - right.createdAt || left.userId.localeCompare(right.userId);
    });
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
      await this.writeLegacyEngineMemberAssignment(dataSource, {
        engineId,
        userId,
        role: newRole,
        grantedById: existing.grantedById,
        createdAt: existing.createdAt,
      });
      if (existing.role !== newRole) {
        await this.removeLegacyEngineMemberAssignments(dataSource, engineId, userId, [existing.role as 'operator' | 'deployer']);
      }
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
      await this.removeLegacyEngineMemberAssignments(dataSource, engineId, userId);
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
      .where('assignment.scopeType = :scopeType', { scopeType: 'engine' })
      .andWhere('assignment.scopeId = :engineId', { engineId })
      .andWhere('assignment.principalType = :principalType', { principalType: 'user' })
      .andWhere('assignment.principalId = :userId', { userId })
      .andWhere('assignment.source = :source', { source: 'manual' })
      .andWhere('assignment.roleId IN (:...roleIds)', { roleIds: ENGINE_STANDARD_MEMBER_SYSTEM_ROLE_IDS })
      .getMany();
  }

  private async writeLegacyEngineMemberAssignment(
    dataSource: Awaited<ReturnType<typeof getDataSource>>,
    input: { engineId: string; userId: string; role: 'operator' | 'deployer'; grantedById: string | null; createdAt: number },
  ): Promise<void> {
    const engine = await dataSource.getRepository(Engine).findOne({
      where: { id: input.engineId },
      select: ['id', 'tenantId'],
    });
    if (!engine) {
      throw new Error('Engine not found');
    }
    const roleId = ENGINE_MEMBER_ROLE_TO_SYSTEM_ROLE_ID[input.role];
    const sourceRef = `engine_member:${input.engineId}:${input.userId}:${input.role}`;
    const now = Date.now();
    await dataSource.getRepository(RbacRoleAssignment).upsert({
      id: `legacy:engine:${input.engineId}:${input.userId}:${roleId}`,
      tenantId: engine.tenantId ?? null,
      userId: input.userId,
      principalType: 'user',
      principalId: input.userId,
      assignmentKey: canonicalRoleAssignmentKey({
        tenantId: engine.tenantId ?? null,
        principalType: 'user',
        principalId: input.userId,
        roleId,
        scopeType: 'engine',
        scopeId: input.engineId,
        source: 'legacy',
        sourceRef,
      }),
      roleId,
      resourceType: 'engine',
      resourceId: input.engineId,
      scopeType: 'engine',
      scopeId: input.engineId,
      source: 'legacy',
      sourceMappingId: sourceRef,
      sourceRef,
      expiresAt: null,
      lastSeenAt: now,
      createdById: input.grantedById,
      createdAt: input.createdAt || now,
      updatedAt: now,
    }, {
      conflictPaths: ['id'],
      skipUpdateIfNoValuesChanged: true,
    });
  }

  private async removeLegacyEngineMemberAssignments(
    dataSource: Awaited<ReturnType<typeof getDataSource>>,
    engineId: string,
    userId: string,
    roles: Array<'operator' | 'deployer'> = ['operator', 'deployer'],
  ): Promise<void> {
    await dataSource.getRepository(RbacRoleAssignment).delete({
      id: In(roles.map((role) => `legacy:engine:${engineId}:${userId}:${ENGINE_MEMBER_ROLE_TO_SYSTEM_ROLE_ID[role]}`)),
    });
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
        scopeType: 'engine',
        scopeId: engine.id,
        source: ENGINE_GOVERNANCE_SOURCE,
        sourceRef: In(sourceRefs),
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
      const entry = desiredBySourceRef.get(assignment.sourceRef || '');
      return !entry?.userId || assignment.principalId !== entry.userId || assignment.roleId !== entry.roleId;
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
        assignment.sourceRef === entry.sourceRef &&
        assignment.principalId === entry.userId &&
        assignment.roleId === entry.roleId
      );

      if (current) {
        await assignmentRepo.update({ id: current.id }, {
          tenantId: engine.tenantId ?? null,
        principalType: 'user',
        principalId: entry.userId,
        assignmentKey: canonicalRoleAssignmentKey({
          tenantId: engine.tenantId ?? null,
          principalType: 'user',
          principalId: entry.userId,
          roleId: entry.roleId,
          scopeType: 'engine',
          scopeId: engine.id,
          source: ENGINE_GOVERNANCE_SOURCE,
          sourceRef: entry.sourceRef,
        }),
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
        userId: null,
        principalType: 'user',
        principalId: entry.userId,
        assignmentKey: canonicalRoleAssignmentKey({
          tenantId: engine.tenantId ?? null,
          principalType: 'user',
          principalId: entry.userId,
          roleId: entry.roleId,
          scopeType: 'engine',
          scopeId: engine.id,
          source: ENGINE_GOVERNANCE_SOURCE,
          sourceRef: entry.sourceRef,
        }),
        roleId: entry.roleId,
        resourceType: null,
        resourceId: null,
        scopeType: 'engine',
        scopeId: engine.id,
        source: ENGINE_GOVERNANCE_SOURCE,
        sourceMappingId: null,
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
