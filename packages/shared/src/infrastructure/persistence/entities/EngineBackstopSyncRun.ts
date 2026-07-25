import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

/**
 * Sanitized receipt for a preview/apply/rollback of backstop-owned Camunda
 * authorizations. The owned native identifiers are encrypted and expire.
 */
@Entity({ name: 'engine_backstop_sync_runs', schema: 'main' })
@Index('idx_engine_backstop_sync_run_engine_created', ['engineId', 'createdAt'])
@Index('idx_engine_backstop_sync_run_status_updated', ['status', 'updatedAt'])
@Index('idx_engine_backstop_sync_run_snapshot_expiry', ['detailedSnapshotExpiresAt'])
export class EngineBackstopSyncRun extends AppBaseEntity {
  @Column({ name: 'tenant_id', type: 'text', nullable: true }) tenantId!: string | null;
  @Column({ name: 'engine_id', type: 'text' }) engineId!: string;
  @Column({ type: 'text' }) status!: 'previewed' | 'queued' | 'running' | 'succeeded' | 'failed' | 'rolled_back' | 'out_of_sync';
  @Column({ name: 'source_hash', type: 'text' }) sourceHash!: string;
  @Column({ name: 'desired_hash', type: 'text' }) desiredHash!: string;
  @Column({ name: 'result_hash', type: 'text', nullable: true }) resultHash!: string | null;
  @Column({ name: 'catalog_version', type: 'text' }) catalogVersion!: string;
  @Column({ name: 'capability_json', type: 'text' }) capabilityJson!: string;
  @Column({ name: 'counts_json', type: 'text' }) countsJson!: string;
  @Column({ name: 'classifications_json', type: 'text' }) classificationsJson!: string;
  @Column({ name: 'encrypted_detailed_snapshot', type: 'text', nullable: true }) encryptedDetailedSnapshot!: string | null;
  @Column({ name: 'detailed_snapshot_expires_at', type: 'bigint', nullable: true }) detailedSnapshotExpiresAt!: number | null;
  @Column({ name: 'rollback_of_run_id', type: 'text', nullable: true }) rollbackOfRunId!: string | null;
  /** Present for a read-only observation of the owned grants from an apply run. */
  @Column({ name: 'observed_of_run_id', type: 'text', nullable: true }) observedOfRunId!: string | null;
  @Column({ name: 'created_by_id', type: 'text', nullable: true }) createdById!: string | null;
  @Column({ name: 'completed_at', type: 'bigint', nullable: true }) completedAt!: number | null;
  @Column({ name: 'created_at', type: 'bigint' }) createdAt!: number;
  @Column({ name: 'updated_at', type: 'bigint' }) updatedAt!: number;
}
