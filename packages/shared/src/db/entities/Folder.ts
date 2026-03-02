import { Entity, Column } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'folders', schema: 'main' })
export class Folder extends AppBaseEntity {
  @Column({ name: 'project_id', type: 'text' })
  projectId!: string;

  @Column({ name: 'parent_folder_id', type: 'text', nullable: true })
  parentFolderId!: string | null;

  @Column({ type: 'text' })
  name!: string;

  @Column({ name: 'created_by', type: 'text', nullable: true })
  createdBy!: string | null;

  @Column({ name: 'updated_by', type: 'text', nullable: true })
  updatedBy!: string | null;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;

  @Column({ name: 'updated_at', type: 'bigint' })
  updatedAt!: number;
}
