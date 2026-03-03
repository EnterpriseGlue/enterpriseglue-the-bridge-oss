import { Entity, Column, Index } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'pending_changes', schema: 'main' })
@Index('pending_changes_branch_idx', ['branchId'])
@Index('pending_changes_file_idx', ['workingFileId'])
export class PendingChange extends AppBaseEntity {
  @Column({ name: 'branch_id', type: 'text' })
  branchId!: string;

  @Column({ name: 'working_file_id', type: 'text' })
  workingFileId!: string;

  @Column({ name: 'change_type', type: 'text' })
  changeType!: string;

  @Column({ name: 'previous_content_hash', type: 'text', nullable: true })
  previousContentHash!: string | null;

  @Column({ name: 'new_content_hash', type: 'text', nullable: true })
  newContentHash!: string | null;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;
}
