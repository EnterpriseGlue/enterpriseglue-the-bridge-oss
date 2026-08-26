import { Column, Entity, Index, Unique } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

export type TenantDiscoveryDomainStatus = 'pending' | 'verified' | 'disabled';

/** DNS-verified work-email domain used only to suggest a tenant before login. */
@Entity({ name: 'tenant_discovery_domains', schema: 'main' })
@Unique('uq_tenant_discovery_domains_tenant_domain', ['tenantId', 'domain'])
@Index('idx_tenant_discovery_domains_lookup', ['domain', 'status'])
@Index('idx_tenant_discovery_domains_tenant', ['tenantId', 'status'])
export class TenantDiscoveryDomain extends AppBaseEntity {
  @Column({ name: 'tenant_id', type: 'text' })
  tenantId!: string;

  @Column({ type: 'text' })
  domain!: string;

  @Column({ type: 'text', default: 'pending' })
  status!: TenantDiscoveryDomainStatus;

  @Column({ name: 'verification_token_hash', type: 'text', nullable: true })
  verificationTokenHash!: string | null;

  @Column({ name: 'verified_at', type: 'bigint', nullable: true })
  verifiedAt!: number | null;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;

  @Column({ name: 'updated_at', type: 'bigint' })
  updatedAt!: number;
}
