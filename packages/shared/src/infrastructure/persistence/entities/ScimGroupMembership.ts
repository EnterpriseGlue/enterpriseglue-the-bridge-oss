import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'scim_group_memberships', schema: 'main' })
@Index('uq_scim_group_memberships_identity', ['membershipIdentity'], { unique: true })
@Index('idx_scim_group_memberships_group', ['groupLinkId'])
@Index('idx_scim_group_memberships_user', ['userLinkId'])
export class ScimGroupMembership extends AppBaseEntity {
  @Column({ name: 'tenant_id', type: 'text', nullable: true }) tenantId!: string | null;
  @Column({ name: 'directory_id', type: 'text' }) directoryId!: string;
  @Column({ name: 'group_link_id', type: 'text' }) groupLinkId!: string;
  @Column({ name: 'user_link_id', type: 'text' }) userLinkId!: string;
  @Column({ name: 'membership_identity', type: 'text' }) membershipIdentity!: string;
  @Column({ name: 'created_at', type: 'bigint' }) createdAt!: number;
  @Column({ name: 'updated_at', type: 'bigint' }) updatedAt!: number;
}
