import { Entity, Column, Index } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'sso_assignment_mappings', schema: 'main' })
@Index('idx_sso_assignment_tenant', ['tenantId'])
@Index('idx_sso_assignment_provider', ['providerId'])
@Index('idx_sso_assignment_active', ['isActive'])
@Index('idx_sso_assignment_lookup', ['claimType', 'claimKey', 'isActive'])
export class SsoAssignmentMapping extends AppBaseEntity {
  @Column({ name: 'tenant_id', type: 'text', nullable: true })
  tenantId!: string | null;

  @Column({ name: 'provider_id', type: 'text', nullable: true })
  providerId!: string | null;

  @Column({ name: 'claim_type', type: 'text' })
  claimType!: string;

  @Column({ name: 'claim_key', type: 'text' })
  claimKey!: string;

  @Column({ name: 'claim_value', type: 'text' })
  claimValue!: string;

  @Column({ name: 'claim_operator', type: 'text', nullable: true })
  claimOperator!: string | null;

  @Column({ name: 'target_scope', type: 'text', default: 'engine' })
  targetScope!: string;

  @Column({ name: 'target_selector_type', type: 'text' })
  targetSelectorType!: string;

  @Column({ name: 'target_engine_id', type: 'text', nullable: true })
  targetEngineId!: string | null;

  @Column({ name: 'target_external_engine_id', type: 'text', nullable: true })
  targetExternalEngineId!: string | null;

  @Column({ name: 'target_label_key', type: 'text', nullable: true })
  targetLabelKey!: string | null;

  @Column({ name: 'target_label_value', type: 'text', nullable: true })
  targetLabelValue!: string | null;

  @Column({ name: 'target_role_id', type: 'text' })
  targetRoleId!: string;

  @Column({ name: 'sync_mode', type: 'text', default: 'authoritative' })
  syncMode!: string;

  @Column({ type: 'integer', default: 0 })
  priority!: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;

  @Column({ name: 'updated_at', type: 'bigint' })
  updatedAt!: number;
}
