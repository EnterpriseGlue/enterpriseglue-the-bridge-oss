import { Entity, Column, Index } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'engines', schema: 'main' })
@Index('idx_engines_owner', ['ownerId'])
@Index('idx_engines_delegate', ['delegateId'])
@Index('idx_engines_environment', ['environmentTagId'])
@Index('idx_engines_tenant', ['tenantId'])
@Index('idx_engines_external_id', ['externalId'])
@Index('idx_engines_external_system', ['externalSystemId'])
@Index('idx_engines_lifecycle_status', ['lifecycleStatus'])
@Index('idx_engines_capability_status', ['capabilityStatus'])
export class Engine extends AppBaseEntity {
  @Column({ type: 'text' })
  name!: string;

  @Column({ name: 'base_url', type: 'text' })
  baseUrl!: string;

  @Column({ type: 'text', nullable: true })
  type!: string | null;

  @Column({ name: 'auth_type', type: 'text', nullable: true })
  authType!: string | null;

  @Column({ type: 'text', nullable: true })
  username!: string | null;

  @Column({ name: 'password_enc', type: 'text', nullable: true })
  passwordEnc!: string | null;

  @Column({ name: 'oauth_token_url', type: 'text', nullable: true })
  oauthTokenUrl!: string | null;

  @Column({ name: 'oauth_scopes', type: 'text', nullable: true })
  oauthScopes!: string | null;

  @Column({ name: 'oauth_audience', type: 'text', nullable: true })
  oauthAudience!: string | null;

  @Column({ type: 'text', nullable: true })
  version!: string | null;

  @Column({ name: 'external_id', type: 'text', nullable: true })
  externalId!: string | null;

  @Column({ name: 'labels_json', type: 'text', nullable: true })
  labelsJson!: string | null;

  @Column({ name: 'registration_source', type: 'text', nullable: true })
  registrationSource!: string | null;

  @Column({ name: 'external_system_id', type: 'text', nullable: true })
  externalSystemId!: string | null;

  @Column({ name: 'management_mode', type: 'text', nullable: true })
  managementMode!: string | null;

  @Column({ name: 'field_ownership_json', type: 'text', nullable: true })
  fieldOwnershipJson!: string | null;

  @Column({ name: 'drift_status', type: 'text', nullable: true })
  driftStatus!: string | null;

  @Column({ name: 'lifecycle_status', type: 'text', nullable: true })
  lifecycleStatus!: string | null;

  @Column({ name: 'last_external_sync_at', type: 'bigint', nullable: true })
  lastExternalSyncAt!: number | null;

  @Column({ name: 'capabilities_json', type: 'text', nullable: true })
  capabilitiesJson!: string | null;

  @Column({ name: 'capability_status', type: 'text', nullable: true })
  capabilityStatus!: string | null;

  @Column({ name: 'external_updated_at', type: 'bigint', nullable: true })
  externalUpdatedAt!: number | null;

  @Column({ name: 'owner_id', type: 'text', nullable: true })
  ownerId!: string | null;

  @Column({ name: 'delegate_id', type: 'text', nullable: true })
  delegateId!: string | null;

  @Column({ name: 'environment_tag_id', type: 'text', nullable: true })
  environmentTagId!: string | null;

  @Column({ name: 'environment_locked', type: 'boolean', default: false })
  environmentLocked!: boolean;

  @Column({ name: 'tenant_id', type: 'text', nullable: true })
  tenantId!: string | null;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;

  @Column({ name: 'updated_at', type: 'bigint' })
  updatedAt!: number;
}
