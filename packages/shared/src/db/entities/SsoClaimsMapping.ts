import { Entity, Column, Index } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'sso_claims_mappings', schema: 'main' })
@Index('idx_sso_claims_provider', ['providerId'])
@Index('idx_sso_claims_active', ['isActive'])
@Index('idx_sso_claims_mappings_lookup', ['claimType', 'claimKey', 'isActive'])
export class SsoClaimsMapping extends AppBaseEntity {
  @Column({ name: 'provider_id', type: 'text', nullable: true })
  providerId!: string | null;

  @Column({ name: 'claim_type', type: 'text' })
  claimType!: string;

  @Column({ name: 'claim_key', type: 'text' })
  claimKey!: string;

  @Column({ name: 'claim_value', type: 'text' })
  claimValue!: string;

  @Column({ name: 'target_role', type: 'text' })
  targetRole!: string;

  @Column({ type: 'integer', default: 0 })
  priority!: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;

  @Column({ name: 'updated_at', type: 'bigint' })
  updatedAt!: number;
}
