import { Column, Entity, Index, Unique } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'engine_sets', schema: 'main' })
@Unique('uq_engine_sets_tenant_key', ['tenantId', 'key'])
@Index('uq_engine_sets_key_identity', ['engineSetKeyIdentity'], { unique: true })
@Index('idx_engine_sets_tenant', ['tenantId'])
@Index('idx_engine_sets_source', ['source', 'sourceRef'])
@Index('idx_engine_sets_archived', ['isArchived'])
export class EngineSet extends AppBaseEntity {
  @Column({ name: 'tenant_id', type: 'text', nullable: true })
  tenantId!: string | null;

  @Column({ type: 'text' })
  key!: string;

  @Column({ name: 'engine_set_key_identity', type: 'text' })
  engineSetKeyIdentity!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'selector_json', type: 'text' })
  selectorJson!: string;

  @Column({ name: 'selector_fingerprint', type: 'text' })
  selectorFingerprint!: string;

  @Column({ type: 'text', default: 'manual' })
  source!: string;

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

  @Column({ name: 'is_archived', type: 'boolean', default: false })
  isArchived!: boolean;

  @Column({ name: 'created_by_id', type: 'text', nullable: true })
  createdById!: string | null;

  @Column({ name: 'last_materialized_at', type: 'bigint', nullable: true })
  lastMaterializedAt!: number | null;

  @Column({ name: 'materialization_status', type: 'text', default: 'pending' })
  materializationStatus!: string;

  @Column({ name: 'materialization_error', type: 'text', nullable: true })
  materializationError!: string | null;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;

  @Column({ name: 'updated_at', type: 'bigint' })
  updatedAt!: number;
}
