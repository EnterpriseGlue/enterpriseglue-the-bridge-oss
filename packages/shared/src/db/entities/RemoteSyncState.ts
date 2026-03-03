import { Entity, Column, Index } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'remote_sync_state', schema: 'main' })
@Index('remote_sync_state_project_idx', ['projectId'])
@Index('remote_sync_state_branch_idx', ['branchId'])
export class RemoteSyncState extends AppBaseEntity {
  @Column({ name: 'project_id', type: 'text' })
  projectId!: string;

  @Column({ name: 'branch_id', type: 'text' })
  branchId!: string;

  @Column({ name: 'remote_url', type: 'text' })
  remoteUrl!: string;

  @Column({ name: 'remote_branch', type: 'text', default: 'main' })
  remoteBranch!: string;

  @Column({ name: 'last_push_commit_id', type: 'text', nullable: true })
  lastPushCommitId!: string | null;

  @Column({ name: 'last_pull_commit_id', type: 'text', nullable: true })
  lastPullCommitId!: string | null;

  @Column({ name: 'last_push_at', type: 'bigint', nullable: true })
  lastPushAt!: number | null;

  @Column({ name: 'last_pull_at', type: 'bigint', nullable: true })
  lastPullAt!: number | null;

  @Column({ name: 'sync_status', type: 'text', default: 'synced' })
  syncStatus!: string;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;

  @Column({ name: 'updated_at', type: 'bigint' })
  updatedAt!: number;
}
