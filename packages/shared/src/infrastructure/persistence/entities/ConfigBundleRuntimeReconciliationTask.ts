import { Column, Entity, Index, Unique } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

/** Durable post-apply materialization for Engine Sets and runtime-resource sets. */
@Entity({ name: 'config_bundle_runtime_reconciliation_tasks', schema: 'main' })
@Unique('uq_config_bundle_runtime_reconciliation_task_run', ['applyRunId'])
@Index('idx_config_bundle_runtime_reconciliation_task_ready', ['status', 'nextAttemptAt', 'createdAt'])
@Index('idx_config_bundle_runtime_reconciliation_task_lease', ['leaseExpiresAt'])
export class ConfigBundleRuntimeReconciliationTask extends AppBaseEntity {
  @Column({ name: 'tenant_id', type: 'text', nullable: true }) tenantId!: string | null;
  @Column({ name: 'apply_run_id', type: 'text' }) applyRunId!: string;
  @Column({ name: 'engine_set_ids_json', type: 'text' }) engineSetIdsJson!: string;
  @Column({ name: 'runtime_resource_set_ids_json', type: 'text' }) runtimeResourceSetIdsJson!: string;
  @Column({ name: 'engine_ids_json', type: 'text' }) engineIdsJson!: string;
  @Column({ type: 'text' }) status!: 'queued' | 'running' | 'completed';
  @Column({ name: 'lease_id', type: 'text', nullable: true }) leaseId!: string | null;
  @Column({ name: 'lease_expires_at', type: 'bigint', nullable: true }) leaseExpiresAt!: number | null;
  @Column({ type: 'integer', default: 0 }) attempts!: number;
  @Column({ name: 'next_attempt_at', type: 'bigint', nullable: true }) nextAttemptAt!: number | null;
  @Column({ name: 'result_json', type: 'text', nullable: true }) resultJson!: string | null;
  @Column({ name: 'last_error', type: 'text', nullable: true }) lastError!: string | null;
  @Column({ name: 'completed_at', type: 'bigint', nullable: true }) completedAt!: number | null;
  @Column({ name: 'created_at', type: 'bigint' }) createdAt!: number;
  @Column({ name: 'updated_at', type: 'bigint' }) updatedAt!: number;
}
