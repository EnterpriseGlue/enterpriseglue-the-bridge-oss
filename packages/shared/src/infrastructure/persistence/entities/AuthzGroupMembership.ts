import { Column, Entity, Index, Unique } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'authz_group_memberships', schema: 'main' })
@Unique(['groupId', 'userId', 'source', 'sourceRef'])
@Index('idx_authz_group_memberships_tenant', ['tenantId'])
@Index('idx_authz_group_memberships_group', ['groupId'])
@Index('idx_authz_group_memberships_user', ['userId'])
@Index('idx_authz_group_memberships_source', ['source', 'sourceRef'])
export class AuthzGroupMembership extends AppBaseEntity {
  @Column({ name: 'tenant_id', type: 'text', nullable: true })
  tenantId!: string | null;

  @Column({ name: 'group_id', type: 'text' })
  groupId!: string;

  @Column({ name: 'user_id', type: 'text' })
  userId!: string;

  @Column({ type: 'text', default: 'manual' })
  source!: string;

  @Column({ name: 'source_ref', type: 'text', nullable: true })
  sourceRef!: string | null;

  @Column({ name: 'expires_at', type: 'bigint', nullable: true })
  expiresAt!: number | null;

  @Column({ name: 'created_by_id', type: 'text', nullable: true })
  createdById!: string | null;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;

  @Column({ name: 'updated_at', type: 'bigint' })
  updatedAt!: number;
}
