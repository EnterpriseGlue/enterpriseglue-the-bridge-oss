import { Column, Entity, Index, Unique } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'config_bundle_identity_replay_tasks', schema: 'main' })
@Unique('uq_config_bundle_identity_replay_task_run_provider', ['applyRunId', 'providerId'])
@Index('idx_config_bundle_identity_replay_task_ready', ['status', 'nextAttemptAt', 'createdAt'])
@Index('idx_config_bundle_identity_replay_task_run', ['applyRunId', 'createdAt'])
@Index('idx_config_bundle_identity_replay_task_lease', ['leaseExpiresAt'])
export class ConfigBundleIdentityReplayTask extends AppBaseEntity {
  @Column({ name: 'tenant_id', type: 'text', nullable: true }) tenantId!: string | null;
  @Column({ name: 'apply_run_id', type: 'text' }) applyRunId!: string;
  @Column({ name: 'provider_id', type: 'text' }) providerId!: string;
  @Column({ type: 'text' }) status!: 'queued' | 'running' | 'completed' | 'cancelled';
  @Column({ type: 'text', nullable: true }) cursor!: string | null;
  @Column({ name: 'lease_id', type: 'text', nullable: true }) leaseId!: string | null;
  @Column({ name: 'lease_expires_at', type: 'bigint', nullable: true }) leaseExpiresAt!: number | null;
  @Column({ type: 'integer', default: 0 }) attempts!: number;
  @Column({ name: 'next_attempt_at', type: 'bigint', nullable: true }) nextAttemptAt!: number | null;
  @Column({ type: 'integer', default: 0 }) scanned!: number;
  @Column({ type: 'integer', default: 0 }) created!: number;
  @Column({ type: 'integer', default: 0 }) removed!: number;
  @Column({ type: 'integer', default: 0 }) failed!: number;
  @Column({ name: 'last_error', type: 'text', nullable: true }) lastError!: string | null;
  @Column({ name: 'completed_at', type: 'bigint', nullable: true }) completedAt!: number | null;
  @Column({ name: 'created_at', type: 'bigint' }) createdAt!: number;
  @Column({ name: 'updated_at', type: 'bigint' }) updatedAt!: number;
}
