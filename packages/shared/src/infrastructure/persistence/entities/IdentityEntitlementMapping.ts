import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'identity_entitlement_mappings', schema: 'main' })
@Index('idx_identity_entitlement_mapping_tenant', ['tenantId'])
@Index('idx_identity_entitlement_mapping_provider', ['providerId'])
@Index('idx_identity_entitlement_mapping_lookup', ['providerId', 'entitlementType', 'isActive'])
@Index('idx_identity_entitlement_mapping_group', ['targetGroupId'])
export class IdentityEntitlementMapping extends AppBaseEntity {
  @Column({ name: 'tenant_id', type: 'text', nullable: true }) tenantId!: string | null;
  @Column({ name: 'provider_id', type: 'text' }) providerId!: string;
  @Column({ name: 'config_key', type: 'text', nullable: true }) configKey!: string | null;
  @Column({ name: 'entitlement_type', type: 'text' }) entitlementType!: string;
  @Column({ name: 'external_id', type: 'text', nullable: true }) externalId!: string | null;
  @Column({ name: 'match_operator', type: 'text', default: 'exact' }) matchOperator!: string;
  @Column({ name: 'target_group_id', type: 'text' }) targetGroupId!: string;
  @Column({ name: 'sync_mode', type: 'text', default: 'authoritative' }) syncMode!: string;
  @Column({ name: 'is_active', type: 'boolean', default: true }) isActive!: boolean;
  @Column({ name: 'created_at', type: 'bigint' }) createdAt!: number;
  @Column({ name: 'updated_at', type: 'bigint' }) updatedAt!: number;
}
