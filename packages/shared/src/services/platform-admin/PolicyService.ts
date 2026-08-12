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
import { AuditLog } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuditLog.js';
import { AuthzPolicy } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzPolicy.js';
import { AuthzAuditLog } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzAuditLog.js';
import { IsNull, type DataSource, type EntityManager } from 'typeorm';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { permissionService, Permission, PermissionContext } from './permissions.js';
import {
  adminConfigObjectOwnershipService,
  adminConfigOwnershipFields,
  type AdminConfigOwnershipFields,
} from './AdminConfigObjectOwnershipService.js';

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

export interface PolicyDefinition extends Partial<AdminConfigOwnershipFields> {
  id: string;
  tenantId: string | null;
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

export interface PolicyGateResult {
  decision: 'allow' | 'deny';
  reason: string;
  policyId?: string;
  policyName?: string;
}

export interface CreatePolicyInput {
  tenantId?: string | null;
  name: string;
  description?: string;
  effect: PolicyEffect;
  priority?: number;
  resourceType?: string;
  action?: string;
  conditions?: PolicyCondition;
  createdById: string;
}

export interface UpdatePolicyInput extends Partial<CreatePolicyInput & { isActive?: boolean }> {
  updatedById?: string | null;
}

// ============================================================================
// Policy Service
// ============================================================================

class PolicyServiceClass {
  private normalizeTenantId(tenantId?: string | null): string | null {
    const normalized = tenantId?.trim();
    return normalized || null;
  }

  private async logPolicyMutation(
    dataSource: DataSource | EntityManager,
    entry: {
      tenantId?: string | null;
      userId?: string | null;
      action: string;
      resourceId: string;
      details?: Record<string, unknown>;
    }
  ): Promise<void> {
    try {
      await dataSource.getRepository(AuditLog).insert({
        id: generateId(),
        tenantId: this.normalizeTenantId(entry.tenantId),
        userId: entry.userId || null,
        action: entry.action,
        resourceType: 'authz_policy',
        resourceId: entry.resourceId,
        ipAddress: null,
        userAgent: null,
        details: entry.details ? JSON.stringify(entry.details) : null,
        createdAt: Date.now(),
      });
    } catch (error) {
      logger.error('Failed to write authorization policy audit log:', error);
    }
  }

  private addTenantScopeFilter(qb: { andWhere: (...args: any[]) => any }, alias: string, tenantId?: string | null): void {
    const normalizedTenantId = this.normalizeTenantId(tenantId);
    if (!normalizedTenantId) return;
    qb.andWhere(`(${alias}.tenantId = :tenantId OR ${alias}.tenantId IS NULL)`, { tenantId: normalizedTenantId });
  }

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
    const policies = await this.getApplicablePolicies(action, resourceType, context.tenantId);

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
   * Evaluate policies as a contextual gate.
   *
   * Unlike evaluate(), this method never grants permission. It only answers
   * whether an explicit matching deny policy blocks an already-authorized action.
   */
  async evaluateGate(
    action: Permission,
    context: EvaluationContext
  ): Promise<PolicyGateResult> {
    const timestamp = context.timestamp || Date.now();
    const policies = await this.getApplicablePolicies(action, context.resourceType, context.tenantId);
    let matchedAllow: PolicyDefinition | null = null;

    for (const policy of policies) {
      if (!this.evaluateConditions(policy.conditions, context, timestamp)) {
        continue;
      }

      if (policy.effect === 'deny') {
        return {
          decision: 'deny',
          reason: `policy:${policy.name}`,
          policyId: policy.id,
          policyName: policy.name,
        };
      }

      if (policy.effect === 'allow' && !matchedAllow) {
        matchedAllow = policy;
      }
    }

    if (matchedAllow) {
      return {
        decision: 'allow',
        reason: `policy:${matchedAllow.name}`,
        policyId: matchedAllow.id,
        policyName: matchedAllow.name,
      };
    }

    return {
      decision: 'allow',
      reason: 'no-policy-deny',
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
    resourceType?: string,
    tenantId?: string | null
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
    this.addTenantScopeFilter(qb, 'p', tenantId);

    const policies = await qb.getMany();

    return policies.map((p) => ({
      id: p.id,
      tenantId: p.tenantId,
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
    const result = await permissionService.evaluatePermission(action, context);
    return result.reason;
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
      tenantId: this.normalizeTenantId(context.tenantId),
      userId: context.userId,
      action,
      resourceType: context.resourceType || null,
      resourceId: context.resourceId || null,
      decision: result.decision,
      reason: result.reason,
      policyId: result.policyId || null,
      context: JSON.stringify({
        tenantId: this.normalizeTenantId(context.tenantId),
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
      tenantId: this.normalizeTenantId(input.tenantId),
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
    await this.logPolicyMutation(dataSource, {
      tenantId: input.tenantId,
      userId: input.createdById,
      action: 'authz.policy.create',
      resourceId: id,
      details: {
        policyId: id,
        tenantId: this.normalizeTenantId(input.tenantId),
        name: input.name,
        effect: input.effect,
        priority: input.priority ?? 0,
        resourceType: input.resourceType || null,
        action: input.action || null,
      },
    });

    return { id };
  }

  async updatePolicy(id: string, updates: UpdatePolicyInput): Promise<void> {
    const dataSource = await getDataSource();
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
    if (updates.tenantId !== undefined) updateData.tenantId = this.normalizeTenantId(updates.tenantId);

    await dataSource.transaction(async (manager) => {
      const policyRepo = manager.getRepository(AuthzPolicy);
      const existing = await policyRepo.findOneBy({ id });
      if (!existing) throw Errors.notFound('Authorization policy');
      await adminConfigObjectOwnershipService.claimManualMutation(manager, 'authorization_policy', id);
      await policyRepo.update({ id }, updateData);
      await this.logPolicyMutation(manager, {
        tenantId: updates.tenantId ?? existing.tenantId,
        userId: updates.updatedById || null,
        action: 'authz.policy.update',
        resourceId: id,
        details: {
          policyId: id,
          tenantId: updates.tenantId !== undefined ? this.normalizeTenantId(updates.tenantId) : existing.tenantId,
          updatedFields: Object.keys(updateData).filter((field) => field !== 'updatedAt'),
          name: updates.name,
          effect: updates.effect,
          priority: updates.priority,
          resourceType: updates.resourceType,
          action: updates.action,
          isActive: updates.isActive,
        },
      });
    });
  }

  async deletePolicy(id: string, deletedById?: string | null): Promise<void> {
    const dataSource = await getDataSource();
    await dataSource.transaction(async (manager) => {
      const policyRepo = manager.getRepository(AuthzPolicy);
      const policy = await policyRepo.findOne({ where: { id } });
      if (!policy) throw Errors.notFound('Authorization policy');
      await adminConfigObjectOwnershipService.claimManualMutation(manager, 'authorization_policy', id);
      await policyRepo.delete({ id });
      await this.logPolicyMutation(manager, {
        tenantId: policy.tenantId,
        userId: deletedById || null,
        action: 'authz.policy.delete',
        resourceId: id,
        details: {
          policyId: id,
          tenantId: policy.tenantId,
          name: policy.name,
          effect: policy.effect,
          resourceType: policy.resourceType,
          action: policy.action,
        },
      });
    });
  }

  async getAllPolicies(tenantId?: string | null): Promise<PolicyDefinition[]> {
    const dataSource = await getDataSource();
    const policyRepo = dataSource.getRepository(AuthzPolicy);
    const normalizedTenantId = this.normalizeTenantId(tenantId);
    const [policies, ownershipRows] = await Promise.all([
      policyRepo.find({
        where: normalizedTenantId ? [{ tenantId: normalizedTenantId }, { tenantId: IsNull() }] : undefined,
        order: { priority: 'DESC' },
      }),
      adminConfigObjectOwnershipService.listForObjectType(dataSource, 'authorization_policy'),
    ]);
    const ownershipById = new Map(ownershipRows.map((row) => [row.objectId, row]));

    return policies.map((p) => ({
      id: p.id,
      tenantId: p.tenantId,
      name: p.name,
      description: p.description || undefined,
      effect: p.effect as PolicyEffect,
      priority: p.priority,
      resourceType: p.resourceType || undefined,
      action: p.action || undefined,
      conditions: this.parseConditions(p.conditions),
      isActive: p.isActive,
      ...adminConfigOwnershipFields(ownershipById.get(p.id)),
    }));
  }

  async getPolicy(id: string): Promise<PolicyDefinition | null> {
    const dataSource = await getDataSource();
    const policyRepo = dataSource.getRepository(AuthzPolicy);
    const p = await policyRepo.findOneBy({ id });

    if (!p) return null;

    const ownership = await adminConfigObjectOwnershipService.findForObject(dataSource, 'authorization_policy', p.id);
    return {
      id: p.id,
      tenantId: p.tenantId,
      name: p.name,
      description: p.description || undefined,
      effect: p.effect as PolicyEffect,
      priority: p.priority,
      resourceType: p.resourceType || undefined,
      action: p.action || undefined,
      conditions: this.parseConditions(p.conditions),
      isActive: p.isActive,
      ...adminConfigOwnershipFields(ownership),
    };
  }

  // ============================================================================
  // Audit Log Queries
  // ============================================================================

  async getAuditLog(options: {
    tenantId?: string | null;
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

    this.addTenantScopeFilter(qb, 'a', options.tenantId);
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
