import { Column, Entity, Index, Unique } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

/**
 * An explicit mapping from one shared-engine tenant identity to exactly one
 * EnterpriseGlue tenant. The empty externalTenantId is the canonical value
 * for strategies whose stable sourceRef supplies the external identity.
 */
@Entity({ name: 'engine_tenant_mappings', schema: 'main' })
@Unique('uq_engine_tenant_mappings_identity', ['engineId', 'strategy', 'externalTenantId'])
@Unique('uq_engine_tenant_mappings_source', ['engineId', 'source', 'sourceRef'])
@Index('idx_engine_tenant_mappings_engine_active', ['engineId', 'isActive'])
@Index('idx_engine_tenant_mappings_enterprise_tenant', ['enterpriseTenantId'])
export class EngineTenantMapping extends AppBaseEntity {
  @Column({ name: 'engine_id', type: 'text' })
  engineId!: string;

  @Column({ name: 'external_tenant_id', type: 'text', default: '' })
  externalTenantId!: string;

  @Column({ name: 'enterprise_tenant_id', type: 'text' })
  enterpriseTenantId!: string;

  @Column({ name: 'tenant_reference_json', type: 'text', nullable: true })
  tenantReferenceJson!: string | null;

  @Column({ type: 'text' })
  strategy!: string;

  @Column({ type: 'text', default: 'manual' })
  source!: string;

  @Column({ name: 'source_ref', type: 'text' })
  sourceRef!: string;

  @Column({ name: 'ownership_mode', type: 'text', default: 'manual' })
  ownershipMode!: string;

  @Column({ name: 'source_hash', type: 'text', nullable: true })
  sourceHash!: string | null;

  @Column({ name: 'last_applied_at', type: 'bigint', nullable: true })
  lastAppliedAt!: number | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;

  @Column({ name: 'updated_at', type: 'bigint' })
  updatedAt!: number;
}
