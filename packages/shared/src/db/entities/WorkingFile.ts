import { Entity, Column, Index } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'working_files', schema: 'main' })
@Index('working_files_branch_idx', ['branchId'])
@Index('working_files_project_idx', ['projectId'])
@Index('working_files_folder_idx', ['folderId'])
export class WorkingFile extends AppBaseEntity {
  @Column({ name: 'branch_id', type: 'text' })
  branchId!: string;

  @Column({ name: 'project_id', type: 'text' })
  projectId!: string;

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

  @Column({ name: 'is_deleted', type: 'boolean', default: false })
  isDeleted!: boolean;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;

  @Column({ name: 'updated_at', type: 'bigint' })
  updatedAt!: number;
}
