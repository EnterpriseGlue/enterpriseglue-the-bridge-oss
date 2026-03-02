import { Entity, Column } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'files', schema: 'main' })
export class File extends AppBaseEntity {
  @Column({ name: 'project_id', type: 'text' })
  projectId!: string;

  @Column({ name: 'folder_id', type: 'text', nullable: true })
  folderId!: string | null;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text' })
  type!: string;

  @Column({ type: 'text' })
  xml!: string;

  @Column({ name: 'bpmn_process_id', type: 'text', nullable: true })
  bpmnProcessId!: string | null;

  @Column({ name: 'dmn_decision_id', type: 'text', nullable: true })
  dmnDecisionId!: string | null;

  @Column({ name: 'created_by', type: 'text', nullable: true })
  createdBy!: string | null;

  @Column({ name: 'updated_by', type: 'text', nullable: true })
  updatedBy!: string | null;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;

  @Column({ name: 'updated_at', type: 'bigint' })
  updatedAt!: number;
}
