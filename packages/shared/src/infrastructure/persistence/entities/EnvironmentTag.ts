import { Entity, Column, Index } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'environment_tags', schema: 'main' })
@Index('uq_environment_tags_config_key', ['configKey'], { unique: true })
@Index('idx_environment_tags_source', ['sourceRef'])
export class EnvironmentTag extends AppBaseEntity {
  @Column({ type: 'text', unique: true })
  name!: string;

  @Column({ type: 'text', default: '#6b7280' })
  color!: string;

  @Column({ name: 'manual_deploy_allowed', type: 'boolean', default: true })
  manualDeployAllowed!: boolean;

  @Column({ name: 'sort_order', type: 'integer', default: 0 })
  sortOrder!: number;

  @Column({ name: 'is_default', type: 'boolean', default: false })
  isDefault!: boolean;

  @Column({ name: 'config_key', type: 'text', nullable: true })
  configKey!: string | null;

  @Column({ name: 'source_ref', type: 'text', nullable: true })
  sourceRef!: string | null;

  /** Tenant/platform scope that claimed this otherwise platform-global tag. */
  @Column({ name: 'config_scope_key', type: 'text', nullable: true })
  configScopeKey!: string | null;

  @Column({ name: 'ownership_mode', type: 'text', default: 'manual' })
  ownershipMode!: 'manual' | 'config_locked' | 'config_warn';

  @Column({ name: 'source_hash', type: 'text', nullable: true })
  sourceHash!: string | null;

  @Column({ name: 'last_applied_at', type: 'bigint', nullable: true })
  lastAppliedAt!: number | null;

  @Column({ name: 'drift_status', type: 'text', nullable: true })
  driftStatus!: 'in_sync' | 'drifted' | null;

  @Column({ name: 'config_generation', type: 'bigint', default: 0 })
  configGeneration!: number;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;

  @Column({ name: 'updated_at', type: 'bigint' })
  updatedAt!: number;
}
