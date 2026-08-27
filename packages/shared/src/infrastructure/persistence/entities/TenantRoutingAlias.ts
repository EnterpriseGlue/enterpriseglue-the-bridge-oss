import { Column, Entity, Index, Unique } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

export type TenantRoutingAliasStatus = 'active' | 'disabled';

/** Control-plane managed hostname mapping used before tenant authentication. */
@Entity({ name: 'tenant_routing_aliases', schema: 'main' })
@Unique('uq_tenant_routing_aliases_hostname', ['hostname'])
@Index('idx_tenant_routing_aliases_lookup', ['hostname', 'status'])
@Index('idx_tenant_routing_aliases_tenant', ['tenantId', 'status'])
export class TenantRoutingAlias extends AppBaseEntity {
  @Column({ name: 'tenant_id', type: 'text' })
  tenantId!: string;

  @Column({ type: 'text' })
  hostname!: string;

  @Column({ type: 'text', default: 'active' })
  status!: TenantRoutingAliasStatus;

  @Column({ type: 'text', default: 'cloud_workload' })
  source!: 'cloud_workload';

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;

  @Column({ name: 'updated_at', type: 'bigint' })
  updatedAt!: number;
}
