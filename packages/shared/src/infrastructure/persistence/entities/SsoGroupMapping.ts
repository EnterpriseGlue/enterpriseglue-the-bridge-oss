import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'sso_group_mappings', schema: 'main' })
@Index('idx_sso_group_mappings_tenant', ['tenantId'])
@Index('idx_sso_group_mappings_provider', ['providerId'])
@Index('idx_sso_group_mappings_active', ['isActive'])
@Index('idx_sso_group_mappings_lookup', ['claimType', 'claimKey', 'isActive'])
@Index('idx_sso_group_mappings_group', ['targetGroupId'])
export class SsoGroupMapping extends AppBaseEntity {
  @Column({ name: 'tenant_id', type: 'text', nullable: true })
  tenantId!: string | null;

  @Column({ name: 'provider_id', type: 'text', nullable: true })
  providerId!: string | null;

  @Column({ name: 'claim_type', type: 'text' })
  claimType!: string;

  @Column({ name: 'claim_key', type: 'text' })
  claimKey!: string;

  @Column({ name: 'claim_value', type: 'text' })
  claimValue!: string;

  @Column({ name: 'claim_operator', type: 'text', nullable: true })
  claimOperator!: string | null;

  @Column({ name: 'target_group_id', type: 'text' })
  targetGroupId!: string;

  @Column({ name: 'sync_mode', type: 'text', default: 'authoritative' })
  syncMode!: string;

  @Column({ type: 'integer', default: 0 })
  priority!: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;

  @Column({ name: 'updated_at', type: 'bigint' })
  updatedAt!: number;
}
