import { Entity, Column, Index } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'git_deployments', schema: 'main' })
@Index('idx_git_deployments_project_id', ['projectId', 'deployedAt'])
@Index('idx_git_deployments_repository_id', ['repositoryId', 'deployedAt'])
export class GitDeployment extends AppBaseEntity {
  @Column({ name: 'project_id', type: 'text' })
  projectId!: string;

  @Column({ name: 'repository_id', type: 'text' })
  repositoryId!: string;

  @Column({ name: 'commit_sha', type: 'text' })
  commitSha!: string;

  @Column({ name: 'commit_message', type: 'text' })
  commitMessage!: string;

  @Column({ type: 'text', nullable: true })
  tag!: string | null;

  @Column({ name: 'deployed_by', type: 'text' })
  deployedBy!: string;

  @Column({ name: 'deployed_at', type: 'bigint' })
  deployedAt!: number;

  @Column({ type: 'text', nullable: true })
  environment!: string | null;

  @Column({ type: 'text', default: 'success' })
  status!: string;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage!: string | null;

  @Column({ name: 'files_changed', type: 'integer', nullable: true })
  filesChanged!: number | null;

  @Column({ type: 'text', nullable: true })
  metadata!: string | null;
}
