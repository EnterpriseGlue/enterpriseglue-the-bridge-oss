import { Entity, Column, Index } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'engine_deployments', schema: 'main' })
@Index('idx_engine_deployments_project', ['projectId', 'deployedAt'])
@Index('idx_engine_deployments_engine', ['engineId', 'deployedAt'])
export class EngineDeployment extends AppBaseEntity {
  @Column({ name: 'project_id', type: 'text' })
  projectId!: string;

  @Column({ name: 'engine_id', type: 'text' })
  engineId!: string;

  @Column({ name: 'engine_name', type: 'text', nullable: true })
  engineName!: string | null;

  @Column({ name: 'environment_tag', type: 'text', nullable: true })
  environmentTag!: string | null;

  @Column({ name: 'engine_base_url', type: 'text', nullable: true })
  engineBaseUrl!: string | null;

  @Column({ name: 'git_deployment_id', type: 'text', nullable: true })
  gitDeploymentId!: string | null;

  @Column({ name: 'git_commit_sha', type: 'text', nullable: true })
  gitCommitSha!: string | null;

  @Column({ name: 'git_commit_message', type: 'text', nullable: true })
  gitCommitMessage!: string | null;

  @Column({ name: 'camunda_deployment_id', type: 'text', nullable: true })
  camundaDeploymentId!: string | null;

  @Column({ name: 'camunda_deployment_name', type: 'text', nullable: true })
  camundaDeploymentName!: string | null;

  @Column({ name: 'camunda_deployment_time', type: 'text', nullable: true })
  camundaDeploymentTime!: string | null;

  @Column({ name: 'deployed_by', type: 'text' })
  deployedBy!: string;

  @Column({ name: 'deployed_at', type: 'bigint' })
  deployedAt!: number;

  @Column({ name: 'enable_duplicate_filtering', type: 'boolean', default: true })
  enableDuplicateFiltering!: boolean;

  @Column({ name: 'deploy_changed_only', type: 'boolean', default: true })
  deployChangedOnly!: boolean;

  @Column({ name: 'resource_count', type: 'integer', default: 0 })
  resourceCount!: number;

  @Column({ type: 'text', default: 'success' })
  status!: string;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage!: string | null;

  @Column({ name: 'raw_response', type: 'text', nullable: true })
  rawResponse!: string | null;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;

  @Column({ name: 'updated_at', type: 'bigint' })
  updatedAt!: number;
}
