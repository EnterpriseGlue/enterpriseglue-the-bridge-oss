/**
 * Engine Service
 * Handles engine ownership, membership, and environment tagging
 * 
 * Engines are stored in the database
 */

import { getDataSource } from '@shared/db/data-source.js';
import { Engine } from '@shared/db/entities/Engine.js';
import { EngineMember } from '@shared/db/entities/EngineMember.js';
import { EnvironmentTag } from '@shared/db/entities/EnvironmentTag.js';
import { User } from '@shared/db/entities/User.js';
import { In, IsNull } from 'typeorm';
import { generateId } from '@shared/utils/id.js';
import type { EngineRole } from '@shared/constants/roles.js';

export interface EngineWithDetails {
  engine: Engine;
  role: EngineRole;
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

export class EngineService {
  /**
   * Get user's role on an engine
   */
  async getEngineRole(userId: string, engineId: string): Promise<EngineRole | null> {
    const dataSource = await getDataSource();
    const engineRepo = dataSource.getRepository(Engine);
    const memberRepo = dataSource.getRepository(EngineMember);
    
    // Get engine to check owner/delegate
    const engine = await engineRepo.findOne({ where: { id: engineId } });

    if (!engine) return null;
    
    // Check if owner or delegate
    if (engine.ownerId === userId) return 'owner';
    if (engine.delegateId === userId) return 'delegate';
    
    // Check engine_members table
    const membership = await memberRepo.findOne({
      where: { engineId, userId }
    });
    
    return (membership?.role as EngineRole) || null;
  }

  /**
   * Check if user has access to engine with at least the required role
   */
  async hasEngineAccess(userId: string, engineId: string, requiredRoles: EngineRole[]): Promise<boolean> {
    const role = await this.getEngineRole(userId, engineId);
    if (!role) return false;
    return requiredRoles.includes(role);
  }

  /**
   * Get all engines a user has access to, optionally filtered by tenant
   */
  async getUserEngines(userId: string, tenantId?: string): Promise<EngineWithDetails[]> {
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

    // Collect all user IDs (owner, delegate, and members)
    const userIds = new Set<string>();
    if (engine.ownerId) userIds.add(engine.ownerId);
    if (engine.delegateId) userIds.add(engine.delegateId);
    members.forEach(m => userIds.add(m.userId));

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

    return result;
  }

  /**
   * Assign a delegate to an engine (owner only)
   */
  async assignDelegate(engineId: string, delegateId: string | null): Promise<void> {
    const dataSource = await getDataSource();
    const engineRepo = dataSource.getRepository(Engine);
    await engineRepo.update({ id: engineId }, { delegateId, updatedAt: Date.now() });
  }

  /**
   * Transfer engine ownership (owner only)
   */
  async transferOwnership(engineId: string, newOwnerId: string): Promise<void> {
    const dataSource = await getDataSource();
    const engineRepo = dataSource.getRepository(Engine);
    await engineRepo.update({ id: engineId }, { 
      ownerId: newOwnerId, 
      delegateId: null,
      updatedAt: Date.now() 
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
    const dataSource = await getDataSource();
    const memberRepo = dataSource.getRepository(EngineMember);
    const id = generateId();
    const now = Date.now();

    await memberRepo.insert({
      id,
      engineId,
      userId,
      role,
      grantedById,
      createdAt: now,
    });

    return { id };
  }

  /**
   * Update a member's role
   */
  async updateEngineMemberRole(
    engineId: string,
    userId: string,
    newRole: 'operator' | 'deployer'
  ): Promise<void> {
    const dataSource = await getDataSource();
    const memberRepo = dataSource.getRepository(EngineMember);
    
    const existing = await memberRepo.findOne({ where: { engineId, userId } });

    if (!existing) {
      throw new Error('Member not found');
    }

    await memberRepo.delete({ engineId, userId });

    await memberRepo.insert({
      id: generateId(),
      engineId,
      userId,
      role: newRole,
      grantedById: existing.grantedById,
      createdAt: Date.now(),
    });
  }

  /**
   * Remove a member from an engine
   */
  async removeEngineMember(engineId: string, userId: string): Promise<void> {
    const dataSource = await getDataSource();
    const memberRepo = dataSource.getRepository(EngineMember);
    await memberRepo.delete({ engineId, userId });
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
