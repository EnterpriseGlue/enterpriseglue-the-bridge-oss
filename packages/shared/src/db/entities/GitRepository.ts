import { Entity, Column, Index } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'git_repositories', schema: 'main' })
@Index('idx_git_repositories_project_id', ['projectId'])
export class GitRepository extends AppBaseEntity {
  @Column({ name: 'project_id', type: 'text' })
  projectId!: string;

  @Column({ name: 'provider_id', type: 'text' })
  providerId!: string;

  @Column({ name: 'connected_by_user_id', type: 'text', nullable: true })
  connectedByUserId!: string | null;

  @Column({ name: 'remote_url', type: 'text' })
  remoteUrl!: string;

  @Column({ type: 'text', nullable: true })
  namespace!: string | null;

  @Column({ name: 'repository_name', type: 'text' })
  repositoryName!: string;

  @Column({ name: 'default_branch', type: 'text', default: 'main' })
  defaultBranch!: string;

  @Column({ name: 'encrypted_token', type: 'text', nullable: true })
  encryptedToken!: string | null;

  @Column({ name: 'last_validated_at', type: 'bigint', nullable: true })
  lastValidatedAt!: number | null;

  @Column({ name: 'token_scope_hint', type: 'text', nullable: true })
  tokenScopeHint!: string | null;

  @Column({ name: 'auto_push_enabled', type: 'boolean', nullable: true })
  autoPushEnabled!: boolean | null;

  @Column({ name: 'auto_pull_enabled', type: 'boolean', nullable: true })
  autoPullEnabled!: boolean | null;

  @Column({ name: 'last_commit_sha', type: 'text', nullable: true })
  lastCommitSha!: string | null;

  @Column({ name: 'last_sync_at', type: 'bigint', nullable: true })
  lastSyncAt!: number | null;

  @Column({ name: 'last_pushed_manifest', type: 'text', nullable: true })
  lastPushedManifest!: string | null;

  @Column({ name: 'last_pushed_manifest_updated_at', type: 'bigint', nullable: true })
  lastPushedManifestUpdatedAt!: number | null;

  @Column({ name: 'clone_path', type: 'text' })
  clonePath!: string;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;

  @Column({ name: 'updated_at', type: 'bigint' })
  updatedAt!: number;
}
