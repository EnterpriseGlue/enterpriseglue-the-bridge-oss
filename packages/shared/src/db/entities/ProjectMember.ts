import { Entity, Column, Index, Unique } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'project_members', schema: 'main' })
@Unique(['projectId', 'userId'])
@Index('idx_project_members_project', ['projectId'])
@Index('idx_project_members_user', ['userId'])
export class ProjectMember extends AppBaseEntity {
  @Column({ name: 'project_id', type: 'text' })
  projectId!: string;

  @Column({ name: 'user_id', type: 'text' })
  userId!: string;

  @Column({ type: 'text' })
  role!: string;

  @Column({ name: 'invited_by_id', type: 'text', nullable: true })
  invitedById!: string | null;

  @Column({ name: 'joined_at', type: 'bigint' })
  joinedAt!: number;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;

  @Column({ name: 'updated_at', type: 'bigint' })
  updatedAt!: number;
}
