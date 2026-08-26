import { Column, Entity, Index, Unique } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

export type TenantDomainStatus = 'pending' | 'verified' | 'disabled';

/** Verified custom-domain to tenant mapping. Unverified domains never route. */
@Entity({ name: 'tenant_domains', schema: 'main' })
@Unique('uq_tenant_domains_hostname', ['hostname'])
@Index('idx_tenant_domains_tenant', ['tenantId', 'status'])
export class TenantDomain extends AppBaseEntity {
  @Column({ name: 'tenant_id', type: 'text' })
  tenantId!: string;

  @Column({ type: 'text' })
  hostname!: string;

  @Column({ type: 'text', default: 'pending' })
  status!: TenantDomainStatus;

  @Column({ name: 'verification_token_hash', type: 'text', nullable: true })
  verificationTokenHash!: string | null;

  @Column({ name: 'verified_at', type: 'bigint', nullable: true })
  verifiedAt!: number | null;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;

  @Column({ name: 'updated_at', type: 'bigint' })
  updatedAt!: number;
}
