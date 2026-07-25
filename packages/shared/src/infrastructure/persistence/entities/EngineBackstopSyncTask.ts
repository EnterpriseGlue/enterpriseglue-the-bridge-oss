import { Column, Entity, Index, Unique } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

/** Lease-based work record for a requested native backstop synchronization. */
@Entity({ name: 'engine_backstop_sync_tasks', schema: 'main' })
@Unique('uq_engine_backstop_sync_task_run', ['runId'])
@Index('idx_engine_backstop_sync_task_ready', ['status', 'nextAttemptAt', 'createdAt'])
@Index('idx_engine_backstop_sync_task_lease', ['leaseExpiresAt'])
export class EngineBackstopSyncTask extends AppBaseEntity {
  @Column({ name: 'tenant_id', type: 'text', nullable: true }) tenantId!: string | null;
  @Column({ name: 'engine_id', type: 'text' }) engineId!: string;
  @Column({ name: 'run_id', type: 'text' }) runId!: string;
  @Column({ name: 'source_hash', type: 'text' }) sourceHash!: string;
  @Column({ type: 'text' }) operation!: 'apply' | 'rollback' | 'drift_check';
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
