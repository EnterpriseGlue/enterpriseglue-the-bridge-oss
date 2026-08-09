import { Entity, Column, Index } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'sso_normalized_identities', schema: 'main' })
@Index('idx_sso_normalized_identities_tenant', ['tenantId'])
@Index('idx_sso_normalized_identities_provider_subject', ['providerId', 'providerSubject'])
@Index('idx_sso_normalized_identities_user', ['userId'])
@Index('idx_sso_normalized_identities_status', ['providerStatus', 'lastSeenAt'])
export class SsoNormalizedIdentity extends AppBaseEntity {
  @Column({ name: 'tenant_id', type: 'text', nullable: true })
  tenantId!: string | null;

  @Column({ name: 'provider_id', type: 'text' })
  providerId!: string;

  @Column({ name: 'provider_type', type: 'text' })
  providerType!: string;

  @Column({ name: 'provider_subject', type: 'text' })
  providerSubject!: string;

  @Column({ name: 'subject_claim', type: 'text', nullable: true })
  subjectClaim!: string | null;

  @Column({ name: 'provider_tenant_id', type: 'text', nullable: true })
  providerTenantId!: string | null;

  @Column({ name: 'user_id', type: 'text' })
  userId!: string;

  @Column({ type: 'text', nullable: true })
  email!: string | null;

  @Column({ name: 'display_name', type: 'text', nullable: true })
  displayName!: string | null;

  @Column({ name: 'first_name', type: 'text', nullable: true })
  firstName!: string | null;

  @Column({ name: 'last_name', type: 'text', nullable: true })
  lastName!: string | null;

  @Column({ name: 'groups_json', type: 'text', default: '[]' })
  groupsJson!: string;

  @Column({ name: 'roles_json', type: 'text', default: '[]' })
  rolesJson!: string;

  @Column({ name: 'claims_json', type: 'text', default: '{}' })
  claimsJson!: string;

  @Column({ name: 'provider_status', type: 'text', default: 'active' })
  providerStatus!: string;

  @Column({ name: 'last_seen_at', type: 'bigint' })
  lastSeenAt!: number;

  @Column({ name: 'last_provider_check_at', type: 'bigint', nullable: true })
  lastProviderCheckAt!: number | null;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;

  @Column({ name: 'updated_at', type: 'bigint' })
  updatedAt!: number;
}
