import { Entity, Column } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'batches', schema: 'main' })
export class Batch extends AppBaseEntity {
  @Column({ name: 'engine_id', type: 'text', nullable: true })
  engineId!: string | null;

  @Column({ name: 'camunda_batch_id', type: 'text', nullable: true })
  camundaBatchId!: string | null;

  @Column({ type: 'text' })
  type!: string;

  @Column({ type: 'text' })
  payload!: string;

  @Column({ name: 'total_jobs', type: 'integer', nullable: true })
  totalJobs!: number | null;

  @Column({ name: 'jobs_created', type: 'integer', nullable: true })
  jobsCreated!: number | null;

  @Column({ name: 'completed_jobs', type: 'integer', nullable: true })
  completedJobs!: number | null;

  @Column({ name: 'failed_jobs', type: 'integer', nullable: true })
  failedJobs!: number | null;

  @Column({ name: 'remaining_jobs', type: 'integer', nullable: true })
  remainingJobs!: number | null;

  @Column({ name: 'invocations_per_batch_job', type: 'integer', nullable: true })
  invocationsPerBatchJob!: number | null;

  @Column({ name: 'seed_job_definition_id', type: 'text', nullable: true })
  seedJobDefinitionId!: string | null;

  @Column({ name: 'monitor_job_definition_id', type: 'text', nullable: true })
  monitorJobDefinitionId!: string | null;

  @Column({ name: 'batch_job_definition_id', type: 'text', nullable: true })
  batchJobDefinitionId!: string | null;

  @Column({ type: 'text' })
  status!: string;

  @Column({ type: 'integer' })
  progress!: number;

  @Column({ name: 'created_by', type: 'text', nullable: true })
  createdBy!: string | null;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;

  @Column({ name: 'updated_at', type: 'bigint' })
  updatedAt!: number;

  @Column({ name: 'completed_at', type: 'bigint', nullable: true })
  completedAt!: number | null;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError!: string | null;

  @Column({ type: 'text', nullable: true })
  metadata!: string | null;
}
