/**
 * Policy Service - ABAC Policy Evaluation Engine
 * 
 * Evaluates authorization policies with conditions.
 * Supports allow/deny policies with priority ordering.
 * 
 * Evaluation order:
 * 1. High-priority deny policies (explicit deny)
 * 2. High-priority allow policies
 * 3. Lower priority policies
 * 4. Default: deny (implicit)
 */

import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { AuthzPolicy } from '@enterpriseglue/shared/db/entities/AuthzPolicy.js';
import { AuthzAuditLog } from '@enterpriseglue/shared/db/entities/AuthzAuditLog.js';
import { IsNull } from 'typeorm';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { permissionService, Permission, PermissionContext } from './permissions.js';

// ============================================================================
// Types
// ============================================================================

export type PolicyEffect = 'allow' | 'deny';

export interface PolicyCondition {
  // Time-based conditions
  timeWindow?: {
    start?: string; // HH:MM format
    end?: string;
    timezone?: string;
    daysOfWeek?: number[]; // 0=Sunday, 1=Monday, etc.
  };
  
  // User attribute conditions
  userAttribute?: {
    key: string; // e.g., 'department', 'location'
    operator: 'eq' | 'neq' | 'in' | 'notIn' | 'contains';
    value: string | string[];
  };
  
  // Resource attribute conditions
  resourceAttribute?: {
    key: string; // e.g., 'isProduction', 'owner'
    operator: 'eq' | 'neq' | 'in' | 'notIn';
    value: string | string[] | boolean;
  };
  
  // Environment conditions
  environment?: {
    ipRange?: string[]; // CIDR notation
    requireMfa?: boolean;
  };
}

export interface PolicyDefinition {
  id: string;
  name: string;
  description?: string;
  effect: PolicyEffect;
  priority: number;
  resourceType?: string;
  action?: string;
  conditions: PolicyCondition;
  isActive: boolean;
}

export interface EvaluationContext extends PermissionContext {
  // Additional context for policy evaluation
  ipAddress?: string;
  userAgent?: string;
  timestamp?: number;
  userAttributes?: Record<string, any>;
  resourceAttributes?: Record<string, any>;
}

export interface EvaluationResult {
  decision: 'allow' | 'deny';
  reason: string;
  policyId?: string;
  policyName?: string;
}

export interface CreatePolicyInput {
  name: string;
  description?: string;
  effect: PolicyEffect;
  priority?: number;
  resourceType?: string;
  action?: string;
  conditions?: PolicyCondition;
  createdById: string;
}

// ============================================================================
// Policy Service
// ============================================================================

class PolicyServiceClass {
  /**
   * Evaluate all applicable policies for an authorization request.
   * 
   * Returns the decision and the reason (which policy or grant allowed/denied).
   */
  async evaluate(
    action: Permission,
    context: EvaluationContext
  ): Promise<EvaluationResult> {
    const { userId, resourceType, resourceId } = context;
    const timestamp = context.timestamp || Date.now();

    // First, check role-based and grant-based permissions (Phase 2)
    const hasBasePermission = await permissionService.hasPermission(action, context);

    // Get applicable policies, ordered by priority (highest first)
    const policies = await this.getApplicablePolicies(action, resourceType);

    // Evaluate policies in priority order
    // Deny policies at same priority level take precedence over allow
    for (const policy of policies) {
      const conditionsMet = this.evaluateConditions(policy.conditions, context, timestamp);

      if (conditionsMet) {
        if (policy.effect === 'deny') {
          // Explicit deny - regardless of base permission
          return {
            decision: 'deny',
            reason: `policy:${policy.name}`,
            policyId: policy.id,
            policyName: policy.name,
          };
        }
        
        if (policy.effect === 'allow' && !hasBasePermission) {
          // Policy grants permission that user doesn't have via role/grant
          return {
            decision: 'allow',
            reason: `policy:${policy.name}`,
            policyId: policy.id,
            policyName: policy.name,
          };
        }
      }
    }

    // No policy override - use base permission result
    if (hasBasePermission) {
      return {
        decision: 'allow',
        reason: await this.getBasePermissionReason(action, context),
      };
    }

    return {
      decision: 'deny',
      reason: 'no-permission',
    };
  }

  /**
   * Evaluate and log the decision (for audit trail)
   */
  async evaluateAndLog(
    action: Permission,
    context: EvaluationContext
  ): Promise<EvaluationResult> {
    const result = await this.evaluate(action, context);

    // Log to audit trail
    await this.logDecision(action, context, result);

    return result;
  }

  /**
   * Get applicable policies for an action and resource type
   */
  private async getApplicablePolicies(
    action: Permission,
    resourceType?: string
  ): Promise<PolicyDefinition[]> {
    const dataSource = await getDataSource();
    const policyRepo = dataSource.getRepository(AuthzPolicy);

    const qb = policyRepo.createQueryBuilder('p')
      .where('p.isActive = :isActive', { isActive: true })
      .andWhere('(p.action IS NULL OR p.action = :action)', { action })
      .andWhere(resourceType 
        ? '(p.resourceType IS NULL OR p.resourceType = :resourceType)' 
        : 'p.resourceType IS NULL', 
        resourceType ? { resourceType } : {}
      )
      .orderBy('p.priority', 'DESC');

    const policies = await qb.getMany();

    return policies.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description || undefined,
      effect: p.effect as PolicyEffect,
      priority: p.priority,
      resourceType: p.resourceType || undefined,
      action: p.action || undefined,
      conditions: this.parseConditions(p.conditions),
      isActive: p.isActive,
    }));
  }

  /**
   * Parse conditions JSON from database
   */
  private parseConditions(conditionsJson: string): PolicyCondition {
    try {
      return JSON.parse(conditionsJson) as PolicyCondition;
    } catch {
      return {};
    }
  }

  /**
   * Evaluate all conditions in a policy
   */
  private evaluateConditions(
    conditions: PolicyCondition,
    context: EvaluationContext,
    timestamp: number
  ): boolean {
    // Empty conditions = always matches
    if (!conditions || Object.keys(conditions).length === 0) {
      return true;
    }

    // All conditions must be met (AND logic)
    if (conditions.timeWindow && !this.evaluateTimeCondition(conditions.timeWindow, timestamp)) {
      return false;
    }

    if (conditions.userAttribute && !this.evaluateUserAttribute(conditions.userAttribute, context)) {
      return false;
    }

    if (conditions.resourceAttribute && !this.evaluateResourceAttribute(conditions.resourceAttribute, context)) {
      return false;
    }

    if (conditions.environment && !this.evaluateEnvironment(conditions.environment, context)) {
      return false;
    }

    return true;
  }

  /**
   * Evaluate time window condition
   */
  private evaluateTimeCondition(
    condition: NonNullable<PolicyCondition['timeWindow']>,
    timestamp: number
  ): boolean {
    const date = new Date(timestamp);
    const tz = condition.timezone || 'UTC';

    // Get local time in specified timezone
    const localTime = date.toLocaleString('en-US', { timeZone: tz, hour12: false });
    const [datePart, timePart] = localTime.split(', ');
    const [hours, minutes] = timePart.split(':').map(Number);
    const currentMinutes = hours * 60 + minutes;
    const dayOfWeek = date.getDay();

    // Check day of week
    if (condition.daysOfWeek && condition.daysOfWeek.length > 0) {
      if (!condition.daysOfWeek.includes(dayOfWeek)) {
        return false;
      }
    }

    // Check time window
    if (condition.start && condition.end) {
      const [startH, startM] = condition.start.split(':').map(Number);
      const [endH, endM] = condition.end.split(':').map(Number);
      const startMinutes = startH * 60 + startM;
      const endMinutes = endH * 60 + endM;

      if (startMinutes <= endMinutes) {
        // Normal window (e.g., 09:00 - 17:00)
        if (currentMinutes < startMinutes || currentMinutes > endMinutes) {
          return false;
        }
      } else {
        // Overnight window (e.g., 22:00 - 06:00)
        if (currentMinutes < startMinutes && currentMinutes > endMinutes) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Evaluate user attribute condition
   */
  private evaluateUserAttribute(
    condition: NonNullable<PolicyCondition['userAttribute']>,
    context: EvaluationContext
  ): boolean {
    const userValue = context.userAttributes?.[condition.key];
    if (userValue === undefined) return false;

    return this.compareValues(userValue, condition.operator, condition.value);
  }

  /**
   * Evaluate resource attribute condition
   */
  private evaluateResourceAttribute(
    condition: NonNullable<PolicyCondition['resourceAttribute']>,
    context: EvaluationContext
  ): boolean {
    const resourceValue = context.resourceAttributes?.[condition.key];
    if (resourceValue === undefined) return false;

    return this.compareValues(resourceValue, condition.operator, condition.value);
  }

  /**
   * Evaluate environment condition
   */
  private evaluateEnvironment(
    condition: NonNullable<PolicyCondition['environment']>,
    context: EvaluationContext
  ): boolean {
    // IP range check (simplified - would need proper CIDR matching in production)
    if (condition.ipRange && condition.ipRange.length > 0 && context.ipAddress) {
      const ipInRange = condition.ipRange.some(range => {
        // Simple prefix match for now
        if (range.endsWith('*')) {
          return context.ipAddress!.startsWith(range.slice(0, -1));
        }
        return context.ipAddress === range;
      });
      if (!ipInRange) return false;
    }

    // MFA check would require additional context
    // if (condition.requireMfa && !context.mfaVerified) return false;

    return true;
  }

  /**
   * Compare values with operator
   */
  private compareValues(
    actual: any,
    operator: string,
    expected: string | string[] | boolean
  ): boolean {
    switch (operator) {
      case 'eq':
        return actual === expected;
      case 'neq':
        return actual !== expected;
      case 'in':
        return Array.isArray(expected) && expected.includes(actual);
      case 'notIn':
        return Array.isArray(expected) && !expected.includes(actual);
      case 'contains':
        return typeof actual === 'string' && actual.includes(String(expected));
      default:
        return false;
    }
  }

  /**
   * Get reason string for base permission (role or grant)
   */
  private async getBasePermissionReason(
    action: Permission,
    context: PermissionContext
  ): Promise<string> {
    const { platformRole, projectRole, engineRole } = context;

    // Check which role grants the permission
    if (platformRole === 'admin') return 'role:platform:admin';
    if (permissionService.roleHasPermission(action, { platformRole })) return `role:platform:${platformRole}`;
    if (permissionService.roleHasPermission(action, { projectRole })) return `role:project:${projectRole}`;
    if (permissionService.roleHasPermission(action, { engineRole })) return `role:engine:${engineRole}`;

    // Must be an explicit grant
    return 'grant:explicit';
  }

  /**
   * Log authorization decision to audit trail
   */
  private async logDecision(
    action: Permission,
    context: EvaluationContext,
    result: EvaluationResult
  ): Promise<void> {
    const dataSource = await getDataSource();
    const auditRepo = dataSource.getRepository(AuthzAuditLog);
    const now = Date.now();

    await auditRepo.insert({
      id: generateId(),
      userId: context.userId,
      action,
      resourceType: context.resourceType || null,
      resourceId: context.resourceId || null,
      decision: result.decision,
      reason: result.reason,
      policyId: result.policyId || null,
      context: JSON.stringify({
        platformRole: context.platformRole,
        projectRole: context.projectRole,
        engineRole: context.engineRole,
        userAttributes: context.userAttributes,
        resourceAttributes: context.resourceAttributes,
      }),
      ipAddress: context.ipAddress || null,
      userAgent: context.userAgent || null,
      timestamp: now,
    });
  }

  // ============================================================================
  // Policy CRUD Operations
  // ============================================================================

  async createPolicy(input: CreatePolicyInput): Promise<{ id: string }> {
    const dataSource = await getDataSource();
    const policyRepo = dataSource.getRepository(AuthzPolicy);
    const id = generateId();
    const now = Date.now();

    await policyRepo.insert({
      id,
      name: input.name,
      description: input.description || null,
      effect: input.effect,
      priority: input.priority ?? 0,
      resourceType: input.resourceType || null,
      action: input.action || null,
      conditions: JSON.stringify(input.conditions || {}),
      isActive: true,
      createdAt: now,
      updatedAt: now,
      createdById: input.createdById,
    });

    return { id };
  }

  async updatePolicy(
    id: string,
    updates: Partial<CreatePolicyInput & { isActive?: boolean }>
  ): Promise<void> {
    const dataSource = await getDataSource();
    const policyRepo = dataSource.getRepository(AuthzPolicy);
    const now = Date.now();

    const updateData: any = { updatedAt: now };
    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.description !== undefined) updateData.description = updates.description || null;
    if (updates.effect !== undefined) updateData.effect = updates.effect;
    if (updates.priority !== undefined) updateData.priority = updates.priority;
    if (updates.resourceType !== undefined) updateData.resourceType = updates.resourceType || null;
    if (updates.action !== undefined) updateData.action = updates.action || null;
    if (updates.conditions !== undefined) updateData.conditions = JSON.stringify(updates.conditions);
    if (updates.isActive !== undefined) updateData.isActive = updates.isActive;

    await policyRepo.update({ id }, updateData);
  }

  async deletePolicy(id: string): Promise<void> {
    const dataSource = await getDataSource();
    const policyRepo = dataSource.getRepository(AuthzPolicy);
    await policyRepo.delete({ id });
  }

  async getAllPolicies(): Promise<PolicyDefinition[]> {
    const dataSource = await getDataSource();
    const policyRepo = dataSource.getRepository(AuthzPolicy);
    const policies = await policyRepo.find({ order: { priority: 'DESC' } });

    return policies.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description || undefined,
      effect: p.effect as PolicyEffect,
      priority: p.priority,
      resourceType: p.resourceType || undefined,
      action: p.action || undefined,
      conditions: this.parseConditions(p.conditions),
      isActive: p.isActive,
    }));
  }

  async getPolicy(id: string): Promise<PolicyDefinition | null> {
    const dataSource = await getDataSource();
    const policyRepo = dataSource.getRepository(AuthzPolicy);
    const p = await policyRepo.findOneBy({ id });

    if (!p) return null;

    return {
      id: p.id,
      name: p.name,
      description: p.description || undefined,
      effect: p.effect as PolicyEffect,
      priority: p.priority,
      resourceType: p.resourceType || undefined,
      action: p.action || undefined,
      conditions: this.parseConditions(p.conditions),
      isActive: p.isActive,
    };
  }

  // ============================================================================
  // Audit Log Queries
  // ============================================================================

  async getAuditLog(options: {
    userId?: string;
    resourceType?: string;
    resourceId?: string;
    decision?: 'allow' | 'deny';
    limit?: number;
    offset?: number;
  }): Promise<AuthzAuditLog[]> {
    const dataSource = await getDataSource();
    const auditRepo = dataSource.getRepository(AuthzAuditLog);

    const qb = auditRepo.createQueryBuilder('a');

    if (options.userId) qb.andWhere('a.userId = :userId', { userId: options.userId });
    if (options.resourceType) qb.andWhere('a.resourceType = :resourceType', { resourceType: options.resourceType });
    if (options.resourceId) qb.andWhere('a.resourceId = :resourceId', { resourceId: options.resourceId });
    if (options.decision) qb.andWhere('a.decision = :decision', { decision: options.decision });

    return qb
      .orderBy('a.timestamp', 'DESC')
      .take(options.limit || 100)
      .skip(options.offset || 0)
      .getMany();
  }
}

export const policyService = new PolicyServiceClass();
