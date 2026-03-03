import { Entity, Column, Index } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'git_audit_log', schema: 'main' })
@Index('idx_git_audit_log_repository_id', ['repositoryId', 'createdAt'])
@Index('idx_git_audit_log_user_id', ['userId', 'createdAt'])
@Index('idx_git_audit_log_operation', ['operation', 'createdAt'])
export class GitAuditLog extends AppBaseEntity {
  @Column({ name: 'repository_id', type: 'text', nullable: true })
  repositoryId!: string | null;

  @Column({ name: 'user_id', type: 'text' })
  userId!: string;

  @Column({ type: 'text' })
  operation!: string;

  @Column({ type: 'text', nullable: true })
  details!: string | null;

  @Column({ type: 'text' })
  status!: string;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage!: string | null;

  @Column({ type: 'bigint', nullable: true })
  duration!: number | null;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;
}
