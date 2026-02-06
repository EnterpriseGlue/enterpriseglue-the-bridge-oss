import { Entity, Column, Index } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'commits', schema: 'main' })
@Index('commits_project_idx', ['projectId'])
@Index('commits_branch_idx', ['branchId'])
@Index('commits_parent_idx', ['parentCommitId'])
export class Commit extends AppBaseEntity {
  @Column({ name: 'project_id', type: 'text' })
  projectId!: string;

  @Column({ name: 'branch_id', type: 'text' })
  branchId!: string;

  @Column({ name: 'parent_commit_id', type: 'text', nullable: true })
  parentCommitId!: string | null;

  @Column({ name: 'user_id', type: 'text' })
  userId!: string;

  @Column({ type: 'text' })
  message!: string;

  @Column({ type: 'text' })
  hash!: string;

  @Column({ name: 'version_number', type: 'integer', nullable: true })
  versionNumber!: number | null;

  @Column({ name: 'source', type: 'text', default: 'manual' })
  source!: string;

  @Column({ name: 'is_remote', type: 'boolean', default: false })
  isRemote!: boolean;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;
}
