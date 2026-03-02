import { Entity, Column, Index } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'branches', schema: 'main' })
@Index('branches_project_idx', ['projectId'])
@Index('branches_user_idx', ['userId'])
@Index('branches_project_user_idx', ['projectId', 'userId'], { unique: true })
export class Branch extends AppBaseEntity {
  @Column({ name: 'project_id', type: 'text' })
  projectId!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ name: 'user_id', type: 'text', nullable: true })
  userId!: string | null;

  @Column({ name: 'base_commit_id', type: 'text', nullable: true })
  baseCommitId!: string | null;

  @Column({ name: 'head_commit_id', type: 'text', nullable: true })
  headCommitId!: string | null;

  @Column({ name: 'is_default', type: 'boolean', default: false })
  isDefault!: boolean;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;

  @Column({ name: 'updated_at', type: 'bigint' })
  updatedAt!: number;
}
