import { Entity, Column, Index } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'git_push_queue', schema: 'main' })
@Index('idx_git_push_queue_status', ['status', 'createdAt'])
export class GitPushQueue extends AppBaseEntity {
  @Column({ name: 'repository_id', type: 'text' })
  repositoryId!: string;

  @Column({ name: 'commit_sha', type: 'text' })
  commitSha!: string;

  @Column({ type: 'text', nullable: true })
  tag!: string | null;

  @Column({ type: 'integer', default: 0 })
  attempts!: number;

  @Column({ name: 'max_attempts', type: 'integer', default: 3 })
  maxAttempts!: number;

  @Column({ name: 'last_attempt_at', type: 'bigint', nullable: true })
  lastAttemptAt!: number | null;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError!: string | null;

  @Column({ type: 'text', default: 'pending' })
  status!: string;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;

  @Column({ name: 'updated_at', type: 'bigint' })
  updatedAt!: number;
}
