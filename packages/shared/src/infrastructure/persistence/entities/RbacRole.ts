import { Entity, Column, Index } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'roles', schema: 'main' })
@Index('idx_roles_tenant', ['tenantId'])
@Index('idx_roles_scope', ['scope'])
@Index('idx_roles_kind', ['kind'])
@Index('idx_roles_source', ['source', 'sourceRef'])
@Index('uq_roles_key_identity', ['roleKeyIdentity'], { unique: true })
export class RbacRole extends AppBaseEntity {
  @Column({ name: 'tenant_id', type: 'text', nullable: true })
  tenantId!: string | null;

  @Column({ type: 'text' })
  key!: string;

  /** Canonical tenant-plus-key uniqueness used for custom roles. */
  @Column({ name: 'role_key_identity', type: 'text' })
  roleKeyIdentity!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'text' })
  scope!: string;

  @Column({ type: 'text' })
  kind!: string;

  @Column({ name: 'is_editable', type: 'boolean', default: false })
  isEditable!: boolean;

  @Column({ name: 'is_assignable', type: 'boolean', default: true })
  isAssignable!: boolean;

  @Column({ name: 'is_archived', type: 'boolean', default: false })
  isArchived!: boolean;

  /** Identifies whether this role is system-seeded, manually managed, or config-owned. */
  @Column({ type: 'text', default: 'manual' })
  source!: string;

  /** Stable owning source, such as a configuration bundle key. */
  @Column({ name: 'source_ref', type: 'text', nullable: true })
  sourceRef!: string | null;

  @Column({ name: 'ownership_mode', type: 'text', default: 'manual' })
  ownershipMode!: string;

  @Column({ name: 'source_hash', type: 'text', nullable: true })
  sourceHash!: string | null;

  @Column({ name: 'last_applied_at', type: 'bigint', nullable: true })
  lastAppliedAt!: number | null;

  @Column({ name: 'drift_status', type: 'text', nullable: true })
  driftStatus!: string | null;

  @Column({ name: 'created_by_id', type: 'text', nullable: true })
  createdById!: string | null;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;

  @Column({ name: 'updated_at', type: 'bigint' })
  updatedAt!: number;
}
