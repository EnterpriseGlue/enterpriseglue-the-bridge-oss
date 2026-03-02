import { Entity, Column, Index, Unique } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'engine_project_access', schema: 'main' })
@Unique(['engineId', 'projectId'])
@Index('idx_engine_project_access_engine', ['engineId'])
@Index('idx_engine_project_access_project', ['projectId'])
export class EngineProjectAccess extends AppBaseEntity {
  @Column({ name: 'engine_id', type: 'text' })
  engineId!: string;

  @Column({ name: 'project_id', type: 'text' })
  projectId!: string;

  @Column({ name: 'granted_by_id', type: 'text', nullable: true })
  grantedById!: string | null;

  @Column({ name: 'auto_approved', type: 'boolean', default: false })
  autoApproved!: boolean;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;
}
