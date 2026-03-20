import { Entity, Column, Index } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'file_snapshots', schema: 'main' })
@Index('file_snapshots_commit_idx', ['commitId'])
@Index('file_snapshots_working_file_idx', ['workingFileId'])
@Index('file_snapshots_main_file_idx', ['mainFileId'])
export class FileSnapshot extends AppBaseEntity {
  @Column({ name: 'commit_id', type: 'text' })
  commitId!: string;

  @Column({ name: 'working_file_id', type: 'text' })
  workingFileId!: string;

  @Column({ name: 'main_file_id', type: 'text', nullable: true })
  mainFileId!: string | null;

  @Column({ name: 'folder_id', type: 'text', nullable: true })
  folderId!: string | null;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text' })
  type!: string;

  @Column({ type: 'text', nullable: true })
  content!: string | null;

  @Column({ name: 'content_hash', type: 'text', nullable: true })
  contentHash!: string | null;

  @Column({ name: 'change_type', type: 'text' })
  changeType!: string;
}
