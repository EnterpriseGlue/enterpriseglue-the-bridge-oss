import { Entity, Column, Index } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'engine_deployment_artifacts', schema: 'main' })
@Index('idx_engine_deployment_artifacts_deployment', ['engineDeploymentId'])
@Index('idx_engine_deployment_artifacts_project_engine_file', ['projectId', 'engineId', 'fileId'])
@Index('idx_engine_deployment_artifacts_project_created', ['projectId', 'createdAt'])
export class EngineDeploymentArtifact extends AppBaseEntity {
  @Column({ name: 'engine_deployment_id', type: 'text' })
  engineDeploymentId!: string;

  @Column({ name: 'project_id', type: 'text' })
  projectId!: string;

  @Column({ name: 'engine_id', type: 'text' })
  engineId!: string;

  @Column({ name: 'file_id', type: 'text', nullable: true })
  fileId!: string | null;

  @Column({ name: 'file_type', type: 'text', nullable: true })
  fileType!: string | null;

  @Column({ name: 'file_name', type: 'text', nullable: true })
  fileName!: string | null;

  @Column({ name: 'file_updated_at', type: 'bigint', nullable: true })
  fileUpdatedAt!: number | null;

  @Column({ name: 'file_content_hash', type: 'text', nullable: true })
  fileContentHash!: string | null;

  @Column({ name: 'file_git_commit_id', type: 'text', nullable: true })
  fileGitCommitId!: string | null;

  @Column({ name: 'file_git_commit_message', type: 'text', nullable: true })
  fileGitCommitMessage!: string | null;

  @Column({ name: 'resource_name', type: 'text' })
  resourceName!: string;

  @Column({ name: 'artifact_kind', type: 'text' })
  artifactKind!: string;

  @Column({ name: 'artifact_id', type: 'text' })
  artifactId!: string;

  @Column({ name: 'artifact_key', type: 'text' })
  artifactKey!: string;

  @Column({ name: 'artifact_version', type: 'integer' })
  artifactVersion!: number;

  @Column({ name: 'tenant_id', type: 'text', nullable: true })
  tenantId!: string | null;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;
}
