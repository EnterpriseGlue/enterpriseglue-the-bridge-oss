import { Column, Entity, Index, Unique } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

/** Provider-neutral immutable external account link. */
@Entity({ name: 'external_identities', schema: 'main' })
@Unique('uq_external_identities_key', ['identityKey'])
@Index('idx_external_identities_tenant_provider_subject', ['tenantId', 'providerId', 'subjectId'])
@Index('idx_external_identities_user', ['userId'])
@Index('idx_external_identities_provider_status', ['providerId', 'status'])
export class ExternalIdentity extends AppBaseEntity {
  @Column({ name: 'identity_key', type: 'text' })
  identityKey!: string;

  @Column({ name: 'tenant_id', type: 'text', nullable: true })
  tenantId!: string | null;

  @Column({ name: 'provider_id', type: 'text' })
  providerId!: string;

  @Column({ name: 'provider_type', type: 'text' })
  providerType!: string;

  @Column({ name: 'subject_id', type: 'text' })
  subjectId!: string;

  @Column({ name: 'directory_tenant_id', type: 'text', nullable: true })
  directoryTenantId!: string | null;

  @Column({ name: 'user_id', type: 'text' })
  userId!: string;

  @Column({ name: 'email_hint', type: 'text', nullable: true })
  emailHint!: string | null;

  @Column({ type: 'text', default: 'active' })
  status!: string;

  @Column({ name: 'linked_at', type: 'bigint' })
  linkedAt!: number;

  @Column({ name: 'last_seen_at', type: 'bigint' })
  lastSeenAt!: number;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;

  @Column({ name: 'updated_at', type: 'bigint' })
  updatedAt!: number;
}
