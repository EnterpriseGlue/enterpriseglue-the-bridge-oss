import { Entity, Column, Index } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'working_folders', schema: 'main' })
@Index('working_folders_branch_idx', ['branchId'])
@Index('working_folders_project_idx', ['projectId'])
@Index('working_folders_parent_idx', ['parentFolderId'])
export class WorkingFolder extends AppBaseEntity {
  @Column({ name: 'branch_id', type: 'text' })
  branchId!: string;

  @Column({ name: 'project_id', type: 'text' })
  projectId!: string;

  @Column({ name: 'parent_folder_id', type: 'text', nullable: true })
  parentFolderId!: string | null;

  @Column({ type: 'text' })
  name!: string;

  @Column({ name: 'is_deleted', type: 'boolean', default: false })
  isDeleted!: boolean;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;

  @Column({ name: 'updated_at', type: 'bigint' })
  updatedAt!: number;
}
