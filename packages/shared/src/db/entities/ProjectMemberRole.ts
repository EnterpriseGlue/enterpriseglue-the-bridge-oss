import { Entity, Column, PrimaryColumn, Index } from 'typeorm';

@Entity({ name: 'project_member_roles', schema: 'main' })
@Index('project_member_roles_project_idx', ['projectId'])
@Index('project_member_roles_user_idx', ['userId'])
export class ProjectMemberRole {
  @PrimaryColumn({ name: 'project_id', type: 'text' })
  projectId!: string;

  @PrimaryColumn({ name: 'user_id', type: 'text' })
  userId!: string;

  @PrimaryColumn({ type: 'text' })
  role!: string;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;
}
