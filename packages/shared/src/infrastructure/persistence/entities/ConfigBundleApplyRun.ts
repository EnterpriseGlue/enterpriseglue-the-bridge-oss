import { Column, Entity, Index, Unique } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'config_bundle_apply_runs', schema: 'main' })
@Unique('uq_config_bundle_apply_run_idempotency', ['tenantScopeKey', 'idempotencyKey'])
@Index('idx_config_bundle_apply_run_tenant_created', ['tenantScopeKey', 'createdAt'])
@Index('idx_config_bundle_apply_run_status', ['status', 'updatedAt'])
export class ConfigBundleApplyRun extends AppBaseEntity {
  @Column({ name: 'tenant_id', type: 'text', nullable: true }) tenantId!: string | null;
  @Column({ name: 'tenant_scope_key', type: 'text' }) tenantScopeKey!: string;
  @Column({ name: 'bundle_key', type: 'text' }) bundleKey!: string;
  @Column({ name: 'bundle_api_version', type: 'text', nullable: true }) bundleApiVersion!: string | null;
  @Column({ name: 'canonical_hash', type: 'text' }) canonicalHash!: string;
  @Column({ name: 'idempotency_key', type: 'text', nullable: true }) idempotencyKey!: string | null;
  @Column({ name: 'actor_id', type: 'text', nullable: true }) actorId!: string | null;
  @Column({ type: 'text' }) status!: 'pending' | 'succeeded' | 'failed';
  @Column({ name: 'result_json', type: 'text', nullable: true }) resultJson!: string | null;
  @Column({ name: 'error_message', type: 'text', nullable: true }) errorMessage!: string | null;
  @Column({ name: 'completed_at', type: 'bigint', nullable: true }) completedAt!: number | null;
  @Column({ name: 'created_at', type: 'bigint' }) createdAt!: number;
  @Column({ name: 'updated_at', type: 'bigint' }) updatedAt!: number;
}
