import { Entity, Column, Index, Unique } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'permission_grants', schema: 'main' })
@Unique(['userId', 'permission', 'resourceType', 'resourceId'])
@Index('idx_permission_grants_user', ['userId'])
@Index('idx_permission_grants_permission', ['permission'])
@Index('idx_permission_grants_user_permission', ['userId', 'permission'])
export class PermissionGrant extends AppBaseEntity {
  @Column({ name: 'user_id', type: 'text' })
  userId!: string;

  @Column({ type: 'text' })
  permission!: string;

  @Column({ name: 'resource_type', type: 'text', nullable: true })
  resourceType!: string | null;

  @Column({ name: 'resource_id', type: 'text', nullable: true })
  resourceId!: string | null;

  @Column({ name: 'granted_by_id', type: 'text', nullable: true })
  grantedById!: string | null;

  @Column({ name: 'expires_at', type: 'bigint', nullable: true })
  expiresAt!: number | null;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;
}
