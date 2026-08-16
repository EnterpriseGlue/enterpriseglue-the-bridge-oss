import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'identity_provisioning_directories', schema: 'main' })
@Index('uq_identity_provisioning_directories_key_identity', ['directoryKeyIdentity'], { unique: true })
@Index('uq_identity_provisioning_directories_active_authority', ['activeAuthoritativeIdentity'], { unique: true })
@Index('idx_identity_provisioning_directories_tenant_status', ['tenantId', 'status'])
@Index('idx_identity_provisioning_directories_provider', ['identityProviderKey'])
export class IdentityProvisioningDirectory extends AppBaseEntity {
  @Column({ name: 'tenant_id', type: 'text', nullable: true }) tenantId!: string | null;
  @Column({ type: 'text' }) key!: string;
  @Column({ name: 'directory_key_identity', type: 'text' }) directoryKeyIdentity!: string;
  @Column({ name: 'active_authoritative_identity', type: 'text' }) activeAuthoritativeIdentity!: string;
  @Column({ name: 'display_name', type: 'text' }) displayName!: string;
  @Column({ type: 'text', nullable: true }) description!: string | null;
  @Column({ type: 'text', default: 'scim_v2' }) type!: 'scim_v2';
  @Column({ name: 'identity_provider_key', type: 'text', nullable: true }) identityProviderKey!: string | null;
  @Column({ type: 'boolean', default: true }) authoritative!: boolean;
  @Column({ type: 'text', default: 'disabled' }) status!: 'active' | 'disabled' | 'archived';
  @Column({ name: 'ownership_mode', type: 'text', default: 'manual' }) ownershipMode!: 'manual' | 'config_locked' | 'config_warn';
  @Column({ name: 'source_ref', type: 'text', nullable: true }) sourceRef!: string | null;
  @Column({ name: 'source_hash', type: 'text', nullable: true }) sourceHash!: string | null;
  /** Resolver reference only. The resolved bearer value and its hash are never stored here. */
  @Column({ name: 'credential_secret_ref', type: 'text', nullable: true }) credentialSecretRef!: string | null;
  @Column({ name: 'last_applied_at', type: 'bigint', nullable: true }) lastAppliedAt!: number | null;
  @Column({ name: 'drift_status', type: 'text', nullable: true }) driftStatus!: 'in_sync' | 'drifted' | 'unknown' | null;
  @Column({ name: 'created_at', type: 'bigint' }) createdAt!: number;
  @Column({ name: 'updated_at', type: 'bigint' }) updatedAt!: number;
  @Column({ name: 'archived_at', type: 'bigint', nullable: true }) archivedAt!: number | null;
}
