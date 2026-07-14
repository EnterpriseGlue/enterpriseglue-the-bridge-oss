import { Entity, Column, Index, Unique } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'role_assignments', schema: 'main' })
@Unique('uq_role_assignments_canonical_identity', ['assignmentKey'])
@Index('idx_role_assignments_tenant', ['tenantId'])
@Index('idx_role_assignments_user', ['userId'])
@Index('idx_role_assignments_principal', ['principalType', 'principalId'])
@Index('idx_role_assignments_resource', ['resourceType', 'resourceId'])
@Index('idx_role_assignments_scope', ['scopeType', 'scopeId'])
@Index('idx_role_assignments_source', ['source', 'sourceMappingId'])
export class RbacRoleAssignment extends AppBaseEntity {
  @Column({ name: 'tenant_id', type: 'text', nullable: true })
  tenantId!: string | null;

  /** Deprecated compatibility alias. Canonical assignments leave this null. */
  @Column({ name: 'user_id', type: 'text', nullable: true })
  userId!: string | null;

  @Column({ name: 'principal_type', type: 'text' })
  principalType!: string;

  @Column({ name: 'principal_id', type: 'text' })
  principalId!: string;

  /** Canonical tenant/principal/role/scope/source identity for uniqueness. */
  @Column({ name: 'assignment_key', type: 'text' })
  assignmentKey!: string;

  @Column({ name: 'role_id', type: 'text' })
  roleId!: string;

  /** Deprecated compatibility alias. Canonical assignments leave this null. */
  @Column({ name: 'resource_type', type: 'text', nullable: true })
  resourceType!: string | null;

  /** Deprecated compatibility alias. Canonical assignments leave this null. */
  @Column({ name: 'resource_id', type: 'text', nullable: true })
  resourceId!: string | null;

  @Column({ name: 'scope_type', type: 'text' })
  scopeType!: string;

  @Column({ name: 'scope_id', type: 'text', nullable: true })
  scopeId!: string | null;

  @Column({ type: 'text' })
  source!: string;

  /** Deprecated compatibility alias. Canonical assignments use sourceRef. */
  @Column({ name: 'source_mapping_id', type: 'text', nullable: true })
  sourceMappingId!: string | null;

  @Column({ name: 'source_ref', type: 'text', nullable: true })
  sourceRef!: string | null;

  @Column({ name: 'ownership_mode', type: 'text', default: 'manual' }) ownershipMode!: string;
  @Column({ name: 'source_hash', type: 'text', nullable: true }) sourceHash!: string | null;
  @Column({ name: 'last_applied_at', type: 'bigint', nullable: true }) lastAppliedAt!: number | null;
  @Column({ name: 'drift_status', type: 'text', nullable: true }) driftStatus!: string | null;

  @Column({ name: 'expires_at', type: 'bigint', nullable: true })
  expiresAt!: number | null;

  @Column({ name: 'last_seen_at', type: 'bigint', nullable: true })
  lastSeenAt!: number | null;

  @Column({ name: 'created_by_id', type: 'text', nullable: true })
  createdById!: string | null;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;

  @Column({ name: 'updated_at', type: 'bigint' })
  updatedAt!: number;
}
