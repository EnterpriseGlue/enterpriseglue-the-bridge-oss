import { Entity, Column, Index } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'git_locks', schema: 'main' })
@Index('idx_git_locks_file_id', ['fileId', 'released'])
@Index('idx_git_locks_user_id', ['userId', 'released'])
export class GitLock extends AppBaseEntity {
  @Column({ name: 'file_id', type: 'text' })
  fileId!: string;

  @Column({ name: 'user_id', type: 'text' })
  userId!: string;

  @Column({ name: 'acquired_at', type: 'bigint' })
  acquiredAt!: number;

  @Column({ name: 'expires_at', type: 'bigint' })
  expiresAt!: number;

  @Column({ name: 'heartbeat_at', type: 'bigint' })
  heartbeatAt!: number;

  @Column({ type: 'boolean', default: false })
  released!: boolean;

  @Column({ name: 'released_at', type: 'bigint', nullable: true })
  releasedAt!: number | null;
}
