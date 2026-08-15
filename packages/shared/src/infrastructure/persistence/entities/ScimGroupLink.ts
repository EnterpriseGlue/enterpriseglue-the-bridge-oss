import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'scim_group_links', schema: 'main' })
@Index('uq_scim_group_links_external_identity', ['externalIdIdentity'], { unique: true })
@Index('idx_scim_group_links_directory_status', ['directoryId', 'status'])
@Index('idx_scim_group_links_internal_group', ['internalGroupId'])
export class ScimGroupLink extends AppBaseEntity {
  @Column({ name: 'tenant_id', type: 'text', nullable: true }) tenantId!: string | null;
  @Column({ name: 'directory_id', type: 'text' }) directoryId!: string;
  @Column({ name: 'external_id', type: 'text', nullable: true }) externalId!: string | null;
  @Column({ name: 'external_id_identity', type: 'text' }) externalIdIdentity!: string;
  @Column({ name: 'display_name', type: 'text' }) displayName!: string;
  @Column({ name: 'internal_group_id', type: 'text', nullable: true }) internalGroupId!: string | null;
  @Column({ type: 'text', default: 'active' }) status!: 'active' | 'archived';
  @Column({ type: 'integer', default: 1 }) version!: number;
  @Column({ name: 'created_at', type: 'bigint' }) createdAt!: number;
  @Column({ name: 'updated_at', type: 'bigint' }) updatedAt!: number;
  @Column({ name: 'archived_at', type: 'bigint', nullable: true }) archivedAt!: number | null;
}
