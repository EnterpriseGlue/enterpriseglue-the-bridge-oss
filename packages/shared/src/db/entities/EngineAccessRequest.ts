import { Entity, Column, Index } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'engine_access_requests', schema: 'main' })
@Index('idx_engine_access_requests_engine', ['engineId'])
@Index('idx_engine_access_requests_status', ['status'])
export class EngineAccessRequest extends AppBaseEntity {
  @Column({ name: 'engine_id', type: 'text' })
  engineId!: string;

  @Column({ name: 'project_id', type: 'text' })
  projectId!: string;

  @Column({ name: 'requested_by_id', type: 'text' })
  requestedById!: string;

  @Column({ type: 'text', default: 'pending' })
  status!: string;

  @Column({ name: 'reviewed_by_id', type: 'text', nullable: true })
  reviewedById!: string | null;

  @Column({ name: 'reviewed_at', type: 'bigint', nullable: true })
  reviewedAt!: number | null;

  @Column({ name: 'review_note', type: 'text', nullable: true })
  reviewNote!: string | null;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;
}
