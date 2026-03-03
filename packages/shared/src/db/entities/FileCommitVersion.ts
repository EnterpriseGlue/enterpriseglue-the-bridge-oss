import { Entity, Column, PrimaryColumn, Index } from 'typeorm';

@Entity({ name: 'file_commit_versions', schema: 'main' })
@Index('file_commit_versions_project_idx', ['projectId'])
@Index('file_commit_versions_file_idx', ['fileId'])
@Index('file_commit_versions_commit_idx', ['commitId'])
@Index('file_commit_versions_file_version_idx', ['fileId', 'versionNumber'], { unique: true })
export class FileCommitVersion {
  @Column({ name: 'project_id', type: 'text' })
  projectId!: string;

  @PrimaryColumn({ name: 'file_id', type: 'text' })
  fileId!: string;

  @PrimaryColumn({ name: 'commit_id', type: 'text' })
  commitId!: string;

  @Column({ name: 'version_number', type: 'integer' })
  versionNumber!: number;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;
}
