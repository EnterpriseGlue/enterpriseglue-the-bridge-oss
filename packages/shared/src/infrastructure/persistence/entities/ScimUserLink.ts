import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'scim_user_links', schema: 'main' })
@Index('uq_scim_user_links_directory_user', ['directoryUserIdentity'], { unique: true })
@Index('uq_scim_user_links_directory_username', ['directoryUsernameIdentity'], { unique: true })
@Index('uq_scim_user_links_external_identity', ['externalIdIdentity'], { unique: true })
@Index('idx_scim_user_links_directory_status', ['directoryId', 'status'])
@Index('idx_scim_user_links_user', ['userId'])
export class ScimUserLink extends AppBaseEntity {
  @Column({ name: 'tenant_id', type: 'text', nullable: true }) tenantId!: string | null;
  @Column({ name: 'directory_id', type: 'text' }) directoryId!: string;
  @Column({ name: 'user_id', type: 'text' }) userId!: string;
  @Column({ name: 'directory_user_identity', type: 'text' }) directoryUserIdentity!: string;
  @Column({ name: 'directory_username_identity', type: 'text' }) directoryUsernameIdentity!: string;
  @Column({ name: 'external_id', type: 'text', nullable: true }) externalId!: string | null;
  /** Always populated; links without externalId receive an id-scoped non-colliding identity. */
  @Column({ name: 'external_id_identity', type: 'text' }) externalIdIdentity!: string;
  @Column({ name: 'user_name', type: 'text' }) userName!: string;
  @Column({ name: 'profile_json', type: 'text', default: '{}' }) profileJson!: string;
  @Column({ type: 'boolean', default: true }) active!: boolean;
  @Column({ type: 'text', default: 'active' }) status!: 'active' | 'inactive' | 'conflict' | 'archived';
  @Column({ type: 'integer', default: 1 }) version!: number;
  @Column({ name: 'last_provisioned_at', type: 'bigint' }) lastProvisionedAt!: number;
  @Column({ name: 'created_at', type: 'bigint' }) createdAt!: number;
  @Column({ name: 'updated_at', type: 'bigint' }) updatedAt!: number;
  @Column({ name: 'deactivated_at', type: 'bigint', nullable: true }) deactivatedAt!: number | null;
}
