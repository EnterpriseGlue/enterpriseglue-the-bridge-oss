import { Column, Entity, Index, Unique } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

/**
 * Provider-neutral identity configuration. Protocol-specific values are kept
 * in a secret-free JSON document; secret references, not secret values, are
 * stored here.
 */
@Entity({ name: 'identity_providers', schema: 'main' })
@Unique('uq_identity_providers_tenant_key', ['tenantId', 'key'])
@Index('idx_identity_providers_tenant', ['tenantId'])
@Index('idx_identity_providers_protocol_enabled', ['protocol', 'isEnabled'])
export class IdentityProvider extends AppBaseEntity {
  @Column({ name: 'tenant_id', type: 'text', nullable: true }) tenantId!: string | null;
  @Column({ type: 'text' }) key!: string;
  @Column({ type: 'text' }) protocol!: 'oidc' | 'saml' | 'ldap';
  @Column({ name: 'is_enabled', type: 'boolean', default: false }) isEnabled!: boolean;
  @Column({ name: 'authentication_mode', type: 'text', default: 'claims_only' }) authenticationMode!: 'direct' | 'claims_only';
  @Column({ name: 'directory_tenant_id', type: 'text', nullable: true }) directoryTenantId!: string | null;
  @Column({ name: 'configuration_json', type: 'text', default: '{}' }) configurationJson!: string;
  @Column({ name: 'sync_json', type: 'text', default: '{}' }) syncJson!: string;
  @Column({ name: 'ownership_mode', type: 'text', default: 'manual' }) ownershipMode!: string;
  @Column({ name: 'source_ref', type: 'text', nullable: true }) sourceRef!: string | null;
  @Column({ name: 'source_hash', type: 'text', nullable: true }) sourceHash!: string | null;
  @Column({ name: 'last_applied_at', type: 'bigint', nullable: true }) lastAppliedAt!: number | null;
  @Column({ name: 'drift_status', type: 'text', nullable: true }) driftStatus!: string | null;
  @Column({ name: 'created_at', type: 'bigint' }) createdAt!: number;
  @Column({ name: 'updated_at', type: 'bigint' }) updatedAt!: number;
}
